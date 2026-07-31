/**
 * One-time setup. Run setup() manually from the editor after:
 *   1. Setting SPREADSHEET_ID and GEMINI_API_KEY in Script Properties.
 *   2. (Optional) ZOHO_PROXY_URL, ALERT_EMAIL properties.
 *   3. Running testGeminiSetup() to verify the key (costs zero quota).
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
       '. Extractor: Gemini free tier (' + CONFIG.GEMINI.MODEL + ', budget ' + CONFIG.GEMINI.DAILY_BUDGET + '/day)' +
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
 * PRE-FLIGHT — run this BEFORE anything else. Costs ZERO Gemini quota.
 * Checks every make-or-break condition and prints a PASS/FAIL report to the
 * execution log:
 *   1. Script Properties present
 *   2. Spreadsheet reachable, 'Register' tab exists (catches misspellings)
 *   3. All six Drive folders reachable; counts files waiting in each inbox
 *   4. Gemini key valid + configured model available (via ListModels — free)
 *   5. Deterministic PO parse tested end-to-end on a REAL file from your
 *      POs inbox or Processed folder (Drive text conversion + regex parse)
 */
function dryRunChecks() {
  var ok = true;
  function report(pass, label, detail) {
    console.log((pass ? 'PASS  ' : 'FAIL  ') + label + (detail ? ' — ' + detail : ''));
    if (!pass) ok = false;
  }

  // 1. Properties
  var props = PropertiesService.getScriptProperties();
  report(!!props.getProperty('SPREADSHEET_ID'), 'SPREADSHEET_ID set');
  report(!!props.getProperty('GEMINI_API_KEY'), 'GEMINI_API_KEY set');
  console.log('      ZOHO_PROXY_URL: ' + (props.getProperty('ZOHO_PROXY_URL') || '(not set — PO cross-check off, that is OK)'));

  // 2. Spreadsheet + tab names
  try {
    var ss = getSpreadsheet_();
    var names = ss.getSheets().map(function (s) { return s.getName(); });
    var hasRegister = names.indexOf(CONFIG.SHEETS.REGISTER) !== -1;
    report(hasRegister, "Tab named exactly 'Register' exists", 'tabs found: ' + names.join(', '));
    if (!hasRegister) {
      var suspect = names.filter(function (n) { return /reg/i.test(n); });
      if (suspect.length) console.log("      ⚠ Looks like a misspelling: '" + suspect.join("', '") + "' — rename it to 'Register'.");
    }
  } catch (e) {
    report(false, 'Spreadsheet reachable', e.message);
  }

  // 3. Folders
  CONFIG.LANES.forEach(function (lane) {
    try {
      var inbox = DriveApp.getFolderById(lane.inboxId);
      DriveApp.getFolderById(lane.processedId);
      DriveApp.getFolderById(lane.failedId);
      var it = inbox.getFiles();
      var n = 0, zips = 0;
      while (it.hasNext()) { var f = it.next(); n++; if (/zip/i.test(f.getMimeType()) || /\.zip$/i.test(f.getName())) zips++; }
      report(true, 'Lane ' + lane.name + ' folders reachable', n + ' file(s) waiting' + (zips ? ' (' + zips + ' zip — will be auto-expanded)' : ''));
    } catch (e) {
      report(false, 'Lane ' + lane.name + ' folders reachable', e.message);
    }
  });

  // 4. Gemini key + model (ListModels — zero generation quota)
  try {
    var res = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=' + getProp_('GEMINI_API_KEY'),
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() === 200) {
      var models = (JSON.parse(res.getContentText()).models || []).map(function (m) { return m.name.replace('models/', ''); });
      var has = models.indexOf(CONFIG.GEMINI.MODEL) !== -1;
      report(has, "Gemini key valid + model '" + CONFIG.GEMINI.MODEL + "' available",
        has ? '' : 'available flash models: ' + models.filter(function (m) { return m.indexOf('flash') !== -1; }).join(', '));
    } else {
      report(false, 'Gemini key valid', 'ListModels returned ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
    }
  } catch (e) {
    report(false, 'Gemini key valid', e.message);
  }
  var b = budgetState_();
  console.log('      Gemini budget today: ' + b.used + '/' + CONFIG.GEMINI.DAILY_BUDGET + (b.exhausted ? ' (EXHAUSTED flag set — clears at midnight Pacific)' : ''));

  // 5. Deterministic PO parse on a real file (Drive conversion + regex, no Gemini)
  try {
    var poLane = CONFIG.LANES[0];
    var candidate = firstPdfIn_(poLane.inboxId) || firstPdfIn_(poLane.processedId);
    if (!candidate) {
      console.log('      (no PDF in POs inbox/Processed to test the parser on — drop one in and rerun)');
    } else {
      var text = pdfToText_(candidate);
      var parsed = parseZohoPo_(text);
      if (parsed) {
        var arith = parsed.subtotal !== null &&
          Math.abs(parsed.subtotal - parsed.discount + parsed.tax_total - parsed.grand_total) <= Math.max(1, parsed.grand_total * 0.001);
        report(true, 'Deterministic parse of ' + candidate.getName(),
          parsed.document_number + ' | ' + parsed.vendor_name + ' | ' + parsed.currency + ' ' + parsed.grand_total +
          ' | arithmetic ' + (arith ? 'OK' : 'MISMATCH (would go to Review)'));
      } else {
        report(false, 'Deterministic parse of ' + candidate.getName(),
          'text extracted (' + text.length + ' chars) but Zoho PO pattern not found — first 300 chars logged below');
        console.log('      TEXT SAMPLE: ' + JSON.stringify(normalizeText_(text).slice(0, 300)));
      }
    }
  } catch (e) {
    report(false, 'Deterministic PO parse test', e.message);
  }

  console.log(ok ? '\n✅ ALL CHECKS PASSED — safe to run setup() and start processing.'
                 : '\n❌ FIX THE FAILURES ABOVE before running setup(). No quota was spent.');
}

function firstPdfIn_(folderId) {
  var it = DriveApp.getFolderById(folderId).getFilesByType('application/pdf');
  return it.hasNext() ? it.next() : null;
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
