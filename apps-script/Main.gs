/**
 * Pipeline entry points.
 *
 *   processInbox()  — main worker, runs on a time-driven trigger.
 *   dailySummary()  — one email a day: what was processed, what's pending.
 *
 * Both are installed by setup() in Setup.gs.
 */

function processInbox() {
  var started = Date.now();
  var ss = getSpreadsheet_();
  var register = ss.getSheetByName(CONFIG.SHEETS.REGISTER);
  if (!register) {
    // Without this guard a missing/misspelled tab crashes with an opaque
    // null error on every trigger run — the classic silent failure.
    log_("No tab named 'Register' found — run dryRunChecks() and fix the tab name. Skipping run.");
    return;
  }
  var dedupeIndex = buildDedupeIndex_(register);
  var processed = 0;
  var failures = [];

  // Simple lock so overlapping triggers never double-process a file.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    for (var l = 0; l < CONFIG.LANES.length; l++) {
      var lane = CONFIG.LANES[l];
      var files = DriveApp.getFolderById(lane.inboxId).getFiles();

      while (files.hasNext()) {
        if (processed >= CONFIG.MAX_FILES_PER_RUN ||
            Date.now() - started > CONFIG.MAX_RUNTIME_MS) {
          log_('Run limit reached; remaining files will be picked up next run.');
          return;
        }

        var file = files.next();
        if (file.getMimeType() === 'application/vnd.google-apps.folder') continue;

        // ZIP archives are expanded in place; contents get picked up next pass.
        if (/zip/.test(file.getMimeType()) || /\.zip$/i.test(file.getName())) {
          try {
            expandZip_(file, lane);
          } catch (e) {
            file.moveTo(DriveApp.getFolderById(lane.failedId));
            log_('FAIL unzipping ' + file.getName() + ': ' + e.message);
          }
          processed++;
          continue;
        }

        try {
          var rowInfo = processFile_(file, lane, register, dedupeIndex);
          file.moveTo(DriveApp.getFolderById(lane.processedId));
          log_('OK [' + lane.name + '] ' + file.getName() + ' → ' + rowInfo.status);
        } catch (e) {
          if (isQuotaStop_(e)) {
            // Gemini budget/quota reached: leave the file in the inbox
            // untouched and end the run. It will be picked up automatically
            // once quota resets — no quota is wasted on retries.
            log_('QUOTA STOP [' + lane.name + '] ' + file.getName() + ': ' + e.message);
            return;
          }
          failures.push(lane.name + '/' + file.getName() + ': ' + e.message);
          try {
            appendFailedRow_(register, file, lane, e.message);
            file.moveTo(DriveApp.getFolderById(lane.failedId));
          } catch (moveErr) {
            log_('ERROR moving failed file ' + file.getName() + ': ' + moveErr.message);
          }
          log_('FAIL [' + lane.name + '] ' + file.getName() + ': ' + e.message);
        }
        processed++;
      }
    }
  } finally {
    lock.releaseLock();
    if (failures.length) notifyFailures_(failures);
  }
}

/** Extract → validate → append one Register row. */
function processFile_(file, lane, register, dedupeIndex) {
  if (file.getSize() > CONFIG.MAX_FILE_BYTES) {
    throw new Error('File too large (' + Math.round(file.getSize() / 1e6) + ' MB)');
  }

  // Free-tier routing: POs get the deterministic parser first (zero API
  // calls); Gemini is only used for invoices, scans, and POs that don't
  // match the Zoho layout.
  var extracted = null;
  if (lane.deterministicFirst && file.getMimeType() === 'application/pdf') {
    try {
      extracted = parseZohoPo_(pdfToText_(file));
    } catch (e) {
      log_('Deterministic parse failed for ' + file.getName() + ' (' + e.message + '); falling back to Gemini.');
    }
  }
  if (!extracted) {
    extracted = geminiExtract_(file, lane.docType);
  }

  var v = validate_(extracted, null, lane, dedupeIndex);

  // Lane/doc-type mismatch (e.g. a PO dropped into Invoices-PDF) forces review.
  if (lane.docType !== 'auto' && extracted.doc_type && extracted.doc_type !== lane.docType &&
      v.status === CONFIG.STATUS.AUTO) {
    v.status = CONFIG.STATUS.REVIEW;
    v.checks.push('doc type "' + extracted.doc_type + '" does not match folder "' + lane.name + '"');
  }

  appendRegisterRow_(register, file, lane, extracted, v);

  var key = dedupeKey_(extracted);
  if (key) dedupeIndex[key] = register.getLastRow();

  return v;
}

function appendRegisterRow_(register, file, lane, x, v) {
  register.appendRow([
    new Date(), lane.name, file.getName(), file.getUrl(),
    x.doc_type || '', x.vendor_name || '', x.document_number || '',
    x.document_date || '', x.po_reference || '', x.currency || '',
    toNum_(x.subtotal), toNum_(x.discount) || 0, toNum_(x.tax_total),
    toNum_(x.grand_total), x.confidence || '', v.secondTotal, v.zohoTotal,
    v.checks.join('; '), v.status, x.notes || '', false,
  ]);
}

