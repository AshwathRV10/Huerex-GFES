/**
 * Builds the initial database from the HUEREX GFES V5.1 workbook.
 *
 * Only values a person actually typed into the workbook are carried across —
 * every derived column is recomputed by the app's engine, so nothing stale
 * can survive an import. Rates are deliberately NOT invented: the rate book
 * starts empty and fills up as the team enters real numbers.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_DIR, type Database, COLLECTIONS, newId } from './store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SEED_FILE = path.join(__dirname, '..', 'data', 'workbook-seed.json')

type Raw = Record<string, any>
const n = (v: any): number | undefined => (v === undefined || v === null || v === '' ? undefined : Number(v))
const s = (v: any): string | undefined => {
  if (v === undefined || v === null) return undefined
  const t = String(v).trim()
  return t === '' ? undefined : t
}
const yn = (v: any): boolean => String(v ?? '').trim().toUpperCase() === 'Y'

/** "L66-B14-12-150\nGIRLS FULL SLEEVE" → code + name, so styles can be priced. */
function splitStyle(raw: any): { styleCode: string; styleName: string } {
  const text = String(raw ?? '').trim()
  if (!text) return { styleCode: '', styleName: '' }
  const parts = text.split(/[\n\r]+/).map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 2) return { styleCode: parts[0], styleName: parts.slice(1).join(' ') }
  return { styleCode: parts[0], styleName: '' }
}

/** Lists the app offers as type-to-search + type-to-add everywhere. */
export const MASTER_LISTS = [
  'buyers', 'colours', 'sizes', 'lines', 'vendors', 'jobWorkProcesses', 'approvalTypes',
  'delayReasons', 'fabricTypes', 'trimItems', 'team', 'styles', 'suppliers', 'yarnTypes',
  'overheadHeads', 'cmtOperations', 'trimUnits', 'cartonTypes', 'inspectors', 'currencies',
] as const

const WORKBOOK_TO_MASTER: Record<string, string> = {
  Buyers: 'buyers',
  Colours: 'colours',
  Sizes: 'sizes',
  Lines: 'lines',
  Vendors: 'vendors',
  'Job Work Process': 'jobWorkProcesses',
  'Approval Type': 'approvalTypes',
  'Delay Reason': 'delayReasons',
  'Fabric Type': 'fabricTypes',
  'Trim Item': 'trimItems',
  'Team (Merchandiser / Planner)': 'team',
}

/** Structure, not numbers: the cost heads a garment order is built from. */
const DEFAULT_CMT_OPERATIONS = [
  'Cutting', 'Fusing', 'Sewing', 'Ironing', 'Checking', 'Packing', 'Thread Trimming', 'Finishing',
]
const DEFAULT_OVERHEAD_HEADS = [
  'Sampling', 'Lab Test', 'Documentation', 'Transportation', 'Inspection Fee', 'Courier',
  'Bank / LC Charges', 'Commission', 'Factory Overhead',
]
const DEFAULT_TRIM_UNITS = ['pcs', 'mtr', 'set', 'pair', 'gross', 'kg', 'roll', 'cone']

/** Which processes happen inside the factory and which go out to a vendor. */
const WORKBOOK_PROCESS_TYPES: Record<string, 'In-house' | 'Outsourced'> = {
  Cutting: 'In-house', Fusing: 'In-house', Sewing: 'In-house', Checking: 'In-house',
  Packing: 'In-house', Inspection: 'In-house', Shipment: 'In-house',
  Print: 'Outsourced', Embroidery: 'Outsourced', Wash: 'Outsourced', 'Tie&Dye': 'Outsourced',
  'Rotary AOP': 'Outsourced', Other: 'Outsourced',
}

