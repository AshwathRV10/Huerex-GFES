/**
 * Permissions and roles.
 *
 * The rule this file exists to enforce: nothing is allowed unless a permission
 * explicitly grants it. A route with no declared permission is a bug, not an
 * open door — `requirePermission` is applied to every mutating route, and the
 * catalogue below is the only vocabulary it accepts.
 *
 * Costing is deliberately its own module. What a garment costs, what the buyer
 * was quoted and what the margin is are commercial facts a factory usually
 * wants a small number of people to see, so they sit behind their own
 * permissions and are stripped from API responses for everyone else.
 */

export type Action = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'export' | 'manage'

export interface PermissionDef {
  key: string
  module: string
  label: string
  /** Written for the person ticking the box, not for a developer. */
  detail: string
  /** Marks a permission that exposes commercial figures. */
  sensitive?: boolean
}

/**
 * Every permission the system understands. Adding a route means adding a
 * permission here first; there is no implicit access.
 */
export const PERMISSIONS: PermissionDef[] = [
  /* ── Orders ──────────────────────────────────────────────────────── */
  { key: 'orders.view', module: 'Orders', label: 'See orders', detail: 'Order numbers, buyers, styles, quantities, dates and the size breakdown' },
  { key: 'orders.create', module: 'Orders', label: 'Create orders', detail: 'Add a new order to the book' },
  { key: 'orders.edit', module: 'Orders', label: 'Edit orders', detail: 'Change an order, its route or its size breakdown' },
  { key: 'orders.delete', module: 'Orders', label: 'Delete orders', detail: 'Remove an order and its setup' },

  /* ── Production floor ────────────────────────────────────────────── */
  { key: 'production.view', module: 'Production', label: 'See the floor', detail: 'Cutting, fusing, job work, sewing, checking, packing, inspection, shipment and WIP' },
  { key: 'production.create', module: 'Production', label: 'Log production', detail: 'Record what was cut, sewn, checked, packed or shipped' },
  { key: 'production.edit', module: 'Production', label: 'Correct production entries', detail: 'Change an entry somebody already logged' },
  { key: 'production.delete', module: 'Production', label: 'Delete production entries', detail: 'Remove a logged entry entirely' },

  /* ── Materials ───────────────────────────────────────────────────── */
  { key: 'materials.view', module: 'Materials', label: 'See fabric and trims', detail: 'Kilograms in and out, trim coverage and what is short' },
  { key: 'materials.create', module: 'Materials', label: 'Log fabric and trims', detail: 'Record receipts, issues and returns' },
  { key: 'materials.edit', module: 'Materials', label: 'Correct material entries', detail: 'Change a fabric or trim entry' },
  { key: 'materials.delete', module: 'Materials', label: 'Delete material entries', detail: 'Remove a fabric or trim entry' },

  /* ── Costing — the commercially sensitive module ─────────────────── */
  { key: 'costing.view', module: 'Costing', label: 'See costing and prices', detail: 'Fabric, trim, job-work and CMT rates, overheads, cost per garment, margins and the price quoted to the buyer', sensitive: true },
  { key: 'costing.create', module: 'Costing', label: 'Create costings', detail: 'Start a costing for an order', sensitive: true },
  { key: 'costing.edit', module: 'Costing', label: 'Edit costings and rates', detail: 'Change any rate, the selling price or the rate book', sensitive: true },
  { key: 'costing.delete', module: 'Costing', label: 'Delete costings and rates', detail: 'Remove a costing or a remembered rate', sensitive: true },
  { key: 'costing.approve', module: 'Costing', label: 'Approve a costing', detail: 'Move a costing to Quoted or Confirmed — the figure the buyer is held to', sensitive: true },
  { key: 'costing.export', module: 'Costing', label: 'Export costing data', detail: 'Download cost sheets and any file containing rates or margins', sensitive: true },

  /* ── Approvals and alerts ────────────────────────────────────────── */
  { key: 'approvals.view', module: 'Approvals', label: 'See approvals and alerts', detail: 'What the buyer owes, and what needs attention' },
  { key: 'approvals.edit', module: 'Approvals', label: 'Record approvals', detail: 'Log a lab dip, fit approval or inspection result' },
  { key: 'approvals.approve', module: 'Approvals', label: 'Waive an alert', detail: 'Accept a delay so an alert stops firing until a date you set' },

  /* ── Masters ─────────────────────────────────────────────────────── */
  { key: 'masters.view', module: 'Masters', label: 'See master lists', detail: 'Colours, sizes, vendors, fabrics and the rest' },
  { key: 'masters.create', module: 'Masters', label: 'Add master values', detail: 'Type a new colour or vendor and have it remembered' },
  { key: 'masters.manage', module: 'Masters', label: 'Manage master lists', detail: 'Remove values and edit buyers, including their excess percentages' },

  /* ── Administration ──────────────────────────────────────────────── */
  { key: 'admin.users', module: 'Administration', label: 'Manage people', detail: 'Add and remove users, reset passwords, assign roles' },
  { key: 'admin.roles', module: 'Administration', label: 'Manage roles', detail: 'Create roles and decide which permissions each one grants' },
  { key: 'admin.settings', module: 'Administration', label: 'Change settings', detail: 'Alert thresholds and costing defaults' },
  { key: 'admin.backup', module: 'Administration', label: 'Back up and restore', detail: 'Download the whole database, or replace it', sensitive: true },
  { key: 'audit.view', module: 'Administration', label: 'Read the audit log', detail: 'See who changed what, when, and what the value was before' },
]

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key)
const PERMISSION_SET = new Set(PERMISSION_KEYS)
export const isPermission = (key: string) => PERMISSION_SET.has(key)

