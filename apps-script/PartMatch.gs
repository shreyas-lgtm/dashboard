/**
 * LAYER 4 — Part matching: Line Items ↔ Design Tracker.
 *
 * Run buildPartPrices() manually (rebuilds the whole 'Part Prices' tab each
 * time — idempotent). One row per matched BOM part: latest unit price with
 * full provenance, plus an UNMATCHED section where every unrecognized line
 * gets the script's best-guess BOM part and a Confirm checkbox.
 *
 * Match rules, strongest first (all four BOM columns are identifiers):
 *   1. MPN / IPN / UID exact (normalized)
 *   2. Alias approved by a human (Aliases tab)   — clean match
 *   3. MPN/IPN containment variant               — flagged "verify"
 *   4. specific MPN found inside the line desc   — flagged "verify";
 *      ambiguous (2+ BOM parts) is refused, never guessed
 *
 * The guess-and-tick loop (teaching the matcher new wordings):
 *   1. buildPartPrices()  → UNMATCHED section shows a Suggested UID + score
 *   2. tick Confirm ✓ on rows where the guess is right (or type the correct
 *      UID into the Suggested UID cell first, then tick)
 *   3. commitAliases()    → ticked mappings are saved to the Aliases tab
 *   4. buildPartPrices()  → those lines now price their parts, forever
 *
 * Suggestions NEVER price anything on their own — a part is only ever priced
 * from a hard key or a human-approved alias. Fuzzy scoring is advisory only.
 */

