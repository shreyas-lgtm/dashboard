# IT Asset Tracker — Build & Migrate (your checklist)

This turns the design spec into a live, working tracker. Two files here:

- **`bootstrap.gs`** — the corrected Apps Script (all 6 bugs from the draft fixed; CONFIG pre-filled with your email, employees, categories; Asset Tags continue your `IT-####` series).
- **`hardware-import.csv`** — your **305 existing assets** already remapped into the exact column order the script's `Hardware` tab uses. Ready to paste/import.

Everything below marked **[You]** is done by you in the browser (the script must run under your Google login — I can't run it for you).

---

## Part 1 — Build the tracker (~5 min)

1. **[You]** Go to **https://script.google.com** → **New project**.
2. **[You]** Delete the default `function myFunction(){}`, then **paste the entire contents of `bootstrap.gs`**.
3. **[You]** (Optional) Skim the `CONFIG` block at the top — `ALERT_EMAIL` is already `shreyas@origin.tech`. Change if needed.
4. **[You]** In the toolbar, pick the function **`setup`** → click **Run**.
5. **[You]** A Google auth dialog appears → **Review permissions** → choose your account → **Advanced → Go to (project) → Allow**. (It asks for Sheets/Forms/Gmail/Triggers access — that's the form creation, the daily email, and the edit-logger.)
6. **[You]** Open **View → Execution log**. It prints two links: the **Spreadsheet** and the **Form**. Open the Spreadsheet.

You now have a working tracker: tabs for Hardware, Software Subscriptions, History (hidden), Asset Lookup, Dashboard, Employees — plus a daily 8 AM alert and an edit-logger.

---

## Part 2 — Load your 305 existing assets (AUTOMATED, ~1 min)

The form only *creates* new assets one at a time. Your existing 305 are bulk-loaded by a
built-in function — **no CSV, no copy-paste.**

1. **[You]** Back in the Apps Script editor, pick the function **`importFromRegister`** from the
   dropdown → click **▶ Run**.
   - It reads the "IT Asset Register — FULL" sheet already in your Drive and writes all 305
     rows straight into the Hardware tab. Existing `IT-####` tags are preserved (it does NOT
     go through the form, so nothing gets renumbered). Re-running it is safe (it clears and
     re-imports).
2. **[You]** Open the **Dashboard** tab → should show ~**305 total assets** and
   **Total inventory value ≈ ₹44,42,386**. Done.
3. **[You] (recommended)** Run the function **`verifySetup`** → **View → Execution log**. It
   checks the tabs, headers, data, triggers, and that there's no stray "Form Responses" tab,
   and prints `ALL CHECKS PASSED ✅` or the exact failures. One click instead of eyeballing.

> Do NOT delete the "IT Asset Register — FULL" sheet until after this import runs — the
> function reads from it. (Delete it in Part 3, after.)
>
> The import leaves **Timestamp / Purchase Date / Warranty Expiry blank** (the source never had
> them) and sets **Cost = the all-in Total incl. GST** so the dashboard total matches your figure.
> Warranty alerts start working once you add warranty dates going forward.

**Manual fallback** (only if `importFromRegister` errors): upload `hardware-import.csv` to Drive,
open it, copy rows 2→306, and paste into Hardware cell **A2** (columns line up A→N).

---

## Part 3 — Finish up (~2 min)

- **[You]** New intakes will auto-continue the tag series from your max (**next tag = IT-0392**) — nothing to configure; `onFormSubmitTag` handles it.
- **[You]** "Assigned To" on the form is a **free-text name** (no dropdown to maintain). "Team" is a small dropdown (edit `CONFIG.TEAMS` in the script if teams change).
- **[You]** **Share the Form** (the second link from the log) with whoever logs new assets. Share the **Spreadsheet** with your IT admins as Editors.
- **[You]** Optional: in Google Sheets, **File → Version history** is your whole-file safety net (the History tab is casual-audit, not tamper-proof — per the design doc).

---

## What I fixed vs. the original draft (so you know it's sound)

| # | Original bug | Fix |
|---|---|---|
| 1 | Warranty **Alert** formula pointed at the Asset Tag column → never fired | Now reads the Days-to-Warranty column |
| 2 | Dashboard "warranties due" counted a number column for `"DUE"` → always 0 | Now counts the Alert column |
| 3 | "Total assets" counted Serial (often blank in your data) | Now counts Asset Tag |
| 4 | No inventory value on the dashboard | Added **Total inventory value** tile |
| 5 | Asset Tag from `ROW()` → renumbers if rows sorted/deleted | **Frozen at intake** as a stable value; continues your `IT-####` series |
| 6 | `syncEmployees()` referenced but missing | **Added** |

## Known limitations (unchanged from the design doc — accepted trade-offs)

- No barcode/QR scanning (this is the Google-native "smart spreadsheet", not Snipe-IT).
- History log is protected + hidden but not tamper-proof — fine for internal audit, not compliance.
- You're at **305 assets vs. the doc's ~150 target** — comfortably works, but this is the size where a scan-based tool (Snipe-IT/AssetTiger) starts to pay off. Migration path: every tab exports to CSV; Serial Number is the join key.

## Cleanup still worth doing (from earlier analysis)

- **20 duplicate physical tags** (e.g. IT-0064, IT-0381) — I suffixed them `…b/c` in the data and flagged "DUPLICATE TAG – reassign" in Notes. Re-label those devices with fresh IT-#### tags.
- **~4 mis-tagged non-IT items** (neckband, lamp, vacuum, crane scale) — decide whether to drop.
- **181 assets with ₹0 cost** — backfill from invoices to get a true inventory value.