/** Permissions that expose rates, costs, margins or buyer prices. */
export const SENSITIVE_PERMISSIONS = PERMISSIONS.filter((p) => p.sensitive).map((p) => p.key)

export interface Role {
  id: string
  name: string
  description: string
  permissions: string[]
  /** A built-in role cannot be deleted, but its permissions can be edited. */
  builtIn: boolean
  /** The Administrator role always holds every permission; it cannot be reduced. */
  locked?: boolean
}

const all = () => [...PERMISSION_KEYS]

/**
 * Roles shipped on first run. They are ordinary rows after that — an admin can
 * edit the permissions of any of them except Administrator, and add their own.
 */
export const DEFAULT_ROLES: Omit<Role, 'id'>[] = [
  {
    name: 'Administrator',
    description: 'Everything, including people, roles and the audit log.',
    permissions: all(),
    builtIn: true,
    locked: true,
  },
  {
    name: 'Merchandiser',
    description: 'Runs the order book and its commercials — the only non-admin role that sees costing.',
    builtIn: true,
    permissions: [
      'orders.view', 'orders.create', 'orders.edit',
      'production.view',
      'materials.view',
      'costing.view', 'costing.create', 'costing.edit', 'costing.export',
      'approvals.view', 'approvals.edit',
      'masters.view', 'masters.create', 'masters.manage',
    ],
  },
  {
    name: 'Planner',
    description: 'Plans and tracks production. Sees no rates, costs or prices.',
    builtIn: true,
    permissions: [
      'orders.view', 'orders.edit',
      'production.view', 'production.create', 'production.edit',
      'materials.view', 'materials.create', 'materials.edit',
      'approvals.view', 'approvals.edit',
      'masters.view', 'masters.create',
    ],
  },
  {
    name: 'Floor',
    description: 'Logs what the floor actually did. No commercial data of any kind.',
    builtIn: true,
    permissions: [
      'orders.view',
      'production.view', 'production.create',
      'materials.view', 'materials.create',
      'masters.view', 'masters.create',
    ],
  },
  {
    name: 'Viewer',
    description: 'Read-only on production. Cannot change anything, and sees no costing.',
    builtIn: true,
    permissions: ['orders.view', 'production.view', 'materials.view', 'approvals.view', 'masters.view'],
  },
]

/* ── Checking ────────────────────────────────────────────────────────── */

export interface Principal {
  userId: string
  userName: string
  roleId: string
  roleName: string
  permissions: Set<string>
}

export const can = (principal: Principal | null, permission: string): boolean =>
  !!principal && principal.permissions.has(permission)

/** True when the user may see any commercial figure at all. */
export const canSeeCosting = (principal: Principal | null) => can(principal, 'costing.view')

/**
 * Which permission a write to a given collection requires.
 *
 * Collections are grouped by module so a floor operator logging cutting does
 * not inherit the right to edit an order or a rate. Anything absent from this
 * map is refused outright rather than defaulting to something permissive.
 */
const COLLECTION_MODULE: Record<string, string> = {
  orders: 'orders',
  routeSteps: 'orders',
  matrix: 'orders',

  cutting: 'production',
  fusing: 'production',
  jobwork: 'production',
  sewing: 'production',
  checking: 'production',
  packing: 'production',
  inspection: 'production',
  shipment: 'production',

  fabric: 'materials',
  trims: 'materials',

  costings: 'costing',
  rateBook: 'costing',

  approvals: 'approvals',
  waivers: 'approvals',

  buyers: 'masters',
}

/**
 * Returns the permission a write needs, or null when the collection is not
 * writable through the generic row API at all.
 */
export function permissionForWrite(collection: string, action: 'create' | 'edit' | 'delete'): string | null {
  const module = COLLECTION_MODULE[collection]
  if (!module) return null

  // Approvals and masters have no separate create/delete permission: recording
  // an approval is an edit, and buyers are managed rather than created ad hoc.
  if (module === 'approvals') return action === 'delete' ? 'approvals.edit' : 'approvals.edit'
  if (module === 'masters') return 'masters.manage'
  return `${module}.${action}`
}

/** Returns the permission needed to read a collection. */
export function permissionForRead(collection: string): string | null {
  const module = COLLECTION_MODULE[collection]
  return module ? `${module}.view` : null
}

export const moduleOf = (collection: string): string | undefined => COLLECTION_MODULE[collection]

/** Collections whose every row is commercially sensitive. */
export const SENSITIVE_COLLECTIONS = ['costings', 'rateBook'] as const

/**
 * Fields that carry a price or a commercial term and must be removed from a
 * row before it is sent to somebody without `costing.view`.
 */
export const SENSITIVE_FIELDS: Record<string, string[]> = {
  orders: ['sellingPrice', 'currency', 'excessPct', 'excessInvoiced'],
  buyers: ['excessPct', 'excessPctSet', 'excessInvoiced', 'currency', 'paymentTerms'],
}
