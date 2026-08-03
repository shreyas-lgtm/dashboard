/**
 * Central configuration for the Invoice/PO parsing pipeline (FREE TIER build).
 *
 * Extraction strategy:
 *   - POs lane        → deterministic text parse (no API calls at all)
 *   - Invoices/Scans  → Gemini API free tier, one call per document,
 *                       paced and capped by a self-imposed daily budget
 *
 * Secrets live in Script Properties (File > Project settings > Script properties):
 *
 * Required script properties:
 *   GEMINI_API_KEY      — free key from https://aistudio.google.com/apikey
 *   SPREADSHEET_ID      — ID of the tracker spreadsheet
 *
 * Optional script properties:
 *   ZOHO_PROXY_URL      — e.g. https://<your-dashboard>.vercel.app/api/zoho
 *   ALERT_EMAIL         — where failure/summary emails go (defaults to owner)
 */

var CONFIG = {
  // --- Drive lanes: inbox → Processed / Failed ---
  LANES: [
    {
      name: 'POs',
      docType: 'purchase_order',
      inboxId: '13GNrJrQmXWbePrQmlYm8EXSEBNp-Wosc',
      processedId: '1K5US04XU5YcWicOOC638L8DYvRFq3B_d',
      failedId: '1SuOtdqpwu678xKWdrXBXUvsIJG3lPp1U',
      deterministicFirst: true, // parse Zoho PO text directly; Gemini only as fallback
    },
    {
      name: 'Invoices-PDF',
      docType: 'invoice',
      inboxId: '1NGwUgZo9b9igbgWNTpY6uFJBvl1w63jz',
      processedId: '1ZZ_PxDdowIboVsiW9kNiyZ5wWY4bt1A6',
      failedId: '1TRe-R7PKw_19UBC5mFT24XbKjSXQkw_V',
      deterministicFirst: false,
    },
    {
      name: 'Scans',
      docType: 'auto', // could be PO or invoice — model decides
      inboxId: '1Ly7yf6DdsC3K_K7FPDwuvO622bzVpI31',
      processedId: '1Xc0qxFaq-Rq_nEFLMdyg-UjEbSwhbUZY',
      failedId: '1yXKVDy54kTE0F26MusKSHv5k4_kWt7fW',
      deterministicFirst: false,
    },
  ],

  ROOT_FOLDER_ID: '1g-ScqTvLm_gowmhkmL6krk02L1Lm9iuP',

  // --- Sheet tab names ---
  SHEETS: {
    REGISTER: 'Register',
    REVIEW: 'Review',
    LOG: 'Log',
    LINE_ITEMS: 'Line Items',
    PART_PRICES: 'Part Prices',
  },

  // LAYER 4 — where to find part identity columns on the Design Tracker tab
  // (1-based column numbers: E=5, F=6, G=7, H=8). Adjust here if the BOM
  // layout ever changes.
  DESIGN_TRACKER: {
    SHEET: 'Design Tracker',
    HEADER_ROW: 1,
    UID_COL: 5,   // E: UID (P0001...)
    IPN_COL: 6,   // F: Internal Part Number (CON-000001...)
    MPN_COL: 7,   // G: Manufacturer part Number
    DESC_COL: 8,  // H: Component Description
  },

  // LAYER 3 — invoice line items via Gemini. Code-complete but GATED:
  // stays false until the Layer 1 trust clock passes (weeks of running with
  // zero silent errors). Flipping to true makes Gemini return line_items,
  // validated per-line (qty×rate=amount) and per-document (sum=subtotal)
  // with the same flag discipline as the PO parser.
  INVOICE_LINE_ITEMS: false,

  LINE_HEADERS: [
    'Ingested At', 'Doc Number', 'Doc Type', 'Vendor', 'Doc Date', 'Line #',
    'Description', 'Part Number', 'HSN', 'Qty', 'Unit Rate', 'Amount',
    'Currency', 'Line Check', 'Source File',
  ],

  REGISTER_HEADERS: [
    'Ingested At', 'Lane', 'File Name', 'File Link', 'Doc Type', 'Vendor',
    'Doc Number', 'Doc Date', 'PO Ref', 'Currency', 'Subtotal', 'Discount',
    'Tax', 'Total', 'Extractor Confidence', '2nd Read Total', 'Zoho PO Total',
    'Checks', 'Status', 'Notes', 'Verified',
  ],

  // --- Processing limits (Apps Script has a 6-minute execution cap) ---
  MAX_FILES_PER_RUN: 5,
  MAX_RUNTIME_MS: 4.5 * 60 * 1000,
  MAX_FILE_BYTES: 18 * 1024 * 1024, // Gemini inline data limit is ~20 MB per request

  // --- Gemini free tier settings ---
  GEMINI: {
    // Stable, free-tier-eligible model. Change here if Google renames tiers;
    // run testGeminiSetup() after changing to verify the ID is valid for
    // your key WITHOUT spending any generation quota.
    MODEL: 'gemini-2.5-flash',
    // Self-imposed ceiling on generateContent calls per day (Pacific time,
    // matching Google's quota reset). Keep this WELL below your key's real
    // RPD limit — check yours in AI Studio. Free limits have been cut
    // before (Dec 2025) and can change without notice.
    DAILY_BUDGET: 150,
    // Pause between calls to stay far under the free RPM limit (~10/min).
    MIN_MS_BETWEEN_CALLS: 7000,
    // Generous cap: newer Gemini models (3.x) spend internal "thinking"
    // tokens from this same budget before emitting the JSON — 1024 caused
    // real MAX_TOKENS truncations. Free-tier TPM (250k/min) dwarfs this.
    MAX_OUTPUT_TOKENS: 8192,
  },

  // Auto-accept an invoice above this amount only if it has TWO passing
  // cross-checks. Below it, one is enough. Set to 0 to always require two.
  HIGH_VALUE_THRESHOLD: 100000,

  // Relative tolerance when comparing totals (Zoho PO match).
  TOTAL_TOLERANCE: 0.005, // 0.5%

  STATUS: {
    AUTO: 'AUTO-ACCEPTED',
    REVIEW: 'REVIEW',
    DUPLICATE: 'DUPLICATE',
    FAILED: 'FAILED',
  },
};

// Internal marker used to halt a run cleanly when the Gemini budget/quota is
// hit: files stay in the inbox and are retried on a later run.
var QUOTA_STOP = 'GEMINI_QUOTA_STOP';

function getProp_(key, optional) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v && !optional) {
    throw new Error('Missing required Script Property: ' + key);
  }
  return v;
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(getProp_('SPREADSHEET_ID'));
}
