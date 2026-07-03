/**
 * IT ASSET TRACKER — one-time bootstrap script  (corrected + Origin-configured)
 * -----------------------------------------------------------------------------
 * Builds a Google Form + linked Spreadsheet (Hardware, Software Subscriptions,
 * History, Asset Lookup, Dashboard) with auto Asset Tags, warranty/
 * age formulas, an edit-logger, and a daily "due soon" email.
 *
 * FIXES vs. the original draft:
 *   1. Alert formula now reads the Days-to-Warranty column (was pointing at Asset Tag).
 *   2. Dashboard "warranties due" now counts the Alert column (was counting a number column -> always 0).
 *   3. Total assets counts Asset Tag (always present), not Serial (often blank).
 *   4. Added a "Total Inventory Value" tile (sum of Cost).
 *   5. Asset Tag is now FROZEN at intake (stable key) instead of a ROW() formula that renumbers.
 *   6. "Assigned To" is free text (not a 100-name dropdown); "Location" replaced by a "Team" dropdown.
 *
 * HOW TO RUN (once):
 *   1. https://script.google.com  ->  New project
 *   2. Delete the default code, paste ALL of this
 *   3. Check the CONFIG block below (ALERT_EMAIL is the main one)
 *   4. Run -> "setup" -> authorize when prompted
 *   5. Read the execution log for the Form + Sheet links
 *   6. Import your 305 existing assets (see hardware-import.csv / the checklist)
 */

// ====================== CONFIG ======================
const CONFIG = {
  ALERT_EMAIL: 'shreyas@origin.tech',

  // "Assigned To" is a free-text name on the form (NOT a dropdown) — typing a name is
  // faster than hunting through a 100-person list, and new joiners work with no config.

  // Team dropdown for new intakes (small, curated — prevents the "Robotics Tean" typos in old data).
  TEAMS: ['Robotics', 'Mechanical', 'AI', 'Perception', 'Full Stack', 'Embedded',
    'Deployment', 'Operations', 'HR', 'Procurement', 'CVAT', 'Simulation', 'Navigation',
    'Storage', 'Other'],

  // Clean category list for new intakes (the messy/junk categories in old data stay in Notes-flagged rows).
  CATEGORIES: ['Personal Computer', 'Monitor', 'Computer Accessories',
    'Storage', 'Networking', 'UPS', 'Tablet', 'Accessory - Charger', 'Other'],

  // Asset Tag continues your existing physical tags: IT-0001.. (next intake auto-continues from the max).
  TAG_PREFIX: 'IT-',
  TAG_DIGITS: 4,

  ALERT_WINDOW_DAYS: 30,
};

// Status list (form + in-sheet dropdown). Superset covering your data + repair/retire lifecycle.
const STATUS_OPTIONS = [
  'In Use', 'In Storage', 'Available', 'Reserved', 'Deployed',
  'Given to Repair', 'Damaged - Not Sent to Repair',
  'Retired / Disposed', 'Lost / Stolen', 'Unassigned',
];

// One-time bulk import source: the "IT Asset Register — FULL (305 assets)" sheet
// already in your Drive. Used by importFromRegister(). Leave as-is.
const EXISTING_REGISTER_ID = '19rFisqcmeHmtumjDcNsQaGae79qbp6UePmMVEcsQgWg';
// ====================================================


/** MAIN — run this once. */
function setup() {
  const ss = SpreadsheetApp.create('IT Asset Tracker');
  const ssId = ss.getId();

  const form = buildHardwareForm_(ss);
  buildHardwareHelpers_(ss);
  buildSoftwareTab_(ss);
  buildHistoryTab_(ss);
  buildLookupTab_(ss);
  buildDashboardTab_(ss);

  const def = ss.getSheetByName('Sheet1');
  if (def) ss.deleteSheet(def);

  PropertiesService.getScriptProperties().setProperty('SS_ID', ssId);
  PropertiesService.getScriptProperties().setProperty('FORM_ID', form.getId());
  installTriggers_(ssId);

  Logger.log('DONE.');
  Logger.log('Spreadsheet: %s', ss.getUrl());
  Logger.log('Form (share with admins): %s', ss.getFormUrl());
}


/** Find a column index (1-based) by its header text on row 1. */
function getColByHeader_(sh, name) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const i = headers.indexOf(name);
  return i === -1 ? -1 : i + 1;
}


