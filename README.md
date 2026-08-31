# HUEREX GFES

**Garment Factory Execution System — with per-garment costing.**

A web app built from the HUEREX GFES V5.1 workbook, with the thing the
spreadsheet never had: an answer to *what did this garment actually cost to
make, and how does that sit against the price we quoted?*

Every order, colour, size, transaction, buyer and master list from the workbook
is imported on first run.

---

## Running it

```bash
npm install
npm run dev
```

- app → <http://localhost:5273>
- api → <http://localhost:5274>

The first start imports the workbook into `data/huerex.json`. Nothing else to
set up — no database server, no accounts, no cloud.

```bash
npm test          # engine checks: the costing maths and the reconciliation identity
npm run build     # production bundle
npm start         # serve the built app and the api from one process, port 5274
npm run seed      # rebuild data/huerex.json from the workbook (discards live data)
```

---

## The costing model

Three quantities drive everything, and keeping them apart is the whole point.

| | what it is |
|---|---|
| **Ordered** | what the buyer asked for |
| **Shipped** | ordered **+ excess** — excess leaves the gate too, and the percentage differs buyer to buyer |
| **Produced** | shipped, grossed up for the pieces expected to fail checking — a rejected garment still ate fabric, thread and a sewing seat |

```
excess     = ordered × excess%                      (buyer's figure, overridable per order)
shipped    = ordered + excess
produced   = ceil(shipped ÷ (1 − rejection%))
invoiced   = ordered + (buyer pays for excess ? excess : 0)
```

**Materials and making are charged on `produced`. Revenue is charged on
`invoiced`.** When the buyer does not pay for the excess, those free pieces come
straight out of the margin — the app puts a number on that instead of hiding it.

### Cost heads

| Head | How it is built |
|---|---|
| **Fabric** | `kg × ₹/kg`. Kilograms come from grams-per-garment × produced, plus wastage %. The ₹/kg is built up from **yarn + knitting + dyeing + finishing + other**, or overridden with a single landed rate. |
| **Trims** | `qty per garment × ₹/unit × (1 + wastage%)`, per trim item and supplier. |
| **Job work** | `₹/pc × produced × coverage`, per process **per vendor**. |
| **CMT** | Cutting, fusing, sewing, ironing, checking, packing and anything else — a flat `₹/pc`, or `SAM minutes × ₹/minute`. |
| **Other costs** | Sampling, lab tests, documentation, transportation, inspection fees, commission — as a lump sum for the order, a rate per piece, or a percentage of cost. |

### What comes out

- **Cost per garment** — total cost ÷ shipped pieces. The honest per-garment figure.
- **Break-even price** — total cost ÷ invoiced pieces. Below this the order loses money.
- **Contribution per piece**, **order margin**, **margin %**.
- **What the free excess costs you**, in rupees and in margin points.
- **What the rejection allowance costs you**.
- **Planned against actual** — the same costing re-priced on the pieces really
  cut and the kilograms really issued, so a quote can be held next to reality.

---

## Rates that vary the way real rates vary

Order A does not have to cost what order B costs, and the rate book is built
around exactly that. Every rate is filed under **what actually makes it vary**:

| Rate | Filed under |
|---|---|
| Yarn, knitting, finishing | the **fabric** |
| Dyeing | the **colour** |
| Printing, embroidery, wash, tie & dye | the **process, vendor and style** |
| CMT operations | the **operation and style** |
| Trims | the **item and supplier** |
| Other costs | the **cost head and buyer** |

So two orders in the same fabric share a knitting rate automatically, while
their dyeing rates stay independent because the colours differ — and a printing
rate quoted for one style never silently follows another.

The rate book **fills itself**: save a costing and every rate in it is
remembered, then offered back the next time a matching order is costed, with
its provenance ("₹60 from HR-002, used 4×").

## As little typing as possible

Opening a costing for an order that has already been through the floor gives
you, without anyone typing a thing:

