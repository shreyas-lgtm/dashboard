/**
 * Progress tracker for the layered rollout plan — REAL-TIME edition.
 *
 * Run buildProgressTracker() once (and again after any layout change).
 * Every counter AND every layer status is a live formula over the Register,
 * Line Items, Part Prices, and Log tabs — the tab recomputes itself as
 * documents flow. The single hand-maintained cell is the silent-error
 * count, which is a human judgement by definition.
 */
function buildProgressTracker() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName('Progress') || ss.insertSheet('Progress');
  sh.clear();

  var R = "'" + CONFIG.SHEETS.REGISTER + "'";
  var L = "'" + CONFIG.SHEETS.LINE_ITEMS + "'";
  var P = "'" + CONFIG.SHEETS.PART_PRICES + "'";
  var G = "'" + CONFIG.SHEETS.LOG + "'";

  var rows = [
    ['LAYERED ROLLOUT — LIVE PROGRESS (all values recompute automatically)', '', '', ''],
    ['', '', '', ''],
    ['— LIVE COUNTERS —', '', '', ''],
    /* B4  */ ['Documents in Register (excl. duplicates)', '=COUNTA(' + R + '!S2:S)-COUNTIF(' + R + '!S2:S,"DUPLICATE")', '', ''],
    /* B5  */ ['Invoices/scans processed', '=COUNTIFS(' + R + '!B2:B,"Invoices-PDF",' + R + '!S2:S,"<>FAILED")+COUNTIFS(' + R + '!B2:B,"Scans",' + R + '!S2:S,"<>FAILED")', '', ''],
    /* B6  */ ['Invoices/scans VERIFIED by human', '=COUNTIFS(' + R + '!B2:B,"Invoices-PDF",' + R + '!U2:U,TRUE)+COUNTIFS(' + R + '!B2:B,"Scans",' + R + '!U2:U,TRUE)', '', ''],
    /* B7  */ ['Awaiting review right now', '=COUNTIFS(' + R + '!S2:S,"REVIEW",' + R + '!U2:U,FALSE)', '', ''],
    /* B8  */ ['Gemini fallbacks on PO lane (want 0)', '=COUNTIF(' + G + '!B2:B,"*falling back to Gemini*")', '', ''],
    /* B9  */ ['Line items captured', '=MAX(0,COUNTA(' + L + '!B2:B))', '', ''],
    /* B10 */ ['Line items flagged (want 0)', '=COUNTIF(' + L + '!N2:N,"SUM MISMATCH*")+COUNTIF(' + L + '!N2:N,"*DESC UNALIGNED*")+COUNTIF(' + L + '!N2:N,"*FAILS*")', '', ''],
    /* B11 */ ['POs with line items', '=IFERROR(COUNTA(UNIQUE(FILTER(' + L + '!B2:B,' + L + '!B2:B<>""))),0)', '', ''],
    /* B12 */ ['BOM parts priced (Layer 4)', '=IFERROR(' + P + '!P2,0)', '', ''],
    /* B13 */ ['SILENT ERRORS FOUND (AUTO row later found wrong) — EDIT BY HAND', 0, '', ''],
    ['', '', '', ''],
    ['— LAYERS (status computed live) —', 'GATE', 'PROGRESS', 'STATUS'],
    /* r16 */ ['Layer 0: document pipeline',
      '50-PO drain clean + ~10 verified invoices',
      '=B6&" / 10 verified, "&B8&" fallbacks"',
      '=IF(AND(B6>=10,B8=0),"✅ PASSED",IF(B6>0,"🔄 "&B6&"/10","🔄 IN PROGRESS"))'],
    /* r17 */ ['Layer 1: base tightened, zero silent errors',
      'Weeks of steady running, silent errors = 0',
      '=IF(B13=0,"0 silent errors","⚠️ "&B13&" SILENT ERRORS")',
      '=IF(B13>0,"❌ ERRORS FOUND — STOP AND FIX",IF(B6>=10,"🟡 CLOCK RUNNING","⬜ WAITING ON L0"))'],
    /* r18 */ ['Layer 2: PO line items (deterministic)',
      'All POs reconcile line-for-line, zero flags',
      '=B9&" lines / "&B11&" POs, "&B10&" flagged"',
      '=IF(AND(B9>0,B10=0,B11>=50),"✅ PASSED",IF(B9>0,"🔄 "&B10&" FLAGS OPEN","⬜ NOT STARTED"))'],
    /* r19 */ ['Layer 3: invoice line items (Gemini, gated)',
      'Layer 1 clock passed → flip INVOICE_LINE_ITEMS in config',
      '=IF(COUNTIF(' + L + '!C2:C,"invoice")>0,COUNTIF(' + L + '!C2:C,"invoice")&" invoice lines flowing","code ready, flag off")',
      '=IF(COUNTIF(' + L + '!C2:C,"invoice")>0,"🟢 LIVE",IF(AND(B6>=10,B13=0),"🟡 GATE NEAR — awaiting clock","⬜ GATED"))'],
    /* r20 */ ['Layer 4: unit prices per BOM part',
      'Hard-key matches only; variants flagged; unmatched listed',
      '=IF(B12>0,B12&" parts priced from "&B9&" lines","run buildPartPrices()")',
      '=IF(B12>0,"🟢 LIVE (PO data)","🟡 READY — run buildPartPrices()")'],
    ['', '', '', ''],
    ['Next action', '=IF(B13>0,"Investigate the silent error(s) — nothing else matters until this is 0",IF(B6<10,"Feed & verify invoices ("&B6&"/10) and clear Review",IF(B10>0,"Fix "&B10&" flagged line item(s)",IF(B12=0,"Run buildPartPrices() to light up Layer 4","Cruise: sort documents, clear Review, rerun buildPartPrices() after new POs land"))))', '', ''],
  ];

  sh.getRange(1, 1, rows.length, 4).setValues(rows);

  sh.getRange('A1').setFontWeight('bold').setFontSize(14);
  sh.getRange('A3').setFontWeight('bold');
  sh.getRange('A15:D15').setFontWeight('bold').setBackground('#1a3c6e').setFontColor('#ffffff');
  sh.getRange('A22:B22').setFontWeight('bold').setBackground('#fff3cd');
  sh.getRange('A13:B13').setBackground('#fce8e6').setNote(
    'Increment by hand any time an AUTO-ACCEPTED row turns out to have a wrong value. ' +
    'This is the most important number in the system — everything gates on it staying 0.');
  sh.setColumnWidth(1, 340);
  sh.setColumnWidth(2, 330);
  sh.setColumnWidth(3, 260);
  sh.setColumnWidth(4, 220);
  sh.setFrozenRows(1);
  log_('Progress tab rebuilt (real-time formulas).');
}