/** Creates the physical-asset form and binds it to the Hardware sheet. */
function buildHardwareForm_(ss) {
  const form = FormApp.create('New IT Asset - Intake')
    .setDescription('Log a new physical IT asset. One submission per item.');

  form.addListItem().setTitle('Category').setChoiceValues(CONFIG.CATEGORIES).setRequired(true);
  form.addTextItem().setTitle('Name / Description').setRequired(true);
  form.addTextItem().setTitle('Manufacturer');
  form.addTextItem().setTitle('Model');
  form.addTextItem().setTitle('Serial Number').setRequired(true);
  form.addTextItem().setTitle('Assigned To').setRequired(true);  // free-text name, not a dropdown
  form.addListItem().setTitle('Status').setChoiceValues(STATUS_OPTIONS).setRequired(true);
  form.addListItem().setTitle('Team').setChoiceValues(CONFIG.TEAMS);  // replaces the old Office/Remote/Storage "Location"
  form.addDateItem().setTitle('Purchase Date');
  form.addTextItem().setTitle('Cost');
  form.addDateItem().setTitle('Warranty Expiry');
  form.addParagraphTextItem().setTitle('Notes');

  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush();

  // Reliably locate the form's response sheet before renaming it (avoids a timing
  // race where the sheet isn't registered yet and the wrong/empty sheet gets renamed).
  let resp = null;
  for (let attempt = 0; attempt < 10 && !resp; attempt++) {
    Utilities.sleep(1000);
    const sheets = ss.getSheets();
    for (let i = 0; i < sheets.length; i++) {
      const nm = sheets[i].getName();
      const a1 = String(sheets[i].getRange(1, 1).getValue());
      if (nm.indexOf('Form Responses') === 0 || a1 === 'Timestamp') { resp = sheets[i]; break; }
    }
  }
  if (!resp) throw new Error('Could not find the form response sheet — re-run setup().');
  resp.setName('Hardware');
  SpreadsheetApp.flush();
  return form;
}


/** Adds helper columns + status dropdown to the Hardware sheet. */
function buildHardwareHelpers_(ss) {
  const sh = ss.getSheetByName('Hardware');
  const lastCol = sh.getLastColumn(); // 13: A Timestamp .. M Notes
  const STATUS_COL = 8;               // H
  const WARRANTY_COL = 12;            // L
  const PURCHASE_COL = 10;            // J

  // Status dropdown for rows 2:1000
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_OPTIONS, true).setAllowInvalid(true).build();
  sh.getRange(2, STATUS_COL, 999, 1).setDataValidation(rule);

  const tagCol = lastCol + 1;    // N — Asset Tag (VALUE, frozen at intake / imported)
  const daysCol = lastCol + 2;   // O
  const alertCol = lastCol + 3;  // P
  const ageCol = lastCol + 4;    // Q
  const win = CONFIG.ALERT_WINDOW_DAYS;

  // Asset Tag header only (values written by onFormSubmitTag() and importFromRegister()).
  sh.getRange(1, tagCol).setValue('Asset Tag').setFontWeight('bold');

  // O/P/Q: ONE self-expanding ARRAYFORMULA each, living in the header cell. This is the
  // robust pattern for form-linked sheets — every row (including future form submissions)
  // auto-computes, with no fill-down that could clash with how Forms appends rows.
  sh.getRange(1, daysCol).setFormula(
    '={"Days to Warranty End"; ARRAYFORMULA(IFERROR(IF(L2:L="","",L2:L-TODAY()),""))}');
  sh.getRange(1, alertCol).setFormula(
    '={"Alert"; ARRAYFORMULA(IFERROR(IF(L2:L="","",IF((L2:L-TODAY())<=' + win + ',"DUE","")),""))}');
  sh.getRange(1, ageCol).setFormula(
    '={"Age (yrs)"; ARRAYFORMULA(IFERROR(IF(J2:J="","",ROUND((TODAY()-J2:J)/365,1)),""))}');
  sh.getRange(1, daysCol, 1, 3).setFontWeight('bold');

  // Alert cell red when DUE (whole column below header)
  const cf = SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('DUE').setBackground('#f4c7c3')
    .setRanges([sh.getRange(2, alertCol, sh.getMaxRows() - 1, 1)]).build();
  const rules = sh.getConditionalFormatRules(); rules.push(cf); sh.setConditionalFormatRules(rules);

  sh.setFrozenRows(1);
}


/** A1-style column letter from a 1-based index. */
function columnToLetter_(col) {
  let s = '', n = col;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - m) / 26); }
  return s;
}


