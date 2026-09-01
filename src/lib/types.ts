/** Every entity in the system. Ids are opaque; business keys are order numbers. */

export type Id = string

export interface Order {
  id: Id
  orderNo: string
  buyer: string
  styleCode: string
  styleName: string
  orderQty: number
  orderDate: string
  exFactoryDate: string
  sewCompleteBy: string
  sam: number
  bufferPct: number
  merchandiser: string
  planner: string
  status: 'Active' | 'On Hold' | 'Closed' | 'Cancelled' | string
  setGroup: string
  setRole: 'Primary' | 'Secondary' | '' | string
  fabricLeadDays: number | null
  /** Price quoted to the buyer, per piece, in `currency`. */
  sellingPrice: number | null
  currency: string
  /** null inherits the buyer's excess %. */
  excessPct: number | null
  /** null inherits the buyer's setting. */
  excessInvoiced: boolean | null
  notes: string
}

export interface Buyer {
  id: Id
  name: string
  /** Extra pieces shipped on top of the order, as a fraction. Varies by buyer. */
  excessPct: number
  excessPctSet: boolean
  /** Does the buyer pay for the excess pieces, or do they ship free? */
  excessInvoiced: boolean
  currency: string
  paymentTerms: string
  notes: string
}

export interface RouteStep { id: Id; orderNo: string; stepNo: number; process: string }

export interface MatrixRow {
  id: Id; orderNo: string; colour: string; size: string; orderQty: number
  recutDecision: string
}

export interface FabricRow {
  id: Id; date: string; orderNo: string; colour: string; fabricType: string
  receivedKg: number; issuedKg: number; returnedKg: number
  manualConsumedKg: number | null; remarks: string
}

export interface TrimRow {
  id: Id; date: string; orderNo: string; trimItem: string
  requiredQty: number; receivedQty: number; issuedQty: number
  blocksPacking: boolean; remarks: string
}

export interface JobWorkRow {
  id: Id; date: string; orderNo: string; colour: string; size: string
  process: string; vendor: string; direction: 'OUT' | 'IN' | string; qty: number; remarks: string
}

export interface CuttingRow {
  id: Id; date: string; orderNo: string; colour: string; size: string; fabricType: string
  countsAsGarment: boolean; lotNo: string; cutQty: number
  gsm: number | null; areaPerPc: number | null; pcWtG: number | null; remarks: string
}

export interface FusingRow {
  id: Id; date: string; orderNo: string; colour: string; size: string
  fusedQty: number; remarks: string
}

export interface SewingRow {
  id: Id; date: string; orderNo: string; line: string
  operators: number; hours: number
  block1: number; block2: number; block3: number
  issuedToLine: number; remarks: string
}

export interface CheckingRow {
  id: Id; date: string; orderNo: string; colour: string; size: string; line: string
  checkedQty: number; passQty: number; alterQty: number; rejectQty: number
  recheckedOk: number; remarks: string
}

export interface PackingRow {
  id: Id; date: string; orderNo: string; colour: string; size: string
  packedQty: number; cartonNo: string; remarks: string
}

export interface InspectionRow {
  id: Id; orderNo: string; inspectionDate: string; offeredQty: number
  result: string; aql: string; inspector: string; remarks: string
}

export interface ShipmentRow {
  id: Id; date: string; orderNo: string; colour: string; size: string
  shipQty: number; invoiceNo: string; buyerPoNo: string
  cartons: number; grossWtKg: number; netWtKg: number; remarks: string
}

export interface ApprovalRow {
  id: Id; orderNo: string; approvalType: string; required: boolean
  status: string; sentDate: string; decisionDate: string
  blocksProduction: boolean; remarks: string
}

export interface WaiverRow {
  id: Id; orderNo: string; alertType: string; approved: boolean
  approvedBy: string; approvalDate: string; reason: string; validUntil: string
}

/* ── Costing ─────────────────────────────────────────────────────────── */

/**
 * A remembered rate. `scope` names what the rate actually varies by, which is
 * the whole point: dyeing follows the colour, knitting follows the fabric,
 * printing follows the style. Two orders can therefore share a knitting rate
 * while having completely different dyeing and printing.
 */
export type RateKind =
  | 'yarn' | 'knitting' | 'dyeing' | 'finishing' | 'fabricLanded'
  | 'trim' | 'jobwork' | 'cmt' | 'overhead'

