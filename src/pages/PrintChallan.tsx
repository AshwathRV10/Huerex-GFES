/**
 * The delivery challan that goes out with the goods.
 *
 * One challan is the set of job work lines sharing a number, a vendor and a
 * direction — which is exactly how the workbook recorded them, with the number
 * written once and a ditto mark down the rest of the block.
 *
 * The document states what left, in what sizes, how many, for which process and
 * against which order, and leaves room for two signatures. What it deliberately
 * does not do is assert anything about tax: the note at the foot is the
 * factory's own wording, set in Settings, because the treatment of goods sent
 * for job work is theirs to state and not this program's to guess.
 */
import { useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { PrintDocument, Detail, Signatures, useCompany } from '../components/PrintDocument'
import { useStore } from '../lib/store'
import { num } from '../lib/format'
import type { JobWorkRow } from '../lib/types'

const asDate = (iso: string) => {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return d && m && y ? `${d}-${m}-${y}` : iso
}

export default function PrintChallan() {
  const { challanNo = '' } = useParams()
  const [params] = useSearchParams()
  const vendor = params.get('vendor') ?? ''
  const direction = params.get('direction') ?? 'OUT'

  const jobwork = useStore((s) => s.data.jobwork)
  const orders = useStore((s) => s.data.orders)
  const company = useCompany()

  const lines = useMemo(
    () => jobwork.filter((r) =>
      r.challanNo === decodeURIComponent(challanNo) &&
      (!vendor || r.vendor === vendor) &&
      (!direction || r.direction === direction)),
    [jobwork, challanNo, vendor, direction],
  )

  const first = lines[0]
  const total = lines.reduce((sum, r) => sum + (r.qty || 0), 0)
  const processes = [...new Set(lines.map((r) => r.process).filter(Boolean))]
  const orderNos = [...new Set(lines.map((r) => r.orderNo).filter(Boolean))]
  const styles = orderNos
    .map((no) => orders.find((o) => o.orderNo === no))
    .filter(Boolean)
    .map((o) => `${o!.orderNo} · ${o!.styleCode}`)

  if (!first) {
    return (
      <PrintDocument
        title="Challan not found"
        documentType="Delivery challan"
        backTo="/job-work"
        backLabel="Back to job work"
      >
        <p className="text-[12px]">
          Nothing is recorded against challan {decodeURIComponent(challanNo) || '—'}
          {vendor ? ` for ${vendor}` : ''}. Check the number on the Job work sheet.
        </p>
      </PrintDocument>
    )
  }

  return (
    <PrintDocument
      title={`Challan ${first.challanNo} · ${first.vendor}`}
      documentType={direction === 'IN' ? 'Goods received note' : 'Delivery challan'}
      backTo="/job-work"
      backLabel="Back to job work"
    >
      {/* Who it is for, and what identifies it. */}
      <section className="grid grid-cols-[1.4fr_1fr] gap-6 mb-4 keep-together">
        <div>
          <p className="text-[9px] uppercase tracking-[0.1em] text-black/55 mb-1">
            {direction === 'IN' ? 'Received from' : 'To'}
          </p>
          <p className="text-[13px] font-semibold leading-snug">{first.vendor}</p>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 content-start">
          <Detail label="Challan no" value={<span className="font-semibold">{first.challanNo}</span>} />
          <Detail label="Date" value={asDate(first.date)} />
          <Detail label="Process" value={processes.join(', ')} />
          <Detail label="Order" value={orderNos.join(', ')} />
        </div>
      </section>

      {styles.length > 0 && (
        <p className="text-[10.5px] text-black/70 mb-3">
          Style: {styles.join('   ·   ')}
        </p>
      )}

      {/* What is actually going. */}
      <table className="w-full border-collapse text-[11.5px]">
        <thead>
          <tr className="border-y border-black/70">
            <th className="text-left font-semibold py-1.5 pr-2 w-8">#</th>
            <th className="text-left font-semibold py-1.5 pr-2">Order</th>
            <th className="text-left font-semibold py-1.5 pr-2">Colour</th>
            <th className="text-left font-semibold py-1.5 pr-2">Size</th>
            <th className="text-left font-semibold py-1.5 pr-2">Process</th>
            <th className="text-right font-semibold py-1.5 pl-2 w-20">Pieces</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <Row key={line.id} line={line} index={index} />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black/70">
            <td colSpan={5} className="py-2 pr-2 text-right font-semibold">
              Total — {lines.length} line{lines.length === 1 ? '' : 's'}
            </td>
            <td className="py-2 pl-2 text-right font-bold tabular-nums">{num(total)}</td>
          </tr>
        </tfoot>
      </table>

      {company.challanNote.trim() && (
        <p className="mt-5 text-[10.5px] leading-relaxed text-black/75 keep-together">
          {company.challanNote}
        </p>
      )}

      <Signatures
        left="Prepared by"
        right={direction === 'IN' ? 'Checked by' : "Received by, with company seal"}
      />
    </PrintDocument>
  )
}

function Row({ line, index }: { line: JobWorkRow; index: number }) {
  return (
    <tr className="border-b border-black/15">
      <td className="py-1.5 pr-2 text-black/60 tabular-nums">{index + 1}</td>
      <td className="py-1.5 pr-2">{line.orderNo}</td>
      <td className="py-1.5 pr-2">{line.colour}</td>
      <td className="py-1.5 pr-2">{line.size}</td>
      <td className="py-1.5 pr-2">
        {line.process}
        {line.remarks && <span className="text-black/55"> · {line.remarks}</span>}
      </td>
      <td className="py-1.5 pl-2 text-right tabular-nums">{num(line.qty)}</td>
    </tr>
  )
}