function buildSoftwareTab_(ss) {
  const sh = ss.insertSheet('Software Subscriptions');
  const headers = ['Vendor', 'Product', 'Seats', 'Cost', 'Billing Cycle',
    'Renewal Date', 'Auto-Renew', 'Owner', 'Days to Renewal', 'Alert'];
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');

  const cycle = SpreadsheetApp.newDataValidation().requireValueInList(['Monthly', 'Annual', 'Quarterly'], true).build();
  const yn = SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No'], true).build();
  sh.getRange(2, 5, 999, 1).setDataValidation(cycle);
  sh.getRange(2, 7, 999, 1).setDataValidation(yn);

  const daysF = [], alertF = [];
  for (let r = 2; r <= 1000; r++) {
    daysF.push(['=IF(F' + r + '="","",F' + r + '-TODAY())']);
    alertF.push(['=IF(I' + r + '="","",IF(I' + r + '<=' + CONFIG.ALERT_WINDOW_DAYS + ',"DUE",""))']);
  }
  sh.getRange(2, 9, 999, 1).setFormulas(daysF);
  sh.getRange(2, 10, 999, 1).setFormulas(alertF);

  const cf = SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('DUE').setBackground('#f4c7c3').setRanges([sh.getRange(2, 10, 999, 1)]).build();
  const rules = sh.getConditionalFormatRules(); rules.push(cf); sh.setConditionalFormatRules(rules);
  sh.setFrozenRows(1);
}


function buildHistoryTab_(ss) {
  const sh = ss.insertSheet('History');
  const headers = ['Timestamp', 'Editor', 'Asset Tag', 'Category', 'Field Changed', 'Old Value', 'New Value', 'Action'];
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  const prot = sh.protect().setDescription('Audit log - do not edit');
  prot.removeEditors(prot.getEditors());
  sh.hideSheet();
}


function buildLookupTab_(ss) {
  const sh = ss.insertSheet('Asset Lookup');
  sh.getRange('A1').setValue('Enter Asset Tag:').setFontWeight('bold');
  sh.getRange('B1').setValue(CONFIG.TAG_PREFIX + '0003');
  sh.getRange('A2').setValue('History for this asset:').setFontStyle('italic');
  sh.getRange('A3').setFormula('=IFERROR(FILTER(History!A:H, History!C:C=$B$1), "No history yet for this tag.")');
}


function buildDashboardTab_(ss) {
  const sh = ss.insertSheet('Dashboard');
  const win = CONFIG.ALERT_WINDOW_DAYS;
  const rows = [
    ['IT ASSET DASHBOARD', ''],
    ['Total hardware assets', '=COUNTA(Hardware!N2:N1000)'],
    ['Total inventory value (INR)', '=SUM(Hardware!K2:K1000)'],
    ['Warranties due <=' + win + ' days', '=COUNTIF(Hardware!P2:P1000,"DUE")'],
    ['Subscriptions renewing <=' + win + ' days', "=COUNTIF('Software Subscriptions'!J2:J1000,\"DUE\")"],
    ['In Use', '=COUNTIF(Hardware!H2:H1000,"In Use")'],
    ['In Storage', '=COUNTIF(Hardware!H2:H1000,"In Storage")'],
    ['Available', '=COUNTIF(Hardware!H2:H1000,"Available")'],
    ['Deployed', '=COUNTIF(Hardware!H2:H1000,"Deployed")'],
    ['Given to Repair', '=COUNTIF(Hardware!H2:H1000,"Given to Repair")'],
    ['Retired / Disposed', '=COUNTIF(Hardware!H2:H1000,"Retired / Disposed")'],
    ['Lost / Stolen', '=COUNTIF(Hardware!H2:H1000,"Lost / Stolen")'],
  ];
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  sh.getRange('A1:B1').merge().setFontWeight('bold').setBackground('#d9e1f2');
  sh.getRange('B3').setNumberFormat('#,##0.00');
}


/**
 * ONE-TIME: bulk-import the 305 existing assets from the standalone
 * "IT Asset Register — FULL" sheet into the Hardware tab.
 * Run this ONCE, after setup(). Idempotent (clears prior import first).
 * Existing IT-#### tags are preserved (this does NOT go through the form).
 */
function importFromRegister() {
  const src = SpreadsheetApp.openById(EXISTING_REGISTER_ID).getSheets()[0];
  const data = src.getDataRange().getValues();
  if (data.length < 2) { Logger.log('Source register is empty.'); return; }
  const head = data[0].map(String);
  const at = function (name) { return head.indexOf(name); };
  const cAsset = at('Asset Tag'), cItem = at('Item'), cCat = at('Category'),
        cSer = at('Serial No.'), cMod = at('Model No.'), cStat = at('Status'),
        cHold = at('Assigned To (Holder)'), cLoc = at('Team / Location'),
        cTot = at('Total (INR)'), cNotes = at('Notes');

  const brands = ['Lenovo', 'Dell', 'LG', 'Benq', 'HP', 'Samsung', 'Acer', 'MSI', 'ASUS',
    'Logitech', 'Zebronics', 'Ant', 'Rapoo', 'Portronics', 'Apple', 'Nvidia', 'Mivii',
    'Teltonika', 'TP-Link', 'APC', 'Ambrane'];

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[cAsset] && !r[cItem]) continue;
    const item = String(r[cItem] || '');
    let mfr = '';
    for (let b = 0; b < brands.length; b++) {
      if (item.toLowerCase().indexOf(brands[b].toLowerCase()) === 0) { mfr = brands[b]; break; }
    }
    const total = r[cTot];
    const cost = (total === '' || total === 0 || total === '0.00' || total === '0') ? '' : (Number(total) || '');
    // Hardware column order A..N:
    rows.push(['', r[cCat] || '', item, mfr, r[cMod] || '', r[cSer] || '', r[cHold] || '',
      r[cStat] || '', r[cLoc] || '', '', cost, '', r[cNotes] || '', r[cAsset] || '']);
  }

  const hw = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SS_ID'))
    .getSheetByName('Hardware');
  hw.getRange(2, 1, 999, 14).clearContent();          // clear any prior import (cols A..N only)
  if (rows.length) hw.getRange(2, 1, rows.length, 14).setValues(rows);
  SpreadsheetApp.flush();
  Logger.log('Imported %s assets into Hardware. Check the Dashboard.', rows.length);
}