- **fabric lines** from what was actually cut — including the piece weight
  somebody weighed on the cutting table, which is where grams-per-garment
  comes from;
- **job work lines** from the processes and vendors the order really went to,
  with coverage worked out from the quantities sent;
- **CMT lines** from the in-house steps in that order's own route;
- **every rate** the rate book already knows.

What is left to type is the number nobody has recorded yet. There is also
**Copy from…** to start from another order's costing wholesale.

## Type to search, type to add

Every field that asks for a colour, vendor, fabric, trim, style, buyer, size,
line or person is the same component: type to filter what is known, or type
something new and it offers to remember it. New values are saved to masters
immediately and are in the list for everyone from then on.

Each option carries its own history — how many rows use it and which order it
appeared on last — so a near-duplicate (`OFF WHITE` next to `OFF-WHITE`) is
obvious before somebody creates it.

On the transaction pages the colour and size fields read the order picked in the
same row and float **that order's own** colours and sizes to the top.

---

## What came across from the workbook

Everything, and in a few places more than the spreadsheet could manage:

- **Route** — each order's real sequence. Sewing before tie & dye, fusing after
  sewing, a process twice: all allowed. Every WIP bucket is filled by whatever
  step comes before it in *that order's* route.
- **WIP** — awaiting fusing, awaiting job work, at a job work vendor, ready for
  sewing, in sewing, awaiting checking, in rework, awaiting packing, packed but
  not shipped. One row per order, colour and size, with ageing.
- **The rule that must never break** — `Cut = Shipped + Rejected + WIP`,
  reconciled per order, with a data audit that names the entry behind a gap.
- **14 alerts** — overdue, shipment risk, approval block, fabric waiting, trims
  block, at job work, aged WIP, over-cut, recut pending, sewing behind, DHU
  high, inspection block, set pair gap, fabric wastage. Management can accept a
  delay: the alert is **suppressed until the date they set**, never deleted.
- **Set control** — a two-piece set only ships when both halves ship.
- **Order timeline** — milestones, stage durations, and a cycle time that runs
  while the order is open and freezes when it ships.

**Fixed on the way across:** the workbook hard-coded five outsourced processes
and silently dropped anything else, so a Rotary AOP step had nowhere to land.
Any process named in a route now works, whoever does it.

---

## How it is built

```
server/          Express API over a single JSON file
  store.ts         atomic writes (temp file + rename), debounced
  seed.ts          imports the workbook
  index.ts         REST: rows, masters, settings, backup, restore
data/
  workbook-seed.json   what a person actually typed into GFES V5.1
  huerex.json          the live database (gitignored)
src/
  lib/engine/      pure TypeScript, no React — the part worth trusting
    production.ts    route-aware WIP, reconciliation, timelines
    alerts.ts        the 14 checks
    sets.ts          set pairing
    costing.ts       quantities, cost heads, rate memory, plan vs actual
  components/      design system, SmartCombo, DataGrid, LogTable, AppShell
  pages/           one page per part of the factory
tests/           engine checks, run with `npm test`
```

The client holds the whole dataset in memory and **derives every figure from
it**, so a number can never drift from the entry behind it. The derivation
engine is pure functions over plain data — which is why it can be tested
without a browser.

### The database is a file

`data/huerex.json`. Copy it and you have a complete backup; **Settings →
Download a backup** does the same through the browser. Writes land atomically,
so a power cut cannot leave it half-written.

For a team on one network, run `npm run build && npm start` on one machine and
point the others at `http://<that-machine>:5274`.

---

## Design

Light by day, graphite by night, with the theme following the system unless you
choose. Numbers are tabular everywhere so a column of quantities lines up on the
decimal point. Money is grouped the Indian way (₹1,23,456.78). Cream cells are
typed into; grey ones are calculated — the same convention the workbook used,
because the team already reads it.

`⌘K` opens the command palette from anywhere: jump to an order, a costing, or
any page.
