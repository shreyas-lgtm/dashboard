/**
 * LAYER 4 — Part matching: Line Items ↔ Design Tracker.
 *
 * Run buildPartPrices() manually (rebuilds the whole 'Part Prices' tab each
 * time — idempotent). One row per matched BOM part: latest unit price with
 * full provenance (which document, which line, which match rule), plus an
 * UNMATCHED section listing part numbers seen on documents that have no BOM
 * entry yet — the to-do list for growing the Design Tracker.
 *
 * v1 matches on hard keys only (normalized Manufacturer PN / Internal PN,
 * plus a flagged containment-variant rule). Description/LLM fuzzy matching
 * is deliberately NOT here — flagged variants and unmatched lists are the
 * honest outputs until an alias layer earns its place.
 */

function buildPartPrices() {
  var ss = getSpreadsheet_();
  var dt = ss.getSheetByName(CONFIG.DESIGN_TRACKER.SHEET);
  var li = ss.getSheetByName(CONFIG.SHEETS.LINE_ITEMS);
  if (!dt) { console.log("No '" + CONFIG.DESIGN_TRACKER.SHEET + "' tab found."); return; }
  if (!li || li.getLastRow() < 2) { console.log('No line items yet — run backfillLineItems() first.'); return; }

  var c = CONFIG.DESIGN_TRACKER;
  if (dt.getLastRow() <= c.HEADER_ROW) { console.log('Design Tracker has no data rows below the header.'); return; }
  var dtVals = dt.getRange(c.HEADER_ROW + 1, 1, dt.getLastRow() - c.HEADER_ROW, Math.max(c.UID_COL, c.IPN_COL, c.MPN_COL, c.DESC_COL)).getValues();
  var bom = dtVals.map(function (r) {
    return { uid: String(r[c.UID_COL - 1] || '').trim(), ipn: String(r[c.IPN_COL - 1] || '').trim(),
             mpn: String(r[c.MPN_COL - 1] || '').trim(), desc: String(r[c.DESC_COL - 1] || '').trim() };
  }).filter(function (b) { return b.uid; });

  var liVals = li.getRange(2, 1, li.getLastRow() - 1, 15).getValues();
  var lines = liVals.map(function (r) {
    return { doc: String(r[1]), docType: String(r[2]), vendor: String(r[3]), date: r[4],
             n: r[5], desc: String(r[6]), pn: String(r[7] || '').trim(), qty: r[9],
             rate: r[10], amount: r[11], currency: String(r[12]), check: String(r[13]), src: String(r[14]) };
  });

  var result = computePartPrices_(bom, lines);

  var sh = ss.getSheetByName(CONFIG.SHEETS.PART_PRICES) || ss.insertSheet(CONFIG.SHEETS.PART_PRICES);
  sh.clear();
  var headers = ['UID', 'Internal PN', 'Mfr PN', 'BOM Description', 'Purchases',
    'Latest Unit Rate', 'Currency', 'Latest Doc', 'Latest Doc Date', 'Latest Vendor',
    'Match Type', 'Min Rate', 'Max Rate', 'Notes'];
  var rows = [headers];
  result.parts.forEach(function (p) { rows.push(p); });
  rows.push(new Array(headers.length).fill(''));
  rows.push(['UNMATCHED PART NUMBERS (on documents, not in Design Tracker)', 'Seen (lines)', 'Latest Rate', 'Currency', 'Sample Description', 'Sample Doc'].concat(new Array(headers.length - 6).fill('')));
  result.unmatched.forEach(function (u) { rows.push(u.concat(new Array(headers.length - u.length).fill(''))); });

  sh.getRange(1, 1, rows.length, headers.length).setValues(rows);
  // machine-readable summary cells for the Progress tab (avoids fragile
  // range arithmetic over the two-section layout)
  sh.getRange(1, 16).setValue('PARTS PRICED');
  sh.getRange(2, 16).setValue(result.parts.length);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1a3c6e').setFontColor('#ffffff');
  var unmatchedHeaderRow = result.parts.length + 3;
  sh.getRange(unmatchedHeaderRow, 1, 1, headers.length).setFontWeight('bold').setBackground('#fce8e6');
  sh.setFrozenRows(1);

  var msg = 'Part Prices rebuilt: ' + result.parts.length + ' BOM parts priced, ' +
    result.stats.matchedLines + '/' + result.stats.pnLines + ' part-numbered lines matched, ' +
    result.unmatched.length + ' unmatched part numbers, ' +
    result.stats.noPnLines + ' lines without a part number (not matchable in v1).';
  console.log(msg);
  log_(msg);
}

