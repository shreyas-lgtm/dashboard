/**
 * Code.gs — entry points and the Gmail → Sheet glue.
 *
 * Run order for first-time setup (see appscript/README.md):
 *   1. setup()          → creates the spreadsheet, stores its id, prints URL
 *   2. runListingsAgent() → process inbox now (authorise when prompted)
 *   3. createTrigger()  → run it automatically every 15 minutes
 *
 * Optional:
 *   setSlackWebhook('https://hooks.slack.com/services/...')  → Slack digests
 */

const SENDER_QUERY_ =
  '(from:zillow.com OR from:apartments.com OR from:realtor.com OR ' +
  'from:weplacerealty.com OR from:loopnet.com OR from:crexi.com OR ' +
  'subject:"for rent" OR subject:"for sale" OR subject:listing)';

const SHEET_NAME_ = 'Listings';
const HEADERS_ = [
  'Score', 'Verdict', 'Notes / Adjustment', 'Address', 'Deal', 'Price',
  'Beds', 'Baths', 'Sqft', 'Furnished', 'Amenities', 'Source', 'Broker',
  'Status', 'Link', 'Received', 'Key',
];

// === Main loop ============================================================

function runListingsAgent() {
  const sheet = ensureSheet_(getSpreadsheet_());
  const existingKeys = getExistingKeys_(sheet);
  const processed = getProcessedIds_();

  const threads = GmailApp.search(SENDER_QUERY_ + ' newer_than:7d -in:trash -in:sent', 0, 50);
  const rows = [];
  const digest = [];

  threads.forEach(function (thread) {
    const threadId = thread.getId();
    thread.getMessages().forEach(function (msg) {
      const id = msg.getId();
      if (processed[id]) return;
      processed[id] = 1;

      const listing = parseListing_({
        id: id, threadId: threadId, sender: msg.getFrom(), subject: msg.getSubject(),
        date: msg.getDate().toISOString(), plaintextBody: msg.getPlainBody(),
      });
      if (!isListing_(listing)) return;
      if (existingKeys[listing.key]) return; // already in the sheet
      existingKeys[listing.key] = 1;

      const s = scrutinize_(listing);
      const r = rank_(listing, s.trackKey, s.flags);
      const ev = evaluate_(listing, s.flags, r.score);

      rows.push(toRow_(listing, r.score, ev));
      digest.push({ listing: listing, score: r.score, ev: ev });
    });
  });

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    sortByScore_(sheet);
    notifySlack_(digest);
  }
  saveProcessedIds_(processed);
  Logger.log(rows.length + ' new listing(s) added.');
}

function toRow_(l, score, ev) {
  const link = l.url ? '=HYPERLINK("' + l.url + '","view")' : '';
  return [
    score, ev.verdict, ev.note, l.address || '', l.dealType,
    l.price != null ? l.price : '', l.beds != null ? l.beds : '',
    l.baths != null ? l.baths : '', l.sqft != null ? l.sqft : '',
    l.furnished === true ? 'Yes' : l.furnished === false ? 'No' : '?',
    (l.amenities || []).join(', '), l.source, l.broker || '',
    'New', link, l.receivedAt ? new Date(l.receivedAt) : '', l.key,
  ];
}

// === Spreadsheet ==========================================================

function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* recreate below */ }
  }
  const ss = SpreadsheetApp.create('Listings Agent');
  props.setProperty('SHEET_ID', ss.getId());
  Logger.log('Created spreadsheet: ' + ss.getUrl());
  return ss;
}

function ensureSheet_(ss) {
  let sheet = ss.getSheetByName(SHEET_NAME_);
  if (!sheet) {
    sheet = ss.getActiveSheet().getName() === 'Sheet1' && ss.getSheets().length === 1
      ? ss.getActiveSheet().setName(SHEET_NAME_)
      : ss.insertSheet(SHEET_NAME_);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS_.length).setValues([HEADERS_]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange(2, 14, sheet.getMaxRows() - 1, 1) // Status column dropdown
      .setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInList(['New', 'Shortlist', 'Pass', 'Contacted'], true).build());
    applyScoreColors_(sheet);
  }
  return sheet;
}

function applyScoreColors_(sheet) {
  const range = sheet.getRange('A2:A1000');
  const rules = sheet.getConditionalFormatRules();
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(75)
    .setBackground('#b7e1cd').setRanges([range]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(55, 74)
    .setBackground('#fce8b2').setRanges([range]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(55)
    .setBackground('#f4c7c3').setRanges([range]).build());
  sheet.setConditionalFormatRules(rules);
}

/** Map of keys already in the sheet, so re-runs only append genuinely new ones. */
function getExistingKeys_(sheet) {
  const keys = {};
  const last = sheet.getLastRow();
  if (last < 2) return keys;
  const col = HEADERS_.indexOf('Key') + 1;
  const values = sheet.getRange(2, col, last - 1, 1).getValues();
  values.forEach(function (r) { if (r[0]) keys[r[0]] = 1; });
  return keys;
}

function sortByScore_(sheet) {
  const last = sheet.getLastRow();
  if (last > 2) sheet.getRange(2, 1, last - 1, HEADERS_.length).sort({ column: 1, ascending: false });
}

// === Processed-id memory (dedupe without modifying Gmail) =================

function getProcessedIds_() {
  const raw = PropertiesService.getScriptProperties().getProperty('PROCESSED_IDS');
  if (!raw) return {};
  const obj = {};
  JSON.parse(raw).forEach(function (id) { obj[id] = 1; });
  return obj;
}

function saveProcessedIds_(obj) {
  // Keep the most recent ~2000 ids to stay well under the property size limit.
  const ids = Object.keys(obj).slice(-2000);
  PropertiesService.getScriptProperties().setProperty('PROCESSED_IDS', JSON.stringify(ids));
}

// === Slack (optional) =====================================================

function setSlackWebhook(url) {
  PropertiesService.getScriptProperties().setProperty('SLACK_WEBHOOK', url);
  Logger.log('Slack webhook saved.');
}

function notifySlack_(digest) {
  const url = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK');
  if (!url || !digest.length) return;
  digest.sort(function (a, b) { return b.score - a.score; });
  const lines = ['*🏠 ' + digest.length + ' new listing(s)*'];
  digest.forEach(function (d) {
    const l = d.listing;
    const price = l.price != null ? '$' + l.price.toLocaleString() + l.priceUnit : 'n/a';
    const specs = [l.beds && l.beds + 'bd', l.baths && l.baths + 'ba'].filter(Boolean).join(' · ');
    lines.push(d.ev.emoji + ' *' + d.score + '* — ' + (l.address || 'n/a') + ' · ' + price +
      (specs ? ' · ' + specs : '') + '\n   ' + d.ev.note);
  });
  try {
    UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ text: lines.join('\n') }), muteHttpExceptions: true,
    });
  } catch (e) { Logger.log('Slack post failed: ' + e); }
}

// === One-time setup helpers ===============================================

function setup() {
  const ss = getSpreadsheet_();
  ensureSheet_(ss);
  Logger.log('Spreadsheet ready: ' + ss.getUrl());
}

function createTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runListingsAgent') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runListingsAgent').timeBased().everyMinutes(15).create();
  Logger.log('Trigger created: runListingsAgent every 15 minutes.');
}

/** Forget processed ids (so the next run re-imports recent mail). */
function resetMemory() {
  PropertiesService.getScriptProperties().deleteProperty('PROCESSED_IDS');
  Logger.log('Processed-id memory cleared.');
}