function buildPartPrices() {
  var ss = getSpreadsheet_();
  var dt = ss.getSheetByName(CONFIG.DESIGN_TRACKER.SHEET);
  var li = ss.getSheetByName(CONFIG.SHEETS.LINE_ITEMS);
  if (!dt) { console.log("No '" + CONFIG.DESIGN_TRACKER.SHEET + "' tab found."); return; }
  if (!li || li.getLastRow() < 2) { console.log('No line items yet — run backfillLineItems() first.'); return; }

  // NEVER wipe un-committed human work: a rebuild clears the sheet, so any
  // Confirm tick that hasn't been through commitAliases() would be lost.
  var prev = ss.getSheetByName(CONFIG.SHEETS.PART_PRICES);
  if (prev && prev.getLastRow() > 1) {
    var prevVals = prev.getRange(1, 1, prev.getLastRow(), 10).getValues();
    var inUnmatched = false, pending = 0;
    for (var pv = 0; pv < prevVals.length; pv++) {
      if (String(prevVals[pv][0]).indexOf('UNMATCHED') === 0) { inUnmatched = true; continue; }
      if (inUnmatched && (prevVals[pv][9] === true || String(prevVals[pv][9]).toUpperCase() === 'TRUE')) pending++;
    }
    if (pending > 0) {
      var warn = 'buildPartPrices ABORTED: ' + pending + ' Confirm tick(s) not yet committed — run commitAliases() first (or untick them), then rebuild.';
      console.log(warn);
      log_(warn);
      return;
    }
  }

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

  // Doc-level GST % from the Register (subtotal/discount/tax are already
  // there — no reparsing, no API calls). Attached to each line by doc number.
  var docGst = {};
  var reg = ss.getSheetByName(CONFIG.SHEETS.REGISTER);
  if (reg && reg.getLastRow() > 1) {
    reg.getRange(2, 1, reg.getLastRow() - 1, 13).getValues().forEach(function (r) {
      var doc = String(r[6] || '').trim();
      if (!doc || docGst[doc] != null) return; // first non-null reading wins
      docGst[doc] = docGstPercent_(r[10], r[11], r[12]);
    });
  }
  lines.forEach(function (ln) { ln.gst = docGst[ln.doc]; });

  var result = computePartPrices_(bom, lines, readAliases_(ss));

  var sh = ss.getSheetByName(CONFIG.SHEETS.PART_PRICES) || ss.insertSheet(CONFIG.SHEETS.PART_PRICES);
  sh.clear();
  // stale checkbox validations from a previous (taller) unmatched section
  // would strand live checkboxes on now-empty rows — clear them explicitly
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();

  var headers = ['UID', 'Internal PN', 'Mfr PN', 'BOM Description', 'Purchases',
    'Total Qty Bought', 'Total Spend', 'Latest Unit Rate', 'Currency', 'GST %',
    'Latest Doc', 'Latest Doc Date', 'Latest Vendor', 'Match Type', 'Min Rate', 'Max Rate', 'Notes'];
  var uHeaders = ['UNMATCHED — tick Confirm ✓ then run commitAliases()', 'Seen (lines)',
    'Latest Rate', 'Currency', 'Latest Description', 'Sample Doc',
    'Suggested UID', 'Suggested Part', 'Score', 'Confirm ✓', 'Alias Key (saved on commit)'];
  var W = Math.max(headers.length, uHeaders.length);
  var pad = function (a) { return a.concat(new Array(W - a.length).fill('')); };

  var rows = [pad(headers)];
  result.parts.forEach(function (p) { rows.push(pad(p)); });
  rows.push(new Array(W).fill(''));
  rows.push(pad(uHeaders));
  result.unmatched.forEach(function (u) { rows.push(pad(u)); });

  sh.getRange(1, 1, rows.length, W).setValues(rows);
  // machine-readable summary cells for the Progress tab (avoids fragile
  // range arithmetic over the two-section layout) — column R, clear of the
  // 16 data columns
  sh.getRange(1, 18).setValue('PARTS PRICED');
  sh.getRange(2, 18).setValue(result.parts.length);
  sh.getRange(1, 1, 1, W).setFontWeight('bold').setBackground('#1a3c6e').setFontColor('#ffffff');
  var unmatchedHeaderRow = result.parts.length + 3;
  sh.getRange(unmatchedHeaderRow, 1, 1, W).setFontWeight('bold').setBackground('#fce8e6');
  if (result.unmatched.length) {
    // checkbox VALIDATION, never insertCheckboxes() — the latter fills cells
    // with FALSE and breaks appendRow-style logic elsewhere
    sh.getRange(unmatchedHeaderRow + 1, 10, result.unmatched.length, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
  sh.setFrozenRows(1);

  var msg = 'Part Prices rebuilt: ' + result.parts.length + ' BOM parts priced, ' +
    result.stats.matchedLines + ' lines matched (' + result.stats.aliasLines + ' via approved alias, ' +
    result.stats.descMatchedLines + ' via description rules), ' +
    result.unmatched.length + ' unmatched wordings (' + result.stats.suggested +
    ' with a suggested part awaiting your tick).';
  console.log(msg);
  log_(msg);
}

/**
 * Saves every ticked row of the UNMATCHED section as a permanent alias:
 * "this document wording = this BOM part". Validates the UID against the
 * Design Tracker, skips duplicates, then tells you to rerun buildPartPrices().
 */
function commitAliases() {
  var ss = getSpreadsheet_();
  var pp = ss.getSheetByName(CONFIG.SHEETS.PART_PRICES);
  if (!pp || pp.getLastRow() < 2) { console.log('No Part Prices tab — run buildPartPrices() first.'); return; }

  var vals = pp.getRange(1, 1, pp.getLastRow(), 11).getValues();
  var start = -1;
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).indexOf('UNMATCHED') === 0) { start = i + 1; break; }
  }
  if (start < 0) { console.log('No UNMATCHED section found — nothing to commit.'); return; }

  // canonical UIDs from the Design Tracker (norm → exact spelling)
  var c = CONFIG.DESIGN_TRACKER;
  var dt = ss.getSheetByName(CONFIG.DESIGN_TRACKER.SHEET);
  if (!dt || dt.getLastRow() <= c.HEADER_ROW) { console.log('Design Tracker is empty — cannot validate UIDs.'); return; }
  var norm = function (s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  var validUid = {};
  dt.getRange(c.HEADER_ROW + 1, c.UID_COL, dt.getLastRow() - c.HEADER_ROW, 1).getValues().forEach(function (r) {
    var u = String(r[0] || '').trim();
    if (u) validUid[norm(u)] = u;
  });

  var al = ss.getSheetByName(CONFIG.SHEETS.ALIASES) || ss.insertSheet(CONFIG.SHEETS.ALIASES);
  if (al.getLastRow() === 0) al.appendRow(['Alias Text', 'UID', 'Added By', 'Added At']);
  var existing = {}; // normalized alias → UID it maps to
  if (al.getLastRow() > 1) {
    al.getRange(2, 1, al.getLastRow() - 1, 2).getValues().forEach(function (r) {
      existing[norm(r[0])] = String(r[1] || '').trim();
    });
  }

  // Rows that are fully handled (saved / already known) get UNTICKED so the
  // rebuild guard doesn't block on finished work. Rows needing a human fix
  // (bad UID, missing UID, junk key, conflict) STAY ticked — the guard then
  // forces the fix-or-untick decision instead of silently losing it.
  var added = 0, dupes = 0, badUid = 0, noUid = 0, junkKey = 0, conflicts = 0;
  for (var r = start; r < vals.length; r++) {
    var row = vals[r];
    if (row[9] !== true && String(row[9]).toUpperCase() !== 'TRUE') continue; // Confirm ✓ (col J)
    var uid = String(row[6] || '').trim();   // Suggested UID (col G) — user can overtype
    var key = String(row[10] || '').trim();  // Alias Key (col K)
    var done = false;
    if (!uid || !key) {
      noUid++;
    } else if (norm(key).length < 4) {
      // an alias that normalizes to under 4 chars ("." rows, stray digits)
      // can never match anything — refuse loudly instead of saving a no-op
      junkKey++;
      log_('commitAliases: alias "' + key + '" is too short/unspecific to ever match — row skipped.');
    } else {
      var canon = validUid[norm(uid)];
      var prior = existing[norm(key)];
      if (!canon) {
        badUid++;
        log_('commitAliases: UID "' + uid + '" not in Design Tracker — row skipped.');
      } else if (prior !== undefined && prior !== canon) {
        conflicts++;
        log_('commitAliases: "' + key + '" already maps to ' + prior + ' — refused remap to ' + canon +
          '. Delete the old row on the Aliases tab first if the remap is intended.');
      } else if (prior !== undefined) {
        dupes++;
        done = true;
      } else {
        al.appendRow([key, canon, Session.getEffectiveUser().getEmail(), new Date()]);
        existing[norm(key)] = canon;
        added++;
        done = true;
      }
    }
    if (done) pp.getRange(r + 1, 10).setValue(false);
  }

  var msg = 'commitAliases: ' + added + ' new alias(es) saved' +
    (dupes ? ', ' + dupes + ' already known' : '') +
    (conflicts ? ', ' + conflicts + ' CONFLICT(s) refused (see Log)' : '') +
    (badUid ? ', ' + badUid + ' skipped — UID not in Design Tracker (see Log)' : '') +
    (noUid ? ', ' + noUid + ' ticked row(s) have no Suggested UID — type one and re-run' : '') +
    (junkKey ? ', ' + junkKey + ' alias key(s) too short to ever match (see Log)' : '') +
    '. Now run buildPartPrices() to apply.';
  console.log(msg);
  log_(msg);
}