export interface RateEntry {
  id: Id
  kind: RateKind
  /** Human label, e.g. "Dyeing · PEACH ORANGE" */
  label: string
  /** The dimensions this rate is keyed on. Empty string = not scoped by it. */
  scope: { fabricType?: string; colour?: string; style?: string; vendor?: string; process?: string; item?: string; buyer?: string }
  unit: 'kg' | 'pc' | 'unit' | 'order' | 'mtr'
  rate: number
  currency: string
  /** Provenance, so a rate can be trusted or questioned. */
  uses: number
  lastUsedAt: string
  lastOrderNo: string
  note: string
}

export interface FabricCostLine {
  id: Id
  fabricType: string
  colour: string
  /** Grams of fabric in one finished garment, before wastage. */
  netGramsPerPc: number | null
  /** Or state total kilograms directly and leave grams blank. */
  netKgOverride: number | null
  wastagePct: number
  /** The landed ₹/kg, built up from the parts below. */
  yarnRate: number
  knittingRate: number
  dyeingRate: number
  finishingRate: number
  otherRate: number
  /** Set to override the built-up rate with a single landed figure. */
  landedRateOverride: number | null
  remarks: string
}

export interface TrimCostLine {
  id: Id
  trimItem: string
  supplier: string
  unit: string
  qtyPerPc: number
  rate: number
  wastagePct: number
  remarks: string
}

export interface JobWorkCostLine {
  id: Id
  process: string
  vendor: string
  ratePerPc: number
  /** Fraction of pieces that go through this process — 1 means all of them. */
  coverage: number
  remarks: string
}

export interface CmtCostLine {
  id: Id
  operation: string
  /** 'perPc' takes the rate as-is; 'sam' costs it as minutes × ₹/min. */
  basis: 'perPc' | 'sam'
  ratePerPc: number
  samMinutes: number
  costPerMinute: number
  remarks: string
}

export interface OverheadCostLine {
  id: Id
  head: string
  /** A lump sum for the order, or a rate charged on every piece. */
  basis: 'lumpSum' | 'perPc' | 'pctOfCost'
  amount: number
  remarks: string
}

export interface Costing {
  id: Id
  /**
   * Stamped by the server and bumped on every write. A costing is the one place
   * two people are likely to be editing the same row at once, so a save carries
   * the revision it started from and is refused if that has moved on.
   */
  rev?: number
  orderNo: string
  /** A costing is a named scenario, so a quote can be compared to a revision. */
  name: string
  currency: string
  createdAt: string
  updatedAt: string
  status: 'Draft' | 'Quoted' | 'Confirmed' | 'Closed'

  sellingPrice: number | null
  /** Overrides the buyer's excess % when set. */
  excessPct: number | null
  excessInvoiced: boolean | null
  /** Pieces expected to fail and be replaced — they still cost money to make. */
  rejectionPct: number

  fabric: FabricCostLine[]
  trims: TrimCostLine[]
  jobwork: JobWorkCostLine[]
  cmt: CmtCostLine[]
  overheads: OverheadCostLine[]
  notes: string
}

export interface Settings {
  currency: string
  defaultFabricLeadDays: number
  fabricDueSoonWindowDays: number
  recutLeadDays: number
  recutDueNoticeWindowDays: number
  agedWipDays: number
  jobWorkWatchDays: number
  fabricWastageThresholdPct: number
  dhuThresholdPct: number
  defaultRejectionPct: number
  defaultFabricWastagePct: number
  defaultTrimWastagePct: number
}

export type Masters = Record<string, string[]>

export interface AppState {
  orders: Order[]
  buyers: Buyer[]
  routeSteps: RouteStep[]
  matrix: MatrixRow[]
  fabric: FabricRow[]
  trims: TrimRow[]
  jobwork: JobWorkRow[]
  cutting: CuttingRow[]
  fusing: FusingRow[]
  sewing: SewingRow[]
  checking: CheckingRow[]
  packing: PackingRow[]
  inspection: InspectionRow[]
  shipment: ShipmentRow[]
  approvals: ApprovalRow[]
  waivers: WaiverRow[]
  costings: Costing[]
  rateBook: RateEntry[]
}

export type CollectionKey = keyof AppState
