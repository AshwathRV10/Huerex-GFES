/**
 * Server-side redaction.
 *
 * Hiding a field in the UI hides nothing — the browser still received it, and
 * anyone can open the network tab. So the payload itself is trimmed here,
 * before it leaves the process:
 *
 *   · costings and rateBook are removed entirely
 *   · sellingPrice and the excess terms are stripped from every order
 *   · the buyer's commercial terms are stripped from every buyer
 *   · audit rows marked sensitive are withheld unless the reader may see them
 *
 * A user without `costing.view` therefore cannot obtain a rate or a margin by
 * any route: not the state endpoint, not a row endpoint, not a URL they typed,
 * not a backup download.
 */
import { SENSITIVE_COLLECTIONS, SENSITIVE_FIELDS, canSeeCosting, permissionForRead, can, type Principal } from './rbac.js'

type Row = Record<string, unknown>

const withoutFields = (row: Row, fields: string[]): Row => {
  const copy: Row = {}
  for (const [key, value] of Object.entries(row)) {
    if (!fields.includes(key)) copy[key] = value
  }
  return copy
}

/** Redacts one row of a named collection for this principal. */
export function redactRow(collection: string, row: Row, principal: Principal | null): Row | null {
  if ((SENSITIVE_COLLECTIONS as readonly string[]).includes(collection)) {
    return canSeeCosting(principal) ? row : null
  }
  const fields = SENSITIVE_FIELDS[collection]
  if (fields && !canSeeCosting(principal)) return withoutFields(row, fields)
  return row
}

/**
 * Builds the whole-state payload for this principal: only the collections they
 * may read, with sensitive collections and fields removed.
 */
export function redactState(
  collections: Record<string, Row[]>,
  principal: Principal | null,
): Record<string, Row[]> {
  const out: Record<string, Row[]> = {}
  const showCosting = canSeeCosting(principal)

  for (const [name, rows] of Object.entries(collections)) {
    // Never ship the auth tables to the browser; they have their own endpoints.
    if (name === 'users' || name === 'sessions' || name === 'roles' || name === 'auditLog') continue

    const readPermission = permissionForRead(name)
    if (readPermission && !can(principal, readPermission)) {
      out[name] = []
      continue
    }

    if ((SENSITIVE_COLLECTIONS as readonly string[]).includes(name)) {
      out[name] = showCosting ? rows : []
      continue
    }

    const fields = SENSITIVE_FIELDS[name]
    out[name] = fields && !showCosting ? rows.map((row) => withoutFields(row, fields)) : rows
  }
  return out
}

/**
 * The settings a principal may see. The costing defaults are commercial, so
 * they travel only with `costing.view`.
 */
export function redactSettings(settings: Record<string, unknown>, principal: Principal | null) {
  if (canSeeCosting(principal)) return settings
  const hidden = ['defaultRejectionPct', 'defaultFabricWastagePct', 'defaultTrimWastagePct', 'currency']
  return withoutFields(settings as Row, hidden)
}
