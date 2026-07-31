# Invoice / PO Parsing Pipeline (Google Apps Script) — Free Tier Build

Watches the **V3 Invoices-PO-Scan** Drive folder, extracts key fields from
POs, invoices, and scans, validates the results, and writes them to a tracker
spreadsheet. Humans only touch flagged exceptions — no manual data entry.

**This build runs on $0:** Zoho POs are parsed deterministically (no AI, no
API calls, 100% accurate on the standard layout), and invoices/scans use the
**Gemini API free tier**. Apps Script, Drive, and Sheets are free at this
volume.

## Architecture

```
Drive: V3 Invoices-PO-Scan/
├── POs/            → deterministic Zoho-PO text parse (0 API calls)
│                     └ falls back to Gemini only for non-Zoho POs
├── Invoices-PDF/   → Gemini free tier (1 call per document)
└── Scans/          → Gemini free tier (1 call per document)
        each lane: inbox → Processed/ or Failed/

           ↓ every 15 min (time-driven trigger)

Validation: arithmetic (subtotal − discount + tax = total) → duplicate check
            → Zoho PO cross-check (via the dashboard's Vercel proxy)

           ↓

Sheet: Register (all rows) · Review (live filter of flagged rows) · Log
```

Row statuses:

| Status | Meaning |
|---|---|
| `AUTO-ACCEPTED` | Enough independent checks passed. No action needed. |
| `REVIEW` | A check failed or was unavailable. Appears on the Review tab until its **Verified** checkbox is ticked on the Register. |
| `DUPLICATE` | Same vendor + document number already ingested. |
| `FAILED` | Extraction errored; file moved to `Failed/`. |

Auto-accept policy: totals below `HIGH_VALUE_THRESHOLD` (₹1,00,000 by
default) need **one** passing cross-check; totals at or above it need
**two**. A deterministic parse of a known format counts as a check. Tune in
`Config.gs`.

## Free-quota protection (why this won't burn your Gemini limit)

Google cut free-tier quotas sharply in Dec 2025 and can change them without
notice — the only authoritative limits for YOUR key are shown in
[Google AI Studio](https://aistudio.google.com/). The script therefore
defends the quota by design:

- **POs never call the API.** The deterministic parser handles the standard
  Zoho layout (validated on 50 real POs with zero errors).
- **Exactly one Gemini call per document.** No dual reads, no automatic
  retries. A parse failure goes to `Failed/` + Review, not a re-spend.
- **Self-imposed daily budget** (`GEMINI.DAILY_BUDGET`, default 150/day,
  reset at midnight Pacific like Google's). Set it below your key's real
  RPD limit. When reached, processing pauses; files wait in the inbox.
- **Pacing** (`MIN_MS_BETWEEN_CALLS`, default 7s) keeps requests far under
  the free RPM limit.
- **A real 429 stops the run immediately** — the file stays in the inbox and
  is retried automatically after quota resets. Nothing is lost, nothing is
  wasted on retries.
- **`testGeminiSetup()` validates your key and model using ListModels**,
  which does not consume generation quota. `pingGemini()` (optional) spends
  exactly 1 request to prove end-to-end generation.

**Free-tier trade-off to be aware of:** on the Gemini API free tier, Google
may use submitted content to improve its products. Your invoices (not the
POs — those never leave Drive) are subject to those terms. If that ever
becomes unacceptable, enabling billing on the Google project switches the
same code to paid terms (no training) with no code change.

## Deploy (one time, ~15 minutes)

1. **Tracker spreadsheet** — already created: "V3 Invoice-PO Tracker" in the
   V3 Drive folder (ID `101XI1E4HZ4hHdArtAtfR1laIeHp2OvHmiM6AWAHqTcs`),
   pre-filled with 50 backfilled POs. **Rename its first tab to `Register`**
   (exact spelling) before running setup.
2. **Gemini key** — go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey),
   sign in with your Google account, **Create API key**. No card needed.
   While you're there, note the rate limits shown for your key.
3. Go to [script.google.com](https://script.google.com) → **New project**.
   In **Project Settings**, tick **Show "appsscript.json" manifest file**.
4. Create one file per `.gs`/`.json` file in this folder and paste the
   contents in.
5. **Project Settings → Script properties** — add:

   | Property | Value | Required |
   |---|---|---|
   | `SPREADSHEET_ID` | `101XI1E4HZ4hHdArtAtfR1laIeHp2OvHmiM6AWAHqTcs` | ✅ |
   | `GEMINI_API_KEY` | from step 2 | ✅ |
   | `ZOHO_PROXY_URL` | `https://<your-dashboard>.vercel.app/api/zoho` | optional |
   | `ALERT_EMAIL` | defaults to your own address | optional |

6. Run **`testGeminiSetup`** from the editor toolbar (approve the consent
   screen when asked). Check the execution log: it confirms the key works
   and the configured model is available — **without spending any quota**.
   If the model isn't listed, pick one from the logged Flash list and update
   `CONFIG.GEMINI.MODEL`.
7. Run **`setup`**. This creates the Review/Log tabs, adds the Verified
   checkboxes, and installs the triggers (processing every 15 min, summary
   email at 8am).
8. Drop a test file in and either wait ≤15 min or run `processInbox`
   manually.

## Daily operation

- Drop files into the right inbox folder (use the Drive app's **Scan** mode
  for paper documents — auto-crop/deskew materially improves accuracy).
- ZIPs are auto-expanded into individual files. **Do not upload page-split
  zips** (e.g. ilovepdf "extract pages") — continuation pages of multi-page
  documents arrive as separate incomplete files.
- Processed files move to `Processed/`, broken ones to `Failed/`.
- Clear the **Review** tab when the daily email says there's a backlog:
  compare the row against the linked file, fix any wrong cell on the
  Register, tick **Verified**.

## Costs and limits

- **₹0.** Everything runs on free tiers.
- Throughput governor is the Gemini daily budget (default 150 docs/day
  through the AI lanes) — POs don't count against it. Raise the budget in
  `Config.gs` only after checking your key's real limits in AI Studio.
- Apps Script quotas (trigger runtime, URL fetches, email) are far above
  this workload.

## Known limitations (v1)

- Document-level fields only (vendor, numbers, dates, totals) — no line
  items yet; that's phase 2 (matching against the Design Tracker BOM via
  Mfr Part Number / Internal Part Number).
- One document per file is assumed; multi-document files are flagged.
- Free-tier extraction (Gemini Flash) is a notch below paid frontier models
  on messy photos — expect a somewhat larger share of photo documents to
  land in Review. Arithmetic + Zoho checks catch most misreads.
- Free-tier limits are Google's to change; if the pipeline pauses with
  "QUOTA STOP" in the Log tab, it resumes automatically after the daily
  reset. Lower `DAILY_BUDGET` if this happens often.