function installTriggers_(ssId) {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('onEditLogger').forSpreadsheet(ssId).onEdit().create();
  ScriptApp.newTrigger('onFormSubmitTag').forSpreadsheet(ssId).onFormSubmit().create();
  ScriptApp.newTrigger('dailyAlert').timeBased().atHour(8).everyDays(1).create();
}


/** TRIGGER: freeze a stable Asset Tag on each new form submission. */
function onFormSubmitTag(e) {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SS_ID'));
  const sh = ss.getSheetByName('Hardware');
  const tagCol = getColByHeader_(sh, 'Asset Tag');
  if (tagCol === -1) return;
  const row = e.range ? e.range.getRow() : sh.getLastRow();

  // Next number = max existing numeric suffix + 1
  const last = sh.getLastRow();
  let max = 0;
  if (last >= 2) {
    const tags = sh.getRange(2, tagCol, last - 1, 1).getValues();
    for (let i = 0; i < tags.length; i++) {
      const m = String(tags[i][0]).match(/(\d+)/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  const next = CONFIG.TAG_PREFIX + String(max + 1).padStart(CONFIG.TAG_DIGITS, '0');
  sh.getRange(row, tagCol).setValue(next);
}


/** TRIGGER: log every Hardware edit to History (append-down, one row per changed field). */
function onEditLogger(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== 'Hardware') return;
  if (e.range.getRow() === 1) return;

  const ss = sh.getParent();
  const hist = ss.getSheetByName('History');
  const row = e.range.getRow();
  const col = e.range.getColumn();
  const header = sh.getRange(1, col).getValue();
  const tagCol = getColByHeader_(sh, 'Asset Tag');

  const tag = tagCol === -1 ? '' : sh.getRange(row, tagCol).getValue();
  const category = sh.getRange(row, 2).getValue();
  const editor = (e.user && e.user.getEmail()) || Session.getActiveUser().getEmail() || 'unknown';
  const oldV = (e.oldValue === undefined) ? '' : e.oldValue;
  const newV = (e.value === undefined) ? '' : e.value;

  hist.appendRow([new Date(), editor, tag, category, header, oldV, newV, 'Update']);
}


/** TRIGGER: email a digest of warranties/renewals due within the window. */
function dailyAlert() {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SS_ID'));
  const win = CONFIG.ALERT_WINDOW_DAYS;
  const lines = [];

  const hw = ss.getSheetByName('Hardware');
  const hwData = hw.getDataRange().getValues();
  for (let i = 1; i < hwData.length; i++) {
    const warranty = hwData[i][11]; // L
    if (warranty instanceof Date) {
      const days = Math.round((warranty - new Date()) / 86400000);
      if (days <= win && days >= -3650) {
        lines.push('HW  ' + (hwData[i][2] || '') + ' (' + (hwData[i][5] || '') + ') warranty in ' + days + ' days');
      }
    }
  }
  const sw = ss.getSheetByName('Software Subscriptions');
  const swData = sw.getDataRange().getValues();
  for (let i = 1; i < swData.length; i++) {
    const renew = swData[i][5]; // F
    if (renew instanceof Date) {
      const days = Math.round((renew - new Date()) / 86400000);
      if (days <= win && days >= -3650) {
        lines.push('SW  ' + (swData[i][0] || '') + ' ' + (swData[i][1] || '') + ' renews in ' + days + ' days');
      }
    }
  }

  if (!lines.length) return;
  MailApp.sendEmail(
    CONFIG.ALERT_EMAIL,
    'IT Assets - ' + lines.length + ' item(s) due within ' + win + ' days',
    'Due soon:\n\n' + lines.join('\n') + '\n\n(Auto-generated by IT Asset Tracker.)'
  );
}