function appendFailedRow_(register, file, lane, errorMessage) {
  register.appendRow([
    new Date(), lane.name, file.getName(), file.getUrl(),
    '', '', '', '', '', '', '', '', '', '', '', '', '',
    '', CONFIG.STATUS.FAILED, errorMessage, false,
  ]);
}

/**
 * Unpacks a ZIP dropped into an inbox: PDFs/images land back in the inbox
 * as individual files, the archive itself moves to Processed/.
 *
 * NOTE: zips of PAGE-SPLIT exports (e.g. ilovepdf "extract pages") are a bad
 * input — continuation pages of multi-page documents arrive as separate,
 * incomplete files and will pile up in Review. Upload whole per-document
 * files instead.
 */
function expandZip_(zipFile, lane) {
  var inbox = DriveApp.getFolderById(lane.inboxId);
  var entries = Utilities.unzip(zipFile.getBlob().setContentType('application/zip'));
  var kept = 0;
  entries.forEach(function (blob) {
    var name = blob.getName() || '';
    if (/(^|\/)\./.test(name) || /__MACOSX/.test(name)) return; // junk entries
    if (/\.pdf$/i.test(name)) blob.setContentType('application/pdf');
    else if (/\.(jpe?g)$/i.test(name)) blob.setContentType('image/jpeg');
    else if (/\.png$/i.test(name)) blob.setContentType('image/png');
    else return; // skip anything that is not a pdf/image
    blob.setName(name.split('/').pop());
    inbox.createFile(blob);
    kept++;
  });
  zipFile.moveTo(DriveApp.getFolderById(lane.processedId));
  log_('Expanded ' + zipFile.getName() + ' into ' + kept + ' file(s) in ' + lane.name);
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

function alertEmail_() {
  return PropertiesService.getScriptProperties().getProperty('ALERT_EMAIL') ||
         Session.getEffectiveUser().getEmail();
}

function notifyFailures_(failures) {
  MailApp.sendEmail(
    alertEmail_(),
    '[Invoice Pipeline] ' + failures.length + ' file(s) failed',
    'The following files could not be processed and were moved to Failed/:\n\n- ' +
    failures.join('\n- ') +
    '\n\nSee the Log tab for details:\n' + getSpreadsheet_().getUrl()
  );
}

function dailySummary() {
  var ss = getSpreadsheet_();
  var register = ss.getSheetByName(CONFIG.SHEETS.REGISTER);
  var last = register.getLastRow();
  var statusCol = CONFIG.REGISTER_HEADERS.indexOf('Status') + 1;
  var verifiedCol = CONFIG.REGISTER_HEADERS.indexOf('Verified') + 1;

  var counts = { total: 0, auto: 0, review: 0, failed: 0, dupes: 0 };
  var since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  if (last >= 2) {
    var rows = register.getRange(2, 1, last - 1, CONFIG.REGISTER_HEADERS.length).getValues();
    rows.forEach(function (r) {
      var isRecent = r[0] instanceof Date && r[0] > since;
      var status = r[statusCol - 1];
      if (isRecent) {
        counts.total++;
        if (status === CONFIG.STATUS.AUTO) counts.auto++;
        if (status === CONFIG.STATUS.FAILED) counts.failed++;
        if (status === CONFIG.STATUS.DUPLICATE) counts.dupes++;
      }
      // Review backlog counts ALL unverified review rows, not just today's.
      if (status === CONFIG.STATUS.REVIEW && r[verifiedCol - 1] !== true) counts.review++;
    });
  }

  var pendingFiles = 0;
  CONFIG.LANES.forEach(function (lane) {
    var it = DriveApp.getFolderById(lane.inboxId).getFiles();
    while (it.hasNext()) { it.next(); pendingFiles++; }
  });

  // Stay silent when there is truly nothing to say.
  if (counts.total === 0 && counts.review === 0 && pendingFiles === 0) return;

  MailApp.sendEmail(
    alertEmail_(),
    '[Invoice Pipeline] Daily summary — ' + counts.review + ' awaiting review',
    'Last 24h: ' + counts.total + ' processed (' + counts.auto + ' auto-accepted, ' +
    counts.failed + ' failed, ' + counts.dupes + ' duplicates).\n' +
    'Review backlog (all time, unverified): ' + counts.review + '\n' +
    'Files still waiting in inbox folders: ' + pendingFiles + '\n\n' +
    'Tracker: ' + ss.getUrl()
  );
}

function log_(message) {
  try {
    getSpreadsheet_().getSheetByName(CONFIG.SHEETS.LOG).appendRow([new Date(), message]);
  } catch (e) {
    console.log(message);
  }
}
