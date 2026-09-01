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

The first start imports the workbook into `data/huerex.json` and asks you to
create the administrator account. Nothing else to set up — no database server,
no cloud, and nothing fetched from the internet at runtime: the two typefaces
ship with the app, so a machine that has never been online looks identical to
one that has.

```bash
npm test          # the costing maths, the reconciliation identity, access control, live sync
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

## The entry row keeps what repeats

Twenty cutting lines for one order differ only in size and quantity. So after
each entry the row keeps the date, the order, the colour and the fabric, and the
cursor lands on the size — the field that actually changes. Two values typed per
line instead of five.

What is kept is tinted until you touch it, so an inherited value is never
mistaken for one somebody meant to type, and the previous value shows greyed in
the box, ready to be typed over.

**Quantities and free text never carry.** A stale colour is obvious on sight; a
stale quantity looks exactly like a real one, and posting 62 pieces twice is a
worse problem than the typing it saved. The same goes for a delivery challan
number or a remark — repeated onto the next row it is not a shortcut, it is a
false record. Where a reference genuinely does repeat, like a shipment's invoice
number across its cartons, the page says so explicitly.

## Documents that leave the building

Two things get printed, from the browser's own print dialogue — which gives
paper for the vendor and **Save as PDF** for the email, from one implementation,
with no library and no internet.

**The job work challan.** Give a movement a challan number on the Job work sheet
and it becomes a document: the lines sharing that number, in size order, with
quantities, the process, the order, and space for two signatures. The number
carries down the block as you type, the way the sheet's ditto marks used to
mean. The eight numbers already written into the workbook's remarks column
(`DC: 152`, then `"` down the block) are lifted into their own field on import,
so old despatches print correctly too.

**The cost sheet.** Quantities, every cost head with the rate behind it, the
cost of one garment and how that sits against the price quoted. It is behind
`costing.export` — checked on the server, not only in the browser — and every
sheet printed is written to the audit log with who took it and for which order.
A modest costing fits one A4 page; a long one runs to two, and the break falls
before the conclusion so the second sheet is the answer and the signatures
rather than four stray rows.

The letterhead comes from **Settings → Your factory** and is never filled in for
you. A challan carrying a made-up name or GSTIN would be worse than one with a
blank space where the real thing goes.

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

## Who can see what

Costing is the commercially sensitive part of this system, so access to it is a
permission and not a screen you happen not to click on.

**Roles ship configurable, and five come set up:**

| role | what it is for |
| --- | --- |
| Administrator | everything, including accounts and roles. Cannot be reduced or deleted — a factory locked out of its own system has no way back in. |
| Merchandiser | orders, production and **costing**: rates, prices, margins. |
| Planner | orders, production and materials. No costing. |
| Floor | logs what was cut, sewn, checked, packed. Nothing else. |
| Viewer | reads. Changes nothing. No costing. |

Permissions are per module, per screen and per action — view, create, edit,
approve, export, delete — and every one of them can be moved between roles from
**People → Roles**.

### Enforced on the server, not by hiding buttons

Restricted data never reaches the browser in the first place. A Floor operator's
copy of the state does not contain the costings, the rate book, the selling
price on an order, or the buyer's payment terms — not hidden in it, *not in it*.
Typing the URL of a costing page, calling the API directly, or reading what came
over the wire all give the same nothing.

The same filter applies to the live stream: when a merchandiser edits a quote,
people without costing access are not notified that anything happened, and when
they are told an order changed, the price is stripped from the row they receive.

`tests/security.test.ts` boots the real server and proves this — 58 checks,
including grepping the raw response body for the withheld figures rather than
trusting a parsed field.

### The audit log

Every sensitive action is recorded with who, when, what record, and the values
before and after: sign-ins and failed sign-ins, refused access attempts, costing
and rate changes, price changes, account and role changes, backups, restores and
resets. It is append-only — nothing in the application deletes from it — and
password hashes and session tokens are stripped before anything is written.

### Accounts

Passwords are stored as scrypt hashes with a per-account salt, compared in
constant time. Sessions are random tokens of which only the hash is kept, in
httpOnly cookies, expiring after 12 hours or 4 idle. Repeated failed sign-ins
are throttled. An unknown username and a wrong password give the same answer, so
the login page cannot be used to find out who has an account.

Changing somebody's role or deactivating them takes effect immediately: their
open sessions end and the tab they are sitting in front of asks them to sign in
again.

