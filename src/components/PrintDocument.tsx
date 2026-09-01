/**
 * The frame every printed document sits in.
 *
 * These pages leave the building. A challan goes in a vendor's hand with the
 * goods; a costing sheet is filed against an order or shown to a buyer. So they
 * are laid out for A4 and for ink: no colour that needs a colour printer, no
 * background wash that drinks toner, hairline rules instead of borders, and
 * type sized to be read across a table rather than on a screen.
 *
 * Printing is the browser's own — Ctrl+P, or Save as PDF from the same dialogue.
 * That gets paper and a file from one implementation, needs no library, and
 * works on a factory PC that has never been online.
 *
 * The letterhead comes from Settings and is never invented. A challan carrying
 * a made-up company name or registration number would be worse than one with a
 * blank space where the real thing goes, so an unfilled letterhead says plainly
 * that it needs filling.
 */
import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Printer, TriangleAlert } from 'lucide-react'
import { useStore } from '../lib/store'
import type { Company } from '../lib/types'

export const EMPTY_COMPANY: Company = {
  name: '', addressLines: '', gstin: '', phone: '', email: '', challanNote: '',
}

export const useCompany = (): Company => {
  const settings = useStore((s) => s.settings)
  return { ...EMPTY_COMPANY, ...(settings.company ?? {}) }
}

/**
 * Wraps one document.
 *
 * `backTo` is where the screen sends you when you are done; it does not print.
 */
export function PrintDocument({
  title, documentType, backTo, backLabel, children, warn,
}: {
  title: string
  documentType: string
  backTo: string
  backLabel: string
  children: ReactNode
  /** Shown on screen only — a reason the document is not ready to hand over. */
  warn?: ReactNode
}) {
  const company = useCompany()
  const blankLetterhead = !company.name.trim()

  useEffect(() => {
    const previous = document.title
    document.title = title
    return () => { document.title = previous }
  }, [title])

  return (
    <div className="min-h-full bg-sunken print:bg-white">
      {/* Everything in here is for the screen and prints nothing. */}
      <div className="no-print sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto max-w-[210mm] flex items-center gap-3 px-4 py-2.5">
          <Link
            to={backTo}
            className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink transition-colors"
          >
            <ArrowLeft className="size-4" />
            {backLabel}
          </Link>
          <span className="ml-auto text-2xs text-ink-3 hidden sm:block">
            Print, or choose <span className="font-medium text-ink-2">Save as PDF</span> in the same dialogue
          </span>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg font-medium text-sm
                       bg-brand-600 text-white shadow-lift hover:bg-brand-700 active:scale-[.985] transition-all"
          >
            <Printer className="size-4" />
            Print
          </button>
        </div>
        {(blankLetterhead || warn) && (
          <div className="mx-auto max-w-[210mm] px-4 pb-2.5 space-y-2">
            {blankLetterhead && (
              <p className="flex items-start gap-2 text-xs text-ink-2 rounded-lg border border-warn/30 bg-warn/[0.07] px-3 py-2">
                <TriangleAlert className="size-3.5 text-warn shrink-0 mt-px" />
                <span>
                  There is no letterhead yet, so this prints without your factory's name or GSTIN.
                  Fill it in under <Link to="/settings" className="underline font-medium">Settings → Your factory</Link>.
                </span>
              </p>
            )}
            {warn}
          </div>
        )}
      </div>

      <div className="mx-auto max-w-[210mm] px-4 py-6 print:p-0 print:max-w-none">
        <article className="sheet bg-white text-black rounded-xl shadow-lift print:rounded-none print:shadow-none">
          <Letterhead company={company} documentType={documentType} />
          {children}
        </article>
      </div>
    </div>
  )
}

function Letterhead({ company, documentType }: { company: Company; documentType: string }) {
  const address = company.addressLines.split('\n').map((l) => l.trim()).filter(Boolean)
  const contact = [company.phone, company.email].filter(Boolean).join('  ·  ')

  return (
    <header className="flex items-start justify-between gap-6 pb-3 mb-4 border-b-2 border-black/80">
      <div className="min-w-0">
        <h1 className="text-lg font-bold tracking-tight leading-tight">
          {company.name || '—'}
        </h1>
        {address.map((line) => (
          <p key={line} className="text-[10.5px] leading-snug text-black/75">{line}</p>
        ))}
        {contact && <p className="text-[10.5px] leading-snug text-black/75 mt-0.5">{contact}</p>}
        {company.gstin && (
          <p className="text-[10.5px] leading-snug text-black/75 mt-0.5">
            GSTIN <span className="font-mono">{company.gstin}</span>
          </p>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold uppercase tracking-[0.14em]">{documentType}</p>
      </div>
    </header>
  )
}

/* ── Pieces the documents share ───────────────────────────────────────── */

/** A labelled value in the header block of a document. */
export function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] uppercase tracking-[0.1em] text-black/55 leading-none mb-1">{label}</p>
      <p className="text-[11.5px] leading-snug break-words">{value || '—'}</p>
    </div>
  )
}

/** Signature lines. A challan is not finished until somebody signs for it. */
export function Signatures({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex justify-between gap-10 mt-7 pt-1">
      {[left, right].map((label) => (
        <div key={label} className="flex-1 max-w-[62mm]">
          <div className="h-8" />
          <p className="border-t border-black/60 pt-1 text-[10px] text-black/70">{label}</p>
        </div>
      ))}
    </div>
  )
}