// ---------------------------------------------------------------------------
// LAYER 4.2 — Gemini-assisted alias suggestions (SUGGESTION-ONLY)
// ---------------------------------------------------------------------------

// One batched call per run; rows beyond this wait for the next run.
var AI_SUGGEST_MAX_ROWS = 80;

var AI_SUGGEST_INSTRUCTION =
  'You match purchase-order line wordings to a robotics BOM catalog. ' +
  'Reply ONLY with a JSON array: [{"index": <line index>, "uid": "<uid copied from the catalog>", ' +
  '"confidence": "high" | "medium" | "low", "reason": "<10 words max>"}]. ' +
  'Rules: the uid MUST be copied verbatim from the catalog — never invent one. ' +
  'Omit lines you cannot match with real confidence, or mark them "low". ' +
  'Freight/shipping/packing charges and services (welding, powder coating, contract manufacturing, ' +
  'inspection, labour) are NOT parts — omit them. ' +
  'Match on meaning: synonyms, abbreviations, size codes (e.g. "hex bolt" vs "SHCS"), not string similarity alone.';

/**
 * Fills the Suggested UID / Part / Score columns of UNMATCHED rows that the
 * deterministic scorer left blank, using ONE batched Gemini call (counts
 * against the same self-imposed daily budget as document extraction).
 *
 * Suggestions only — nothing is priced and nothing is saved until a human
 * ticks Confirm and runs commitAliases(). AI rows are labeled "AI high/medium"
 * in the Score column so you always know which engine proposed them.
 */
