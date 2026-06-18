# Warehouse Agent — Brooklyn (Google Apps Script)

The warehouse sibling of the residential **Listings Agent** (kept on its own
branch, `claude/nifty-wright-GxqKL`). Same always-on machine — it lives in your Google account, reads Gmail on a schedule
(no servers, no keys to store), scrutinises + ranks each **industrial /
warehouse** listing, and writes a colour-coded **Google Sheet** with a
three-way verdict:

- ✅ **Shortlist** — meets every must and scores well
- 🟡 **Worth a look / Weak fit** — meets musts, middling
- ⚠️ **Great, needs a compromise** — fails ONE must but is otherwise excellent
  (e.g. *"Strong otherwise — compromise: $55/SF/yr is over your $42 ceiling"*)
- 🚫 **Doesn't fit** — fails a must and isn't compelling (the "negate" case)

It's tuned for **Brooklyn industrial space**: it gates on the borough's
submarkets and scores on the things that matter for a warehouse — **size (SF),
$/SF/yr (or sale price), clear height, loading (dock-high + drive-in), zoning
(M1/M2/M3), power and features** — instead of beds/baths.

Tune everything in **`Preferences.gs`**.

## Setup (~3 minutes, once)

### A. Create the project
**Option 1 — paste (simplest):**
1. Go to **script.google.com → New project**. Name it **"Warehouse Agent"**.
2. Create files matching this folder and paste each in: `Preferences.gs`,
   `Parser.gs`, `Scoring.gs`, `Enrich.gs`, `Code.gs`. Then **Project Settings →
   check "Show appsscript.json"** and paste `appsscript.json`.

**Option 2 — push with [clasp](https://github.com/google/clasp):**
```bash
npm i -g @google/clasp
clasp login
cd appscript-warehouse
clasp create --type standalone --title "Warehouse Agent"
clasp push
```

### B. Run it
1. In the editor, select **`setup`** → **Run**. Approve the permissions prompt
   (Gmail read-only, Sheets, external requests). It creates the spreadsheet —
   open the URL from the execution log (**View → Logs**).
2. Select **`runWarehouseAgent`** → **Run**. Your inbox listings populate the Sheet.
3. Select **`createTrigger`** → **Run**. It now runs **every 15 minutes**, forever.

### C. (Optional) Slack
Create an [Incoming Webhook](https://api.slack.com/messaging/webhooks), then in
the editor run `setSlackWebhook('https://hooks.slack.com/services/…')` once.
New listings get posted as a ranked 🏭 digest each run.

### D. (Optional) Drive-time scoring
Want listings scored on driving time to your hub / a port / a highway ramp? Set
a Script Property **`DRIVE_DEST`** (Project Settings → Script Properties) to a
destination address. The `Drive` column then shows minutes and feeds the score.
Leave it unset to keep drive scoring dormant.

## Where the listings come from

`Code.gs`'s `SENDER_QUERY_` watches the commercial portals and the obvious
subjects:

> from **loopnet.com, crexi.com, cityfeet.com, commercialcafe.com, biproxi.com,
> brevitas.com, ten-x.com, showcase.com** — or any mail whose subject mentions
> *warehouse / industrial / flex space / for lease / for sale / listing*.

Set up **saved-search alert emails** on LoopNet and Crexi for *Industrial,
Brooklyn, your size range* and the agent does the rest. (Per-listing alerts
parse most cleanly; saved-search digests are split per property where possible.)

## Specs not in the email? (enrichment)

Alert emails carry size and a rate but rarely clear height / docks / zoning /
power. When those are blank and a link exists, `Enrich.gs` opens the listing
page and re-parses it. It tries:

1. **Firecrawl** (if key set) — clean markdown, handles JS + anti-bot; this is
   what reads **LoopNet/Crexi** reliably (they 403 a plain fetch). Free tier.
2. **Direct fetch** (free fallback, no key) — works on simple broker sites; the
   big portals block it.
3. **Manual fallback** — if both fail, the row keeps the `specs unknown` notes
   and the link, so you open that one yourself.

### Setting up Firecrawl (for LoopNet/Crexi)
1. Sign up at [firecrawl.dev](https://www.firecrawl.dev/) → copy your **API key**
   (starts with `fc-`).
2. In the editor, run once: `setFirecrawlKey('fc-your_key_here')`
3. Verify with `enrichTest('https://www.loopnet.com/Listing/…/')` and check
   **View → Logs** — you should see clear height / zoning / docks / features.

**Credit note:** Firecrawl bills ~1 credit per scrape. The agent only fetches
listings missing specs, caps fetches at `MAX_ENRICH_PER_RUN` per run, and never
re-fetches the same listing — so usage stays low.

> **ToS note:** scraping the portals is against their terms. Common for personal
> use, but your call. To avoid it entirely, set `ENRICH_ENABLED = false` and use
> the `specs unknown` flags to open the promising few by hand.

## What you tune in `Preferences.gs`
| Setting | Meaning |
|---------|---------|
| `idealRatePsfYr` / `maxRatePsfYr` | Lease budget in **$/SF/year** (target vs flexible ceiling). |
| `idealSalePrice` / `maxSalePrice` | If buying instead of leasing. |
| `minSqft` / `idealSqft` / `maxSqft` | Size band — under `minSqft` is a hard reject. |
| `minClearHeight` / `idealClearHeight` | Clear/ceiling height in feet. |
| `minDocks` | Loading expectation (0 = street-level only → soft flag). |
| `targetLocations` | Brooklyn submarkets + zips — **outside these is a must-violation**. |
| `preferredZoning` | NYC manufacturing districts (M1/M2/M3). |
| `features` | Desirable features → weight (dock-high, drive-in, heavy power, …). |
| `weights` / `thresholds` | Score blend and verdict cut-offs. |

## How it behaves
- **Dedupe:** processed message ids are remembered (Script Properties) and the
  Sheet's `Key` column is checked, so re-runs only append genuinely new listings.
- **Your decisions stick:** the `Status` column (New / Shortlist / Pass /
  Contacted) is a dropdown you edit; the agent never overwrites existing rows.
- **No Gmail modification:** scope is read-only; nothing is labelled, moved, or
  deleted.
- **Time-safe:** stops and saves before Apps Script's 6-minute limit; the next
  run picks up where it left off.

## Files
| File | Role |
|------|------|
| `Preferences.gs` | Your criteria — budget, size, clear height, loading, area, zoning, features, weights. |
| `Parser.gs`      | Gmail message → structured warehouse listing. |
| `Enrich.gs`      | "Click the link" — fetch the listing page for clear height / docks / zoning. |
| `Scoring.gs`     | Scrutinise → flags (must/warn/info), rank, three-way verdict. |
| `Code.gs`        | Gmail fetch, Sheet writing, Slack, triggers, setup. |
| `appsscript.json`| Manifest + OAuth scopes. |

> Mirrors the residential agent (same engine, dedupe, enrichment and verdict
> model) — this edition swaps the residential brain for a Brooklyn-industrial one.
