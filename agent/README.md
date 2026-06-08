# Listings Agent

An automated **ingest → scrutinise → source → rank** pipeline for property
listings (residential + warehouse) that arrive by email. It turns the raw
"new listing" alerts in your inbox into a ranked, diligence-checked shortlist
shown in the dashboard's **Listings** tab — and a Slack digest you approve.

Everything is **human-in-the-loop**: the agent drafts and ranks, you click to
shortlist/pass. Nothing is sent or actioned on your behalf without approval.

## How it works

```
 raw listing emails (JSON)
        │
        ▼
 parse.mjs        extract price / beds / baths / sqft / address / broker / url
        │
        ▼
 scrutinize.mjs   red-flag checks: over budget? too small? wrong area?
        │         missing data? duplicate? stale?   → flags[]
        ▼
 rank.mjs         weighted 0–100 score + recommendation (Strong / Look / Skip)
        │
        ▼
 ingest.mjs       merge into data/listings.json (dedupe, keep your decisions)
        │         + print a Slack-ready digest to stdout
        ▼
 dashboard "Listings" tab   ranked cards · scrutiny flags · Shortlist / Pass
```

The single file to tune is **`preferences.mjs`** — budgets, target areas,
min beds/sqft, and the scoring weights. Everything downstream follows from it.

## Run it

```bash
# 1) process the seeded sample inbox (real listings pulled from Gmail)
node agent/ingest.mjs

# 2) process your own export
node agent/ingest.mjs path/to/emails.json
cat emails.json | node agent/ingest.mjs -
```

Input is a JSON array of email objects shaped like the Gmail API / MCP
`get_thread` messages:

```json
{ "id": "...", "sender": "...", "subject": "...", "date": "...",
  "snippet": "...", "plaintextBody": "..." }
```

`ingest.mjs` is pure and idempotent: re-running re-scores everything and
**preserves your Shortlist/Pass decisions** (matched by listing key).

### Enrichment (`--enrich`)

Alert emails carry only price/beds/baths/sqft, so furnishing and amenities
start blank. `node agent/ingest.mjs --enrich` opens each listing URL and fills
those in from the page. It's **best-effort and never fails the run**:

- **Zillow bot-blocks server-side fetches** (HTTP 403), so plain enrichment
  won't work on Zillow links. Blocked listings keep their "unknown" state and
  record the reason under `enrichment`.
- Works best on broker pages / Apartments.com and anywhere a normal GET
  returns the listing HTML.
- For bot-blocked sources the fallbacks are: Claude's `WebFetch` per listing,
  a headless browser, or a scraping API (e.g. ScraperAPI / Bright Data).
- The deploy environment must also allow outbound HTTP (network policy).

## Getting emails in (the trigger)

The pipeline is decoupled from *how* emails are fetched, so you can pick the
trigger that fits. Simplest → most automated:

1. **Manual / Claude-driven (today).** Claude searches Gmail
   (`from:zillow.com OR from:apartments.com … newer_than:7d`), writes the
   results to `agent/inbox.json`, runs `ingest.mjs`, and drafts the Slack
   digest for your approval. Zero infrastructure.
2. **Gmail filter + scheduled fetch.** A Gmail filter labels listing emails
   (e.g. `Listings/Inbox`); a small scheduled job exports that label to JSON
   and runs the pipeline. Options that need no always-on server:
   - **Google Apps Script** (time-driven trigger) — reads Gmail, can also
     write a Google Sheet and ping Slack. Closest to your "Sheets in the loop"
     idea; swap `data/listings.json` for the Sheet behind the same interface.
   - **GitHub Actions** (cron) — fetches via the Gmail API, runs `ingest.mjs`,
     commits the updated `data/listings.json`, which redeploys the dashboard.
   - **Vercel Cron** — calls a serverless function (alongside `api/zoho.js`).
3. **Real-time (later).** Gmail push notifications (Pub/Sub) → serverless
   endpoint → pipeline. Needs more setup; only worth it if minutes matter.

## Files

| File | Role |
|------|------|
| `preferences.mjs` | **Your criteria** — budgets, areas, min size, weights. Tune this. |
| `parse.mjs`       | Email → structured listing (source-aware + generic regex). |
| `enrich.mjs`      | Opens the listing URL to fill furnishing/amenities (`--enrich`). |
| `scrutinize.mjs`  | Diligence checks → flags + which track (residential/warehouse). |
| `rank.mjs`        | Weighted 0–100 score + recommendation. |
| `ingest.mjs`      | Orchestrator + store writer + Slack digest. |
| `inbox.json`      | Seeded sample input (real listings from the inbox). |
| `../data/listings.json` | The store the dashboard reads. |
