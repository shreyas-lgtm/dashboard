# Invoice / PO Parsing Pipeline (Google Apps Script)

Watches the **V3 Invoices-PO-Scan** Drive folder, extracts key fields from
POs, invoices, and scans using Claude (plus optional Document AI
cross-validation), validates the results, and writes them to a tracker
spreadsheet. Humans only touch flagged exceptions — there is no manual data
entry.

## Architecture

```
Drive: V3 Invoices-PO-Scan/
├── POs/            → Claude extraction (PO prompt)
├── Invoices-PDF/   → Claude extraction (invoice prompt)
└── Scans/          → Claude + Document AI dual read (when configured)
        each lane: inbox → Processed/ or Failed/

           ↓ every 15 min (time-driven trigger)

Validation: arithmetic check → duplicate check → dual-read agreement
            → Zoho PO cross-check (via the dashboard's Vercel proxy)

           ↓

Sheet: Register (all rows) · Review (live filter of flagged rows) · Log
```

Row statuses:

| Status | Meaning |
|---|---|
| `AUTO-ACCEPTED` | Enough independent checks passed. No action needed. |
| `REVIEW` | A check failed, disagreed, or was unavailable. Appears on the Review tab until its **Verified** checkbox is ticked on the Register. |
| `DUPLICATE` | Same vendor + document number already ingested. |
| `FAILED` | Extraction errored; file moved to `Failed/`. |

Auto-accept policy: totals below `HIGH_VALUE_THRESHOLD` (₹1,00,000 by
default) need **one** passing cross-check; totals at or above it need
**two** (e.g. arithmetic + Zoho match). Tune both in `Config.gs`.

## Deploy (one time, ~15 minutes)

1. **Tracker spreadsheet** — already created: "V3 Invoice-PO Tracker" in the
   V3 Drive folder (ID `101XI1E4HZ4hHdArtAtfR1laIeHp2OvHmiM6AWAHqTcs`),
   pre-filled with 50 backfilled POs. **Rename its first tab to `Register`**
   before running setup, so the script appends to it instead of creating a
   second empty tab.
2. Go to [script.google.com](https://script.google.com) → **New project**.
   Name it e.g. `Invoice Pipeline`.
3. In the editor, enable **Project Settings → Show "appsscript.json"**, then
   create one file per `.gs`/`.json` file in this folder and paste the
   contents in.
4. **Project Settings → Script properties** — add:

   | Property | Value | Required |
   |---|---|---|
   | `SPREADSHEET_ID` | ID from step 1 | ✅ |
   | `ANTHROPIC_API_KEY` | from console.anthropic.com | ✅ |
   | `ZOHO_PROXY_URL` | `https://<your-dashboard>.vercel.app/api/zoho` | optional |
   | `ALERT_EMAIL` | defaults to your own address | optional |
   | `DOCAI_PROJECT_ID` / `DOCAI_LOCATION` / `DOCAI_PROCESSOR_ID` | see below | optional |

5. Select the `setup` function in the toolbar and **Run** it. Approve the
   OAuth consent screen. This creates the Register/Review/Log tabs and
   installs the two triggers (processing every 15 min, summary email at 8am).
6. Drop a test file into one of the inbox folders and either wait for the
   trigger or run `processInbox` manually.

The Drive folder IDs are already baked into `Config.gs` for the
**V3 Invoices-PO-Scan** structure. If you ever recreate the folders, update
the IDs there.

### Optional: Document AI (second reader for Scans)

Without it the Scans lane still works — rows just rely on arithmetic +
Zoho checks, and low-confidence photos land in Review. To enable:

1. In Google Cloud Console: create/pick a project, enable the
   **Document AI API**, create an **Invoice Parser** processor, note its ID
   and location.
2. In Apps Script **Project Settings → Google Cloud Platform (GCP) Project**,
   attach that same project number.
3. Fill in the three `DOCAI_*` script properties.

(The `cloud-platform` OAuth scope in `appsscript.json` exists for this call.
If you'll never use Document AI you can remove that scope line to get a
smaller consent screen.)

### Zoho proxy note

The proxy's `purchaseorders` search is used read-only to fetch a PO's total
for cross-checking. Invoices are allowed to be *below* the PO total (partial
deliveries are normal) — only totals *exceeding* the PO get flagged.

## Daily operation

- Drop files into the right inbox folder (use the Drive app's **Scan** mode
  for paper documents — it auto-crops and deskews, and materially improves
  accuracy over raw camera photos).
- ZIP files dropped into an inbox are auto-expanded: PDFs/images inside land
  in the inbox as individual files, the archive moves to `Processed/`.
  **Do not upload zips of page-split exports** (e.g. ilovepdf "extract
  pages") — continuation pages of multi-page documents arrive as separate
  incomplete files. Upload whole per-document PDFs.
- Processed files move to `Processed/`, broken ones to `Failed/`.
- Open the **Review** tab when the daily email says there's a backlog:
  compare the row against the linked file, fix any wrong cell on the
  Register, tick **Verified**. The row disappears from Review.

## Costs and limits

- Claude: roughly $0.01–0.03 per document at current Sonnet pricing.
- Document AI: ~$0.10 per invoice processed (Scans lane only).
- Apps Script: 6-min execution cap per run — the script processes up to
  `MAX_FILES_PER_RUN` (5) files per 15-min tick, i.e. ~480 documents/day
  ceiling. Raise the trigger frequency or batch size if volume grows.

## Known limitations (v1)

- Extracts document-level fields only (vendor, numbers, dates, totals) —
  **no line items** yet. That's phase 2, and accuracy expectations drop when
  it lands.
- One document per file is assumed; multi-document files are flagged to
  Review, not split.
- Vendor names are normalized only lightly (for dedupe). True vendor
  matching against Zoho contacts is a phase-2 item.
