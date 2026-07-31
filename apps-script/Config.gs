/**
 * Central configuration for the Invoice/PO parsing pipeline.
 *
 * Folder IDs below point at the "V3 Invoices-PO-Scan" structure in Drive.
 * Secrets (API keys) live in Script Properties, never in code:
 *   File > Project properties > Script properties
 *
 * Required script properties:
 *   ANTHROPIC_API_KEY   — Claude API key (console.anthropic.com)
 *   SPREADSHEET_ID      — ID of the tracker spreadsheet
 *
 * Optional script properties:
 *   DOCAI_PROJECT_ID    — GCP project with Document AI enabled
 *   DOCAI_LOCATION      — e.g. "us" or "eu"
 *   DOCAI_PROCESSOR_ID  — Invoice Parser processor ID
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
      dualRead: false,
    },
    {
      name: 'Invoices-PDF',
      docType: 'invoice',
      inboxId: '1NGwUgZo9b9igbgWNTpY6uFJBvl1w63jz',
      processedId: '1ZZ_PxDdowIboVsiW9kNiyZ5wWY4bt1A6',
      failedId: '1TRe-R7PKw_19UBC5mFT24XbKjSXQkw_V',
      dualRead: false,
    },
    {
      name: 'Scans',
      docType: 'auto', // could be PO or invoice — model decides
      inboxId: '1Ly7yf6DdsC3K_K7FPDwuvO622bzVpI31',
      processedId: '1Xc0qxFaq-Rq_nEFLMdyg-UjEbSwhbUZY',
      failedId: '1yXKVDy54kTE0F26MusKSHv5k4_kWt7fW',
      dualRead: true, // cross-validate with Document AI when configured
    },
  ],

  ROOT_FOLDER_ID: '1g-ScqTvLm_gowmhkmL6krk02L1Lm9iuP',

  // --- Sheet tab names ---
  SHEETS: {
    REGISTER: 'Register',
    REVIEW: 'Review',
    LOG: 'Log',
  },

  REGISTER_HEADERS: [
    'Ingested At', 'Lane', 'File Name', 'File Link', 'Doc Type', 'Vendor',
    'Doc Number', 'Doc Date', 'PO Ref', 'Currency', 'Subtotal', 'Discount',
    'Tax', 'Total', 'Extractor Confidence', '2nd Read Total', 'Zoho PO Total',
    'Checks', 'Status', 'Notes', 'Verified',
  ],

  // --- Processing limits (Apps Script has a 6-minute execution cap) ---
  MAX_FILES_PER_RUN: 5,
  MAX_RUNTIME_MS: 4.5 * 60 * 1000,
  MAX_FILE_BYTES: 30 * 1024 * 1024, // Claude PDF limit is 32 MB

  // --- Extraction ---
  CLAUDE_MODEL: 'claude-sonnet-5',
  CLAUDE_MAX_TOKENS: 1500,

  // Auto-accept an invoice above this amount only if it has TWO passing
  // cross-checks (dual read agreement or a Zoho PO match). Below it, one is
  // enough. Set to 0 to always require two.
  HIGH_VALUE_THRESHOLD: 100000,

  // Relative tolerance when comparing totals (dual read / Zoho PO match).
  TOTAL_TOLERANCE: 0.005, // 0.5%

  STATUS: {
    AUTO: 'AUTO-ACCEPTED',
    REVIEW: 'REVIEW',
    DUPLICATE: 'DUPLICATE',
    FAILED: 'FAILED',
  },
};

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

function docAiConfigured_() {
  var p = PropertiesService.getScriptProperties();
  return !!(p.getProperty('DOCAI_PROJECT_ID') &&
            p.getProperty('DOCAI_LOCATION') &&
            p.getProperty('DOCAI_PROCESSOR_ID'));
}
