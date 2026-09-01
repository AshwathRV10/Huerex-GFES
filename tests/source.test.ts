/**
 * Checks made by reading the source.
 *
 * Two things that type-check perfectly, pass every other test, and still break
 * the app for somebody: a store selector that loops the renderer, and a
 * dependency on a server out on the internet.
 *
 * ── Selectors ──
 * A selector that builds a value instead of picking one out is a screen that
 * goes white. `useStore((s) => s.data.matrix.filter(...))` hands back a new
 * array every time it runs; React compares it with the last one, sees a
 * difference, re-renders to catch up, gets another new array, and does that
 * until it gives up with "Maximum update depth exceeded". The user gets a blank
 * page and no idea why. The same is true of `?? []` — the literal is new each
 * time — which is what the shared `NONE` constant in the store is for.
 *
 * Nothing else catches this: it type-checks perfectly and the engine tests never
 * render a component. So it is checked here, by reading the source.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(__dirname, '..', 'src')

let failures = 0
const check = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
  if (!pass) failures++
}

/** Every .ts/.tsx file under src. */
function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sources(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

/**
 * Comments out, so an example of the mistake written in prose — like the one
 * explaining `NONE` in the store — is not reported as the mistake itself.
 */
function codeOnly(text: string): string {
  return text
    // Keep the line count intact so reported line numbers still point at the code.
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_, before) => before)
}

/** The text between the parentheses of each `useStore(...)` call in a file. */
function selectorBodies(text: string): { body: string; line: number }[] {
  const found: { body: string; line: number }[] = []
  const needle = 'useStore('
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    let depth = 0
    let end = at + needle.length - 1
    for (; end < text.length; end++) {
      if (text[end] === '(') depth++
      else if (text[end] === ')' && --depth === 0) break
    }
    found.push({
      body: text.slice(at + needle.length, end),
      line: text.slice(0, at).split('\n').length,
    })
  }
  return found
}

/* Building a new array or object is the whole problem. `.find` is fine — it
 * returns an element already in the store, or undefined. */
const BUILDS_SOMETHING = /\.(filter|map|sort|slice|concat|flatMap|reverse)\s*\(/
const FRESH_LITERAL = /\?\?\s*(\[\s*\]|\{\s*\})/

const offences: string[] = []
for (const file of sources(SRC)) {
  const text = codeOnly(fs.readFileSync(file, 'utf8'))
  for (const { body, line } of selectorBodies(text)) {
    const why = BUILDS_SOMETHING.test(body) ? 'builds a new array'
      : FRESH_LITERAL.test(body) ? 'falls back to a fresh literal — use NONE'
      : null
    if (why) {
      offences.push(`${path.relative(SRC, file)}:${line} ${why}\n      ${body.trim().slice(0, 100)}`)
    }
  }
}

check(
  'no store selector builds a new value on every call',
  offences.length === 0,
  offences.length ? `\n    ${offences.join('\n    ')}` : `checked ${sources(SRC).length} files`,
)

/* The shared constant the fallbacks depend on must actually be shared. */
const store = fs.readFileSync(path.join(SRC, 'lib', 'store.ts'), 'utf8')
check(
  'the store exports one shared empty array for fallbacks',
  /export const NONE\b/.test(store),
)

/* ── Nothing may be fetched from the internet ──────────────────────────
 *
 * The fonts used to come from Google on every page load, so a factory with no
 * internet lost the typography the number columns are aligned against. They now
 * ship with the app. This keeps it that way: one <link> to a CDN put back by
 * habit would undo it silently, and only somebody offline would ever notice.
 */
const OFFSITE = /(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com)/

const shipped = [
  path.resolve(SRC, '..', 'index.html'),
  ...sources(SRC),
]
const external = shipped
  .filter((file) => OFFSITE.test(codeOnly(fs.readFileSync(file, 'utf8'))))
  .map((file) => path.relative(path.resolve(SRC, '..'), file))

check(
  'nothing the browser loads comes from another server',
  external.length === 0,
  external.length ? external.join(', ') : 'fonts and assets are all served by this app',
)

/* The font files themselves must actually be there to serve. */
const FONTS = path.resolve(SRC, '..', 'public', 'fonts')
const woff2 = fs.existsSync(FONTS) ? fs.readdirSync(FONTS).filter((f) => f.endsWith('.woff2')) : []
check(
  'the typefaces ship with the app',
  woff2.length >= 4,
  woff2.length ? woff2.join(', ') : 'public/fonts is empty — the app would fall back to system fonts',
)

/* Every face the stylesheet asks for must exist, or it silently falls back. */
const fontCss = fs.readFileSync(path.join(SRC, 'styles', 'fonts.css'), 'utf8')
const referenced = [...fontCss.matchAll(/url\('\/fonts\/([^']+)'\)/g)].map((m) => m[1])
const missing = referenced.filter((name) => !woff2.includes(name))
check(
  'every @font-face points at a file that exists',
  referenced.length > 0 && missing.length === 0,
  missing.length ? `missing: ${missing.join(', ')}` : `${referenced.length} faces, all present`,
)

console.log(failures === 0 ? '\nAll source checks passed.' : `\n${failures} check(s) FAILED.`)
process.exitCode = failures === 0 ? 0 : 1
