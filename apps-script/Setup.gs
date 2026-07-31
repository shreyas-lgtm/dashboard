/**
 * One-time setup. Run setup() manually from the editor after:
 *   1. Setting SPREADSHEET_ID and ANTHROPIC_API_KEY in Script Properties.
 *   2. (Optional) DOCAI_*, ZOHO_PROXY_URL, ALERT_EMAIL properties.
 *
 * It is idempotent — safe to run again after config changes.
 */
function setup() {
  var ss = getSpreadsheet_();

  // --- Register tab ---
  var register = ss.getSheetByName(CONFIG.SHEETS.REGISTER) || ss.insertSheet(CONFIG.SHEETS.REGISTER);
  if (register.getLastRow() === 0) {
    register.appendRow(CONFIG.REGISTER_HEADERS);
  }
  register.getRange(1, 1, 1, CONFIG.REGISTER_HEADERS.length)
    .setFontWeight('bold').setBackground('#1a3c6e').setFontColor('#ffffff');
  register.setFrozenRows(1);
  var verifiedCol = CONFIG.REGISTER_HEADERS.indexOf('Verified') + 1;
  register.getRange(2, verifiedCol, register.getMaxRows() - 1, 1).insertCheckboxes();

  // --- Review tab: live filter of unresolved rows ---
  var review = ss.getSheetByName(CONFIG.SHEETS.REVIEW) || ss.insertSheet(CONFIG.SHEETS.REVIEW);
  if (review.getRange('A1').getValue() === '') {
    review.getRange('A1').setValue(
      '=IFERROR(FILTER(' + CONFIG.SHEETS.REGISTER + '!A:T, ' +
      CONFIG.SHEETS.REGISTER + '!S:S="' + CONFIG.STATUS.REVIEW + '", ' +
      CONFIG.SHEETS.REGISTER + '!U:U=FALSE), "Nothing to review 🎉")'
    );
    review.getRange('A2').setNote(
      'This tab is a live view. To clear an item: fix values on the Register tab ' +
      'if needed, then tick its Verified checkbox there.'
    );
  }

  // --- Log tab ---
  var log = ss.getSheetByName(CONFIG.SHEETS.LOG) || ss.insertSheet(CONFIG.SHEETS.LOG);
  if (log.getLastRow() === 0) {
    log.appendRow(['Timestamp', 'Message']);
    log.setFrozenRows(1);
  }

  // Remove the default empty sheet if it is still around and unused.
  var sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && sheet1.getLastRow() === 0 && ss.getSheets().length > 3) {
    ss.deleteSheet(sheet1);
  }

  installTriggers_();
  log_('Setup complete. Lanes: ' + CONFIG.LANES.map(function (l) { return l.name; }).join(', ') +
       '. Document AI: ' + (docAiConfigured_() ? 'on' : 'off') +
       '. Zoho proxy: ' + (PropertiesService.getScriptProperties().getProperty('ZOHO_PROXY_URL') ? 'on' : 'off'));
}

function installTriggers_() {
  // Clear our own old triggers first so re-running setup never duplicates them.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['processInbox', 'dailySummary'].indexOf(t.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('processInbox').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('dailySummary').timeBased().atHour(8).everyDays(1).create();
}

/**
 * Convenience: process a single file by ID without waiting for the trigger.
 * Useful while testing — check the Register/Log tabs for the outcome.
 */
function testOneFile() {
  var fileId = 'PASTE_FILE_ID_HERE';
  var file = DriveApp.getFileById(fileId);
  var parentId = file.getParents().next().getId();
  var lane = CONFIG.LANES.filter(function (l) { return l.inboxId === parentId; })[0];
  if (!lane) throw new Error('File is not in one of the three inbox folders.');
  var register = getSpreadsheet_().getSheetByName(CONFIG.SHEETS.REGISTER);
  var v = processFile_(file, lane, register, buildDedupeIndex_(register));
  console.log(JSON.stringify(v, null, 2));
}
