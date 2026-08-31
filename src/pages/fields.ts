/**
 * Field definitions shared by every transaction page.
 *
 * The colour and size pickers read the order that has been chosen in the same
 * row and float that order's own colours and sizes to the top. It is still a
 * full type-to-search field — anything can be added — but the values that are
 * almost certainly right are one keystroke away.
 */
import { useStore } from '../lib/store'
import { today } from '../lib/format'
import type { FieldDef } from '../components/LogTable'

type HasOrder = { orderNo?: string }

/** Live orders first — nobody logs cutting against a cancelled order. */
export function orderOptions(): string[] {
  const orders = useStore.getState().data.orders
  const rank = (status: string) => (status === 'Active' ? 0 : status === 'On Hold' ? 1 : 2)
  return [...orders]
    .sort((a, b) => rank(a.status) - rank(b.status) || a.orderNo.localeCompare(b.orderNo))
    .map((o) => o.orderNo)
}

export function orderField<T extends HasOrder>(): FieldDef<T> {
  return {
    kind: 'combo',
    key: 'orderNo' as keyof T & string,
    header: 'Order',
    width: '9.5rem',
    required: true,
    allowCreate: false,
    options: orderOptions(),
    suggest: () => {
      const orders = useStore.getState().data.orders
      return orders.filter((o) => o.status === 'Active').map((o) => o.orderNo)
    },
  }
}

export function colourField<T extends HasOrder>(): FieldDef<T> {
  return {
    kind: 'combo',
    key: 'colour' as keyof T & string,
    header: 'Colour',
    width: '10rem',
    required: true,
    list: 'colours',
    suggest: (draft) => coloursOf(draft.orderNo),
  }
}

export function sizeField<T extends HasOrder>(): FieldDef<T> {
  return {
    kind: 'combo',
    key: 'size' as keyof T & string,
    header: 'Size',
    width: '7rem',
    required: true,
    list: 'sizes',
    suggest: (draft) => sizesOf(draft.orderNo, (draft as { colour?: string }).colour),
  }
}

export function dateField<T>(key: keyof T & string = 'date' as keyof T & string, header = 'Date'): FieldDef<T> {
  return { kind: 'date', key, header, width: '8.5rem', required: true }
}

export const blankDate = () => today()

export function coloursOf(orderNo: string | undefined): string[] {
  if (!orderNo) return []
  const matrix = useStore.getState().data.matrix
  return [...new Set(matrix.filter((r) => r.orderNo === orderNo).map((r) => r.colour).filter(Boolean))]
}

export function sizesOf(orderNo: string | undefined, colour?: string): string[] {
  if (!orderNo) return []
  const matrix = useStore.getState().data.matrix
  return [...new Set(
    matrix
      .filter((r) => r.orderNo === orderNo && (!colour || r.colour === colour))
      .map((r) => r.size)
      .filter(Boolean),
  )]
}

/** The fabric types this order has already received or cut. */
export function fabricTypesOf(orderNo: string | undefined): string[] {
  if (!orderNo) return []
  const { fabric, cutting } = useStore.getState().data
  return [...new Set([
    ...fabric.filter((r) => r.orderNo === orderNo).map((r) => r.fabricType),
    ...cutting.filter((r) => r.orderNo === orderNo).map((r) => r.fabricType),
  ].filter(Boolean))]
}

/** The outsourced steps this order's route actually contains. */
export function jobWorkProcessesOf(orderNo: string | undefined): string[] {
  if (!orderNo) return []
  const { data, processTypes } = useStore.getState()
  const inHouse = new Set(['Cutting', 'Fusing', 'Sewing', 'Checking', 'Packing', 'Inspection', 'Shipment'])
  return [...new Set(
    data.routeSteps
      .filter((step) => step.orderNo === orderNo)
      .map((step) => step.process)
      .filter((process) => process && (processTypes[process] ?? (inHouse.has(process) ? 'In-house' : 'Outsourced')) === 'Outsourced'),
  )]
}

/** The vendors this order has already sent work to, for a given process. */
export function vendorsOf(orderNo: string | undefined, process?: string): string[] {
  if (!orderNo) return []
  const { jobwork } = useStore.getState().data
  return [...new Set(
    jobwork
      .filter((r) => r.orderNo === orderNo && (!process || r.process === process))
      .map((r) => r.vendor)
      .filter(Boolean),
  )]
}

/** A validator that insists on the fields marked required. */
export function requireFields<T>(
  fields: { key: string; header: string; required?: boolean }[],
) {
  return (draft: Partial<T>): string | null => {
    for (const field of fields) {
      if (!field.required) continue
      const value = (draft as Record<string, unknown>)[field.key]
      if (value === undefined || value === null || value === '') return `${field.header} is required`
    }
    return null
  }
}