export function buildSeed(): Database {
  const raw = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')) as Record<string, any>

  const db: Database = {
    version: 1,
    collections: Object.fromEntries(COLLECTIONS.map((c) => [c, []])) as Database['collections'],
    singletons: { masters: {}, settings: {}, processTypes: {} },
    updatedAt: new Date().toISOString(),
  }

  // ── Masters ──────────────────────────────────────────────────────────
  const masters: Record<string, string[]> = {}
  for (const key of MASTER_LISTS) masters[key] = []
  for (const [sheetName, list] of Object.entries(raw.masters ?? {})) {
    const target = WORKBOOK_TO_MASTER[sheetName]
    if (target) masters[target] = (list as string[]).map((v) => String(v).trim()).filter(Boolean)
  }
  // The route can contain any process; what matters is whether it is done
  // inside the factory or sent to a vendor.
  const processTypes: Record<string, 'In-house' | 'Outsourced'> = {}
  for (const [name, type] of Object.entries(WORKBOOK_PROCESS_TYPES)) processTypes[name] = type
  masters.processes = Object.keys(processTypes)
  masters.cmtOperations = DEFAULT_CMT_OPERATIONS
  masters.overheadHeads = DEFAULT_OVERHEAD_HEADS
  masters.trimUnits = DEFAULT_TRIM_UNITS
  masters.currencies = ['INR', 'USD', 'EUR', 'GBP']
  db.singletons.masters = masters
  db.singletons.processTypes = processTypes

  db.singletons.settings = {
    currency: 'INR',
    // Alert timing, carried over from the workbook's SETTINGS block.
    defaultFabricLeadDays: 30,
    fabricDueSoonWindowDays: 7,
    recutLeadDays: 14,
    recutDueNoticeWindowDays: 3,
    agedWipDays: 14,
    jobWorkWatchDays: 14,
    fabricWastageThresholdPct: 0.12,
    dhuThresholdPct: 0.05,
    // Costing defaults, applied to a new order costing and editable per order.
    defaultRejectionPct: 0.02,
    defaultFabricWastagePct: 0.08,
    defaultTrimWastagePct: 0.03,
  }

  // ── Buyers ───────────────────────────────────────────────────────────
  // Excess % is left at zero on purpose: it varies buyer to buyer and only the
  // team knows the real figure. The app nags until each buyer has one set.
  db.collections.buyers = (masters.buyers ?? []).map((name) => ({
    id: newId('buy'),
    name,
    excessPct: 0,
    excessPctSet: false,
    excessInvoiced: true,
    currency: 'INR',
    paymentTerms: '',
    notes: '',
  }))

  // ── Orders ───────────────────────────────────────────────────────────
  const styleSet = new Set<string>()
  db.collections.orders = (raw.orders ?? []).map((o: Raw) => {
    const { styleCode, styleName } = splitStyle(o.style)
    if (styleCode) styleSet.add(styleCode)
    return {
      id: newId('ord'),
      orderNo: s(o.orderNo) ?? '',
      buyer: s(o.buyer) ?? '',
      styleCode,
      styleName,
      orderQty: n(o.orderQty) ?? 0,
      orderDate: s(o.orderDate) ?? '',
      exFactoryDate: s(o.exFactoryDate) ?? '',
      sewCompleteBy: s(o.sewCompleteBy) ?? '',
      sam: n(o.sam) ?? 0,
      bufferPct: n(o.bufferPct) ?? 0,
      merchandiser: s(o.merchandiser) ?? '',
      planner: s(o.planner) ?? '',
      status: s(o.status) ?? 'Active',
      setGroup: s(o.setGroup) ?? '',
      setRole: s(o.setRole) ?? '',
      fabricLeadDays: n(o.fabricLeadDays) ?? null,
      // Commercial fields the workbook never had — the reason for the costing module.
      sellingPrice: null,
      currency: 'INR',
      excessPct: null,        // null = inherit the buyer's figure
      excessInvoiced: null,
      notes: '',
    }
  })
  masters.styles = [...styleSet].sort()

  const copy = <T extends Raw>(rows: T[] | undefined, prefix: string, map: (r: T) => Raw) =>
    (rows ?? []).map((r) => ({ id: newId(prefix), ...map(r) }))

  db.collections.routeSteps = copy(raw.route, 'rt', (r) => ({
    orderNo: s(r.orderNo) ?? '', stepNo: n(r.stepNo) ?? 0, process: s(r.process) ?? '',
  }))

  db.collections.matrix = copy(raw.matrix, 'mx', (r) => ({
    orderNo: s(r.orderNo) ?? '', colour: s(r.colour) ?? '', size: s(r.size) ?? '',
    orderQty: n(r.orderQty) ?? 0, recutDecision: s(r.recutDecision) ?? '',
  }))

  db.collections.fabric = copy(raw.fabric, 'fab', (r) => ({
    date: s(r.date) ?? '', orderNo: s(r.orderNo) ?? '', colour: s(r.colour) ?? '',
    fabricType: s(r.fabricType) ?? '', receivedKg: n(r.receivedKg) ?? 0,
    issuedKg: n(r.issuedKg) ?? 0, returnedKg: n(r.returnedKg) ?? 0,
    manualConsumedKg: n(r.manualConsumedKg) ?? null, remarks: s(r.remarks) ?? '',
  }))

  db.collections.trims = copy(raw.trims, 'trm', (r) => ({
    date: s(r.date) ?? '', orderNo: s(r.orderNo) ?? '', trimItem: s(r.trimItem) ?? '',
    requiredQty: n(r.requiredQty) ?? 0, receivedQty: n(r.receivedQty) ?? 0,
    issuedQty: n(r.issuedQty) ?? 0, blocksPacking: yn(r.blocksPacking), remarks: s(r.remarks) ?? '',
  }))

  db.collections.jobwork = copy(raw.jobwork, 'jw', (r) => ({
    date: s(r.date) ?? '', orderNo: s(r.orderNo) ?? '', colour: s(r.colour) ?? '',
    size: s(r.size) ?? '', process: s(r.process) ?? '', vendor: s(r.vendor) ?? '',
    direction: (s(r.direction) ?? 'OUT').toUpperCase(), qty: n(r.qty) ?? 0, remarks: s(r.remarks) ?? '',
  }))

  db.collections.cutting = copy(raw.cutting, 'cut', (r) => ({
    date: s(r.date) ?? '', orderNo: s(r.orderNo) ?? '', colour: s(r.colour) ?? '',
    size: s(r.size) ?? '', fabricType: s(r.fabricType) ?? '',
    countsAsGarment: r.countsAsGarment === undefined ? true : yn(r.countsAsGarment),
    lotNo: s(r.lotNo) ?? '', cutQty: n(r.cutQty) ?? 0, gsm: n(r.gsm) ?? null,
    areaPerPc: n(r.areaPerPc) ?? null, pcWtG: n(r.pcWtG) ?? null, remarks: s(r.remarks) ?? '',
  }))

  db.collections.fusing = copy(raw.fusing, 'fus', (r) => ({
    date: s(r.date) ?? '', orderNo: s(r.orderNo) ?? '', colour: s(r.colour) ?? '',
    size: s(r.size) ?? '', fusedQty: n(r.fusedQty) ?? 0, remarks: s(r.remarks) ?? '',
  }))

  db.collections.sewing = copy(raw.sewing, 'sew', (r) => ({
    date: s(r.date) ?? '', orderNo: s(r.orderNo) ?? '', line: s(r.line) ?? '',
    operators: n(r.operators) ?? 0, hours: n(r.hours) ?? 0,
    block1: n(r.block1) ?? 0, block2: n(r.block2) ?? 0, block3: n(r.block3) ?? 0,
    issuedToLine: n(r.issuedToLine) ?? 0, remarks: s(r.remarks) ?? '',
  }))

  db.collections.checking = copy(raw.checking, 'chk', (r) => ({
    date: s(r.date) ?? '', orderNo: s(r.orderNo) ?? '', colour: s(r.colour) ?? '',
    size: s(r.size) ?? '', line: s(r.line) ?? '', checkedQty: n(r.checkedQty) ?? 0,
    passQty: n(r.passQty) ?? 0, alterQty: n(r.alterQty) ?? 0, rejectQty: n(r.rejectQty) ?? 0,
    recheckedOk: n(r.recheckedOk) ?? 0, remarks: s(r.remarks) ?? '',
  }))

  db.collections.packing = copy(raw.packing, 'pak', (r) => ({
    date: s(r.date) ?? '', orderNo: s(r.orderNo) ?? '', colour: s(r.colour) ?? '',
    size: s(r.size) ?? '', packedQty: n(r.packedQty) ?? 0, cartonNo: s(r.cartonNo) ?? '',
    remarks: s(r.remarks) ?? '',
  }))

  db.collections.inspection = copy(raw.inspection, 'ins', (r) => ({
    orderNo: s(r.orderNo) ?? '', inspectionDate: s(r.inspectionDate) ?? '',
    offeredQty: n(r.offeredQty) ?? 0, result: s(r.result) ?? 'Pending', aql: s(r.aql) ?? '',
    inspector: s(r.inspector) ?? '', remarks: s(r.remarks) ?? '',
  }))

  db.collections.shipment = copy(raw.shipment, 'shp', (r) => ({
    date: s(r.date) ?? '', orderNo: s(r.orderNo) ?? '', colour: s(r.colour) ?? '',
    size: s(r.size) ?? '', shipQty: n(r.shipQty) ?? 0, invoiceNo: s(r.invoiceNo) ?? '',
    buyerPoNo: s(r.buyerPoNo) ?? '', cartons: n(r.cartons) ?? 0,
    grossWtKg: n(r.grossWtKg) ?? 0, netWtKg: n(r.netWtKg) ?? 0, remarks: s(r.remarks) ?? '',
  }))

  db.collections.approvals = copy(raw.approvals, 'apr', (r) => ({
    orderNo: s(r.orderNo) ?? '', approvalType: s(r.approvalType) ?? '',
    required: r.required === undefined ? true : yn(r.required),
    status: s(r.status) ?? 'Pending', sentDate: s(r.sentDate) ?? '',
    decisionDate: s(r.decisionDate) ?? '', blocksProduction: yn(r.blocksProduction),
    remarks: s(r.remarks) ?? '',
  }))

  db.collections.waivers = copy(raw.waivers, 'wvr', (r) => ({
    orderNo: s(r.orderNo) ?? '', alertType: s(r.alertType) ?? '', approved: yn(r.approved),
    approvedBy: s(r.approvedBy) ?? '', approvalDate: s(r.approvalDate) ?? '',
    reason: s(r.reason) ?? '', validUntil: s(r.validUntil) ?? '',
  }))

  db.collections.costings = []
  db.collections.rateBook = []
  return db
}

// `npm run seed` rebuilds the database from the workbook.
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  const db = buildSeed()
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(path.join(DATA_DIR, 'huerex.json'), JSON.stringify(db, null, 1))
  const counts = Object.entries(db.collections).map(([k, v]) => `${k}:${(v as any[]).length}`)
  console.log('Seeded data/huerex.json →', counts.join('  '))
}