### Two people, one row

Everyone sees everyone else's entries as they are made, and who is online. A
costing carries the revision it was opened at, so if two people have the same
one open the second save is refused rather than silently overwriting the first —
you are shown their version and asked which to keep.

---

## How it is built

```
server/          Express API over a single JSON file
  store.ts         atomic writes (temp file + rename), debounced
  seed.ts          imports the workbook
  index.ts         REST: rows, masters, settings, backup, restore
  auth.ts          scrypt passwords, sessions, sign-in throttling
  rbac.ts          the permission catalogue and the roles that ship
  redact.ts        strips restricted collections and fields per request
  audit.ts         append-only log with before/after values
  events.ts        the live stream, filtered per person
  backup.ts        the nightly copy: schedule, retention, catch-up
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
    PrintDocument    the A4 frame and letterhead both documents share
  styles/fonts.css   the two typefaces, served from this machine
  pages/           one page per part of the factory
public/fonts/    Inter and JetBrains Mono, so nothing is fetched from Google
tests/
  costing.test.ts     the cost maths
  production.test.ts  the reconciliation identity, against real data
  source.test.ts      read the source: no looping selectors, no offsite fetches
  security.test.ts    access control, driven through the real HTTP server
  backup.test.ts      that the nightly copy is worth having, and says so if not
  livesync.test.ts    two people, two sessions, one server
```

The client holds the whole dataset in memory and **derives every figure from
it**, so a number can never drift from the entry behind it. The derivation
engine is pure functions over plain data — which is why it can be tested
without a browser.

## Running it in the factory

One machine holds the data; everybody else opens it in a browser. Nothing else
is needed — no server room, no monthly bill, no internet.

```bash
npm run build
npm start                       # port 5274
```

Everyone else goes to `http://<that-machine>:5274` and signs in with their own
account. What each of them can see is decided by their role, on that machine,
before anything is sent.

Worth doing on the machine that holds it: set it to start `npm start` on boot
(Task Scheduler on Windows, a systemd unit on Linux) so a power cut does not
quietly leave the factory without its system, and give it a fixed address on
your network so the bookmark keeps working.

### Reaching it when you are not there

Do **not** forward a port on the office router. That publishes the factory's
costings to the whole internet and leaves a login page as the only thing
between them and anybody who finds it.

Install [Tailscale](https://tailscale.com) on the office machine and on your
laptop or phone, sign both into the same account, and the office machine gets a
private address only your own devices can reach. Then
`http://<that-address>:5274` works from anywhere, over an encrypted link, with
nothing exposed publicly and nothing to pay for a handful of devices. The app
needs no changes and no port opened.

If the day comes that the whole team needs it from outside, that is when a real
server and a certificate are worth the trouble — and the app is ready for it: a
request arriving over TLS gets a `Secure` cookie by itself.

### Backups happen on their own

A dated copy of the database is written every day, to a folder you choose in
**Settings → Automatic backup** — nine at night by default, keeping the last 30.

Point it at something that is not the same disk: a second drive, a NAS share, a
synced folder. A copy beside the original protects you from a mistake but not
from the failure that actually happens, which is the disk itself.

- If the machine was off at the appointed hour, the missed copy is taken shortly
  after it next starts. A night is not skipped because nobody was there.
- If the folder cannot be written to — the drive unplugged, the share gone — the
  Settings page says so in as many words. **A backup silently not happening is
  worse than no backup at all, because somebody believes they have one.**
- Every file operation is asynchronous and gives up after a minute, so a network
  share whose machine has gone away cannot freeze the app for the whole factory.
- The file holds every price, rate and margin in plain text, so it is written
  readable only by the account running the app. Treat that folder like the
  costing sheet it is.
- Password hashes and session tokens are never in it. A restore therefore keeps
  the accounts that exist rather than bringing old ones back.

### The database is a file

`data/huerex.json`. Copy it and you have a complete backup — which is exactly
what the nightly job does, and what **Settings → Download a backup** does
through the browser. Writes land atomically, so a power cut cannot leave it
half-written.

---

## Design

Light by day, graphite by night, with the theme following the system unless you
choose. Numbers are tabular everywhere so a column of quantities lines up on the
decimal point. Money is grouped the Indian way (₹1,23,456.78). Cream cells are
typed into; grey ones are calculated — the same convention the workbook used,
because the team already reads it.

`⌘K` opens the command palette from anywhere: jump to an order, a costing, or
any page.