function suggestAliasesWithGemini() {
  var norm = function (s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  var ss = getSpreadsheet_();
  var pp = ss.getSheetByName(CONFIG.SHEETS.PART_PRICES);
  if (!pp || pp.getLastRow() < 2) { console.log('Run buildPartPrices() first.'); return; }

  var vals = pp.getRange(1, 1, pp.getLastRow(), 11).getValues();
  var start = -1;
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).indexOf('UNMATCHED') === 0) { start = i + 1; break; }
  }
  if (start < 0) { console.log('No UNMATCHED section — nothing to suggest.'); return; }

  var c = CONFIG.DESIGN_TRACKER;
  var dt = ss.getSheetByName(c.SHEET);
  if (!dt || dt.getLastRow() <= c.HEADER_ROW) { console.log('Design Tracker is empty.'); return; }
  var dtVals = dt.getRange(c.HEADER_ROW + 1, 1, dt.getLastRow() - c.HEADER_ROW, Math.max(c.UID_COL, c.IPN_COL, c.MPN_COL, c.DESC_COL)).getValues();
  var bom = dtVals.map(function (r) {
    return { uid: String(r[c.UID_COL - 1] || '').trim(), ipn: String(r[c.IPN_COL - 1] || '').trim(),
             mpn: String(r[c.MPN_COL - 1] || '').trim(), desc: String(r[c.DESC_COL - 1] || '').trim() };
  }).filter(function (b) { return b.uid; });
  var validUid = {};
  bom.forEach(function (b) { if (!validUid[norm(b.uid)]) validUid[norm(b.uid)] = b; });

  // candidates: unmatched rows with NO suggestion yet and a usable alias key
  var cands = [];
  for (var r = start; r < vals.length && cands.length < AI_SUGGEST_MAX_ROWS; r++) {
    var uidCell = String(vals[r][6] || '').trim();
    var key = String(vals[r][10] || '').trim();
    if (uidCell || !key || norm(key).length < 4) continue;
    cands.push({ row: r + 1, key: key });
  }
  if (!cands.length) { console.log('Every unmatched row already has a suggestion (or is junk) — nothing to send.'); return; }

  var catalog = bom.map(function (b) { return b.uid + ' | ' + b.ipn + ' | ' + b.mpn + ' | ' + b.desc; }).join('\n');
  var linesTxt = cands.map(function (x, i2) { return i2 + ' | ' + x.key; }).join('\n');
  var body = {
    contents: [{ parts: [{ text: AI_SUGGEST_INSTRUCTION +
      '\n\nBOM CATALOG (uid | internal pn | manufacturer pn | description):\n' + catalog +
      '\n\nUNMATCHED PURCHASE LINES (index | wording):\n' + linesTxt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: CONFIG.GEMINI.MAX_OUTPUT_TOKENS, responseMimeType: 'application/json' },
  };

  var data;
  try {
    data = geminiCall_(body);
  } catch (e) {
    // budget/quota/5xx — nothing written, safe to just retry another day
    var m = 'AI suggest skipped: ' + String(e.message || e);
    console.log(m); log_(m);
    return;
  }
  var cand0 = (data.candidates || [])[0];
  if (!cand0) { console.log('AI suggest: no candidates returned.'); return; }
  var text = ((cand0.content || {}).parts || []).map(function (p) { return p.text || ''; }).join('');
  if (cand0.finishReason === 'MAX_TOKENS') {
    console.log('AI suggest: response truncated (MAX_TOKENS) — nothing written. Re-run; fewer rows will be pending.');
    return;
  }
  // parseJsonLoose_ extracts {...} spans (built for the extraction path) and
  // would collapse a JSON ARRAY to its first object — parse arrays here.
  var out;
  try {
    var cleaned = String(text).replace(/```(json)?/g, '').trim();
    var s0 = cleaned.indexOf('['), e0 = cleaned.lastIndexOf(']');
    if (s0 !== -1 && e0 > s0) out = JSON.parse(cleaned.slice(s0, e0 + 1));
    else out = [parseJsonLoose_(cleaned)]; // model returned a single object
  } catch (e2) {
    console.log('AI suggest: could not parse model output — nothing written. ' + String(e2.message || e2));
    return;
  }

  var applied = applyAiSuggestions_(cands, out, validUid);
  applied.forEach(function (a) {
    pp.getRange(a.row, 7).setValue(a.uid);
    pp.getRange(a.row, 8).setValue(a.label);
    pp.getRange(a.row, 9).setValue(a.score);
  });
  var msg = 'AI suggest: ' + applied.length + ' suggestion(s) written for ' + cands.length +
    ' unsuggested row(s) sent (1 API call). Review each, tick Confirm, run commitAliases(). ' +
    'AI rows are labeled "AI high/medium" in the Score column.';
  console.log(msg);
  log_(msg);
}

/**
 * Pure filter for the model's output (unit-tested off-platform): only
 * catalog-valid UIDs, only high/medium confidence, only known line indexes.
 */
function applyAiSuggestions_(cands, aiOut, validUidMap) {
  var norm = function (s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  var applied = [];
  if (!aiOut || !aiOut.length) return applied;
  var seen = {};
  for (var i = 0; i < aiOut.length; i++) {
    var s = aiOut[i] || {};
    var idx = Number(s.index);
    if (!(idx >= 0 && idx < cands.length) || seen[idx]) continue;
    var b = s.uid ? validUidMap[norm(String(s.uid))] : null;
    if (!b) continue;
    var conf = String(s.confidence || '').toLowerCase();
    if (conf !== 'high' && conf !== 'medium') continue;
    seen[idx] = 1;
    applied.push({
      row: cands[idx].row,
      uid: b.uid,
      label: (b.mpn || b.ipn || '') + (b.desc ? ' — ' + b.desc.slice(0, 50) : ''),
      score: 'AI ' + conf + (s.reason ? ' — ' + String(s.reason).slice(0, 60) : ''),
    });
  }
  return applied;
}

/**
 * Doc-level GST %: tax ÷ (subtotal − discount), snapped to a standard GST
 * slab. A document mixing slabs (18% + 28% lines) yields a blended rate that
 * snaps to nothing → null, shown blank — never a misleading average.
 * Number(null) is 0, so blanks are checked explicitly (a REVIEW row with no
 * tax must NOT read as 0% GST).
 */
function docGstPercent_(subtotal, discount, tax) {
  var toN = function (v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  };
  var s = toN(subtotal), t = toN(tax), d = toN(discount) || 0;
  if (s === null || t === null || s - d <= 0) return null;
  if (t === 0) return 0;
  var eff = (t / (s - d)) * 100;
  var slabs = [0.25, 3, 5, 12, 18, 28];
  for (var i = 0; i < slabs.length; i++) {
    if (Math.abs(eff - slabs[i]) <= 0.15) return slabs[i];
  }
  return null;
}

/** Reads the human-approved Aliases tab → [{alias, uid}]. Missing tab = []. */
function readAliases_(ss) {
  var sh = ss.getSheetByName(CONFIG.SHEETS.ALIASES);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().map(function (r) {
    return { alias: String(r[0] || '').trim(), uid: String(r[1] || '').trim() };
  }).filter(function (a) { return a.alias && a.uid; });
}

/**
 * Pure matching core (unit-tested off-platform).
 * bom:     [{uid, ipn, mpn, desc}]
 * lines:   [{doc, docType, vendor, date, n, desc, pn, qty, rate, amount, currency, check, src}]
 * aliases: [{alias, uid}] — human-approved wordings from the Aliases tab
 */
function computePartPrices_(bom, lines, aliases) {
  var norm = function (s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  // Sheets hands dates back as Date objects; strings come from tests/exports.
  // Compare on epoch millis — string comparison of Date objects sorts
  // alphabetically ("Sat" > "Mon"), not chronologically.
  var ts = function (v) {
    if (v && typeof v.getTime === 'function') return v.getTime();
    var t = Date.parse(String(v));
    return isNaN(t) ? 0 : t;
  };

  var mpnMap = {}, ipnMap = {}, uidMap = {};
  bom.forEach(function (b) {
    var m = norm(b.mpn), i2 = norm(b.ipn), u2 = norm(b.uid);
    if (m.length >= 4 && !mpnMap[m]) mpnMap[m] = b;
    if (i2.length >= 4 && !ipnMap[i2]) ipnMap[i2] = b;
    if (u2.length >= 4 && !uidMap[u2]) uidMap[u2] = b;
  });
  var mpnKeys = Object.keys(mpnMap), ipnKeys = Object.keys(ipnMap);

  // Fab vendors confuse look-alike characters between drawings and POs —
  // the same part arrives as "AMR-BC1-0016" (digit one) and "AMR-BCI-0016"
  // (letter I). Secondary lookup with I→1 / O→0 folded, collision-excluded,
  // always flagged for a human eye.
  var cnorm = function (s) { return norm(s).replace(/I/g, '1').replace(/O/g, '0'); };
  var cMap = {}, cCollide = {};
  bom.forEach(function (b) {
    [b.mpn, b.ipn].forEach(function (v) {
      var ck = cnorm(v);
      if (ck.length < 6) return;
      if (cMap[ck] && cMap[ck].uid !== b.uid) { cCollide[ck] = 1; return; }
      cMap[ck] = b;
    });
  });
  Object.keys(cCollide).forEach(function (ck) { delete cMap[ck]; });

  // The BOM's Component Description column is an identifier too (fab parts
  // often live only there). Exact-equality map: collision-excluded — a desc
  // shared by two BOM rows identifies neither.
  var descExactMap = {}, descCollide = {};
  bom.forEach(function (b) {
    var dk = norm(b.desc);
    if (dk.length < 6) return;
    if (descExactMap[dk] && descExactMap[dk].uid !== b.uid) { descCollide[dk] = 1; return; }
    descExactMap[dk] = b;
  });
  Object.keys(descCollide).forEach(function (dk) { delete descExactMap[dk]; });
  // containment scan keys: only descs carrying a digit (part-number-like,
  // "TSM-ASM-002 bracket") — wordy descs like "PU adhesive sealant" would
  // over-match by containment
  var descKeys = Object.keys(descExactMap).filter(function (dk) { return dk.length >= 8 && /\d/.test(dk); });

  // human-approved wordings — matched exactly (normalized), never fuzzily
  var aliasMap = {};
  var bomByUid = {};
  bom.forEach(function (b) { bomByUid[norm(b.uid)] = b; });
  (aliases || []).forEach(function (a) {
    var target = bomByUid[norm(a.uid)];
    var key = norm(a.alias);
    if (target && key.length >= 4 && !aliasMap[key]) aliasMap[key] = target;
  });

  // All four BOM columns are identifiers. MPNs like "Loctite 243 Blue" or
  // "Sikaflex 227" are product NAMES that appear inside a document line's
  // description, never as a leading part code — so when hard keys fail, look
  // for a sufficiently-specific MPN (normalized length >= 8) contained in the
  // line description. Exactly one BOM hit → flagged match; two or more →
  // ambiguous, refuse rather than guess.
  var descMatch = function (descNorm) {
    if (!descNorm) return null;
    var hitUids = {}, best = null, bestKey = '', bestVia = '';
    var scan = function (keys, map, via, bothWays) {
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        if (key.length < 8) continue;
        var hit2 = descNorm.indexOf(key) !== -1 ||
          (bothWays && descNorm.length >= 8 && key.indexOf(descNorm) !== -1);
        if (hit2) {
          hitUids[map[key].uid] = 1;
          // scan order is priority order — a later scan never relabels a hit
          if (!best || (via === bestVia && key.length > bestKey.length)) { best = map[key]; bestKey = key; bestVia = via; }
        }
      }
    };
    scan(mpnKeys, mpnMap, 'MPN');
    // fab vendors (made-to-print parts) put the internal part number in the
    // line text — scan IPNs the same way
    scan(ipnKeys, ipnMap, 'IPN');
    // ...and sometimes the identifier only exists in the BOM's Component
    // Description. Both directions: PO wording inside BOM desc, or BOM desc
    // inside PO wording (digit-bearing descs only, see descKeys above).
    scan(descKeys, descExactMap, 'BOM-description', true);
    if (Object.keys(hitUids).length !== 1) return null; // ambiguous or none
    return { b: best, via: bestVia };
  };

  // ---- suggestion scorer (ADVISORY ONLY — output goes to the UNMATCHED
  // section for a human tick; it never prices a part by itself) ----
  var tokenize = function (s) {
    return String(s || '').toUpperCase().split(/[^A-Z0-9]+/).filter(function (t) { return t.length >= 2; });
  };
  var df = {};
  var bomTokens = bom.map(function (b) {
    var set = {};
    tokenize(b.mpn + ' ' + b.desc).forEach(function (t) { set[t] = 1; });
    Object.keys(set).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
    return set;
  });
  // generic words ("adhesive", "screw") appear across many BOM rows → low
  // weight; numbers and rare tokens carry the identity → high weight
  var weight = function (t) {
    var w = 1 / (df[t] || 1);
    if (/\d/.test(t)) w *= 3;
    if (t.length >= 5) w *= 1.5;
    return w;
  };
  var suggest = function (text) {
    var lt = {};
    tokenize(text).forEach(function (t) { lt[t] = 1; });
    // denominator counts only tokens the BOM knows — packaging noise like
    // "50ml bottle" must not dilute the score of the tokens that matter
    var known = 0;
    Object.keys(lt).forEach(function (t) { if (df[t]) known += weight(t); });
    if (!known) return null;
    var best = null, second = null;
    bom.forEach(function (b, bi) {
      var toks = bomTokens[bi];
      var shared = 0, totalB = 0, sharedCount = 0, distinctive = false;
      Object.keys(toks).forEach(function (t) {
        var w = weight(t);
        totalB += w;
        if (lt[t]) {
          shared += w;
          sharedCount++;
          if (/\d/.test(t) || df[t] === 1) distinctive = true;
        }
      });
      if (!totalB || sharedCount < 2 || !distinctive) return;
      var score = Math.min(1, shared / Math.min(totalB, known));
      var cand = { b: b, score: score };
      if (!best || score > best.score) { second = best; best = cand; }
      else if (!second || score > second.score) { second = cand; }
    });
    if (!best || best.score < 0.45) return null;
    if (second && second.b.uid !== best.b.uid && second.score >= best.score * 0.8) {
      return { ambiguous: true, a: best.b, b2: second.b };
    }
    return { b: best.b, score: best.score };
  };

  var byUid = {};
  var unmatchedByKey = {};
  var stats = { pnLines: 0, matchedLines: 0, noPnLines: 0, descMatchedLines: 0, aliasLines: 0, suggested: 0 };

  lines.forEach(function (ln) {
    if (ln.check.indexOf('qty×rate OK') !== 0) return; // never price from flagged lines
    var hit = null, type = null;
    var p = norm(ln.pn), dn = norm(ln.desc);

    if (ln.pn) {
      stats.pnLines++;
      if (mpnMap[p]) { hit = mpnMap[p]; type = 'MPN exact'; }
      else if (ipnMap[p]) { hit = ipnMap[p]; type = 'IPN exact'; }
      else if (uidMap[p]) { hit = uidMap[p]; type = 'UID exact'; }
      else if (cMap[cnorm(ln.pn)]) { hit = cMap[cnorm(ln.pn)]; type = 'Exact after I/1 O/0 fold — verify'; }
    }

    // made-to-print fab POs (Arunagiri, Pooja Metallic, ...) write the part
    // number AS the whole line text, often with stray spaces ("TSM -ASM-002")
    // — the normalized full description equals a BOM key exactly. As strong
    // as a pn match, so it sits with the exacts and carries no verify flag.
    if (!hit && dn) {
      if (mpnMap[dn]) { hit = mpnMap[dn]; type = 'MPN exact (description)'; }
      else if (ipnMap[dn]) { hit = ipnMap[dn]; type = 'IPN exact (description)'; }
      else if (uidMap[dn]) { hit = uidMap[dn]; type = 'UID exact (description)'; }
      else if (descExactMap[dn]) {
        // whole line text == a BOM Component Description (collision-free) —
        // text-on-text, so it prices with a verify note
        hit = descExactMap[dn]; type = 'Component description exact — verify';
      }
    }

    // human-approved alias outranks every guess (variant/desc rules below)
    if (!hit && ((p && aliasMap[p]) || (dn && aliasMap[dn]))) {
      hit = aliasMap[p] || aliasMap[dn];
      type = 'Alias (approved)';
      stats.aliasLines++;
    }

    if (!hit && ln.pn && p.length >= 6) {
      // containment variant (packaging suffixes, folded qualifiers) — flagged for a human eye
      for (var k = 0; k < mpnKeys.length && !hit; k++) {
        var key = mpnKeys[k];
        if (key.length >= 6 && (key.indexOf(p) !== -1 || p.indexOf(key) !== -1)) { hit = mpnMap[key]; type = 'MPN variant — verify'; }
      }
      for (var j = 0; j < ipnKeys.length && !hit; j++) {
        var key2 = ipnKeys[j];
        if (key2.length >= 6 && (key2.indexOf(p) !== -1 || p.indexOf(key2) !== -1)) { hit = ipnMap[key2]; type = 'IPN variant — verify'; }
      }
      // fab suffix + look-alike confusion combined ("AMR-BCI-0016-MS-1.5mm-Q2"
      // vs BOM "AMR-BC1-0016") — containment over the I/1 O/0 folded space
      if (!hit) {
        var cp = cnorm(ln.pn);
        var cKeys = Object.keys(cMap);
        for (var q = 0; q < cKeys.length && !hit; q++) {
          var ckey = cKeys[q];
          if (ckey.indexOf(cp) !== -1 || cp.indexOf(ckey) !== -1) {
            hit = cMap[ckey]; type = 'Variant after I/1 O/0 fold — verify';
          }
        }
      }
    }

    if (!hit) {
      var d = descMatch(dn);
      if (d) { hit = d.b; type = d.via + ' in description — verify'; stats.descMatchedLines++; }
    }

    if (!hit) {
      if (!ln.pn) stats.noPnLines++;
      // one unmatched row per distinct wording (pn if present, else the
      // description) — this key is exactly what commitAliases() will save
      var akey = ln.pn || ln.desc.trim();
      if (!akey) return;
      var u = unmatchedByKey[akey] || { count: 0, latest: ln, pn: ln.pn };
      u.count++;
      if (ts(ln.date) > ts(u.latest.date)) u.latest = ln;
      unmatchedByKey[akey] = u;
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
    var anyVariant = agg.buys.some(function (b) { return b.type.indexOf('verify') !== -1; });
    // total ACTUALLY bought across all documents — spares included, which is
    // exactly the point: BOM qty says what the design needs, this says what
    // was really purchased. Spend is money so it goes blank on mixed
    // currencies (adding ₹ to $ is meaningless); qty is units and always sums.
    var totalQty = 0, totalSpend = 0;
    agg.buys.forEach(function (b) {
      totalQty += Number(b.ln.qty) || 0;
      totalSpend += Number(b.ln.amount) || 0;
    });
    return [
      uid, agg.bom.ipn, agg.bom.mpn, agg.bom.desc, agg.buys.length,
      Math.round(totalQty * 1000) / 1000, mixed ? '' : Math.round(totalSpend * 100) / 100,
      latest.ln.rate, latest.ln.currency,
      // international purchases (non-INR) carry no GST — always 0, even if
      // the Register row had no usable tax numbers
      (latest.ln.currency && latest.ln.currency !== 'INR') ? 0 : (latest.ln.gst == null ? '' : latest.ln.gst),
      latest.ln.doc, latest.ln.date, latest.ln.vendor, latest.type,
      mixed ? '' : Math.min.apply(null, rates), mixed ? '' : Math.max.apply(null, rates),
      (mixed ? 'MIXED CURRENCIES — spend/min/max omitted. ' : '') + (anyVariant ? 'Contains variant matches — verify.' : ''),
    ];
  });

  var unmatched = Object.keys(unmatchedByKey).sort().map(function (akey) {
    var u = unmatchedByKey[akey];
    var s = suggest((u.pn ? u.pn + ' ' : '') + u.latest.desc);
    var sugUid = '', sugLabel = '', sugScore = '';
    if (s && s.ambiguous) {
      sugLabel = '2 candidates: ' + s.a.uid + ' / ' + s.b2.uid + ' — type one into Suggested UID';
    } else if (s) {
      sugUid = s.b.uid;
      sugLabel = (s.b.mpn || s.b.ipn || '') + (s.b.desc ? ' — ' + s.b.desc.slice(0, 50) : '');
      sugScore = Math.round(s.score * 100) + '%';
      stats.suggested++;
    }
    return [u.pn || '(no PN)', u.count, u.latest.rate, u.latest.currency,
      u.latest.desc.slice(0, 80), u.latest.doc, sugUid, sugLabel, sugScore, false, akey];
  });

  return { parts: parts, unmatched: unmatched, stats: stats };
}
