/**
 * Progress tracker for the layered rollout plan.
 *
 * Run buildProgressTracker() ONCE — it creates (or rebuilds) a 'Progress'
 * tab in the tracker with live formulas, so the layer gates update
 * themselves as documents are processed and verified. Safe to re-run any
 * time; it rewrites the whole tab.
 */
function buildProgressTracker() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName('Progress') || ss.insertSheet('Progress');
  sh.clear();

  var R = CONFIG.SHEETS.REGISTER;
  var rows = [
    ['LAYERED ROLLOUT — LIVE PROGRESS', '', '', ''],
    ['', '', '', ''],
    ['— LIVE COUNTERS —', '', '', ''],
    ['Documents in Register (excl. duplicates)', '=COUNTA(' + R + '!S2:S)-COUNTIF(' + R + '!S2:S,"DUPLICATE")', '', ''],
    ['Invoices processed (PDF lane)', '=COUNTIFS(' + R + '!B2:B,"Invoices-PDF",' + R + '!S2:S,"<>FAILED")', '', ''],
    ['Scans processed', '=COUNTIFS(' + R + '!B2:B,"Scans",' + R + '!S2:S,"<>FAILED")', '', ''],
    ['Invoices/scans VERIFIED by human', '=COUNTIFS(' + R + '!B2:B,"Invoices-PDF",' + R + '!U2:U,TRUE)+COUNTIFS(' + R + '!B2:B,"Scans",' + R + '!U2:U,TRUE)', '', ''],
    ['Awaiting review right now', '=COUNTIFS(' + R + '!S2:S,"REVIEW",' + R + '!U2:U,FALSE)', '', ''],
    ['Auto-accepted total', '=COUNTIF(' + R + '!S2:S,"AUTO-ACCEPTED")', '', ''],
    ['Failed documents', '=COUNTIF(' + R + '!S2:S,"FAILED")', '', ''],
    ['Gemini fallbacks on PO lane (want 0)', '=COUNTIF(' + CONFIG.SHEETS.LOG + '!B2:B,"*falling back to Gemini*")', '', ''],
    ['Silent errors found (AUTO row that was wrong) — EDIT BY HAND', 0, '', ''],
    ['', '', '', ''],
    ['— LAYERS —', 'GATE', 'PROGRESS', 'STATUS'],
    ['Layer 0a: PO backlog drains deterministically',
      '50 POs, zero failures, zero fallbacks',
      '=B11&" fallbacks, "&B10&" failed"',
      '✅ PASSED'],
    ['Layer 0b: real invoices/scans verified',
      '~10 verified with values checked vs paper',
      '=B7&" / 10 verified"',
      '=IF(B7>=10,"✅ PASSED","🔄 IN PROGRESS")'],
    ['Layer 1: base tightened, no silent errors',
      '2+ weeks steady, silent errors = 0, prompt tuned',
      '=IF(B12=0,"0 silent errors so far","⚠️ "&B12&" SILENT ERRORS")',
      '=IF(AND(B7>=10,B12=0),"🟡 READY TO JUDGE","⬜ WAITING ON L0")'],
    ['Layer 2: line items from POs (deterministic)',
      'All 50 historical POs reconcile line-for-line',
      'parser drafted, on the shelf',
      '=IF(AND(B7>=10,B12=0),"🟡 CAN START","⬜ NOT STARTED")'],
    ['Layer 3: line items from invoices (Gemini)',
      'Line accuracy measured vs hand-checked sample',
      '',
      '⬜ NOT STARTED'],
    ['Layer 4: unit prices per part (BOM matching)',
      'MPN/IPN exact match + alias table + provenance',
      '',
      '⬜ NOT STARTED'],
    ['', '', '', ''],
    ['Next action', '=IF(B7<10,"Feed & verify invoices ("&B7&"/10) — clear the Review tab as you go","Layer 0 gate closed — start Layer 2 (PO line items)")', '', ''],
  ];

  sh.getRange(1, 1, rows.length, 4).setValues(rows);

  // Formatting: title, section headers, layer table
  sh.getRange('A1').setFontWeight('bold').setFontSize(14);
  sh.getRange('A3').setFontWeight('bold');
  sh.getRange('A14:D14').setFontWeight('bold').setBackground('#1a3c6e').setFontColor('#ffffff');
  sh.getRange('A22:B22').setFontWeight('bold').setBackground('#fff3cd');
  sh.getRange('A12:B12').setBackground('#fce8e6').setNote(
    'Increment this by hand any time an AUTO-ACCEPTED row turns out to have a wrong value. ' +
    'This is the most important number in the whole system — it must stay 0.');
  sh.setColumnWidth(1, 340);
  sh.setColumnWidth(2, 320);
  sh.setColumnWidth(3, 240);
  sh.setColumnWidth(4, 180);
  sh.setFrozenRows(1);
  log_('Progress tab rebuilt.');
}