/**
 * Pure matching core (unit-tested off-platform).
 * bom:   [{uid, ipn, mpn, desc}]
 * lines: [{doc, docType, vendor, date, n, desc, pn, qty, rate, amount, currency, check, src}]
 */
function computePartPrices_(bom, lines) {
  var norm = function (s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  // Sheets hands dates back as Date objects; strings come from tests/exports.
  // Compare on epoch millis — string comparison of Date objects sorts
  // alphabetically ("Sat" > "Mon"), not chronologically.
  var ts = function (v) {
    if (v && typeof v.getTime === 'function') return v.getTime();
    var t = Date.parse(String(v));
    return isNaN(t) ? 0 : t;
  };

  var mpnMap = {}, ipnMap = {};
  bom.forEach(function (b) {
    var m = norm(b.mpn), i2 = norm(b.ipn);
    if (m.length >= 4 && !mpnMap[m]) mpnMap[m] = b;
    if (i2.length >= 4 && !ipnMap[i2]) ipnMap[i2] = b;
  });
  var mpnKeys = Object.keys(mpnMap), ipnKeys = Object.keys(ipnMap);

  var byUid = {};
  var unmatchedByPn = {};
  var stats = { pnLines: 0, matchedLines: 0, noPnLines: 0 };

  lines.forEach(function (ln) {
    if (ln.check.indexOf('qty×rate OK') !== 0) return; // never price from flagged lines
    if (!ln.pn) { stats.noPnLines++; return; }
    stats.pnLines++;

    var p = norm(ln.pn);
    var hit = null, type = null;
    if (mpnMap[p]) { hit = mpnMap[p]; type = 'MPN exact'; }
    else if (ipnMap[p]) { hit = ipnMap[p]; type = 'IPN exact'; }
    else if (p.length >= 6) {
      // containment variant (packaging suffixes, folded qualifiers) — flagged for a human eye
      for (var k = 0; k < mpnKeys.length && !hit; k++) {
        var key = mpnKeys[k];
        if (key.length >= 6 && (key.indexOf(p) !== -1 || p.indexOf(key) !== -1)) { hit = mpnMap[key]; type = 'MPN variant — verify'; }
      }
      for (var j = 0; j < ipnKeys.length && !hit; j++) {
        var key2 = ipnKeys[j];
        if (key2.length >= 6 && (key2.indexOf(p) !== -1 || p.indexOf(key2) !== -1)) { hit = ipnMap[key2]; type = 'IPN variant — verify'; }
      }
    }

    if (!hit) {
      var u = unmatchedByPn[ln.pn] || { count: 0, latest: ln };
      u.count++;
      if (ts(ln.date) > ts(u.latest.date)) u.latest = ln;
      unmatchedByPn[ln.pn] = u;
      return;
    }

    stats.matchedLines++;
    var agg = byUid[hit.uid] || { bom: hit, buys: [] };
    agg.buys.push({ ln: ln, type: type });
    byUid[hit.uid] = agg;
  });

  var parts = Object.keys(byUid).sort().map(function (uid) {
    var agg = byUid[uid];
    var latest = agg.buys[0];
    agg.buys.forEach(function (b) { if (ts(b.ln.date) > ts(latest.ln.date)) latest = b; });
    var rates = agg.buys.map(function (b) { return b.ln.rate; });
    var currencies = {};
    agg.buys.forEach(function (b) { currencies[b.ln.currency] = 1; });
    var mixed = Object.keys(currencies).length > 1;
    var anyVariant = agg.buys.some(function (b) { return b.type.indexOf('variant') !== -1; });
    return [
      uid, agg.bom.ipn, agg.bom.mpn, agg.bom.desc, agg.buys.length,
      latest.ln.rate, latest.ln.currency, latest.ln.doc,
      latest.ln.date, latest.ln.vendor, latest.type,
      mixed ? '' : Math.min.apply(null, rates), mixed ? '' : Math.max.apply(null, rates),
      (mixed ? 'MIXED CURRENCIES — min/max omitted. ' : '') + (anyVariant ? 'Contains variant matches — verify.' : ''),
    ];
  });

  var unmatched = Object.keys(unmatchedByPn).sort().map(function (pn) {
    var u = unmatchedByPn[pn];
    return [pn, u.count, u.latest.rate, u.latest.currency, u.latest.desc.slice(0, 80), u.latest.doc];
  });

  return { parts: parts, unmatched: unmatched, stats: stats };
}
