/**
 * Extraction layer — free-tier build.
 *
 *   1. parseZohoPo_()   — deterministic parse of Zoho PO text. Zero API calls.
 *                         Used first for the POs lane.
 *   2. geminiExtract_() — Gemini API (free tier) for invoices, scans, and any
 *                         PO the deterministic parser can't handle.
 *
 * Quota protection: every generateContent call goes through geminiCall_(),
 * which enforces a self-imposed daily budget, paces requests, and converts
 * 429/quota errors into a clean QUOTA_STOP (file stays in inbox, retried on
 * a later run — quota is never wasted on retries).
 */

var EXTRACT_FIELDS_INSTRUCTION =
  'You are a precise data-extraction engine for Indian procurement documents ' +
  '(purchase orders and invoices, often with GST). Extract the fields below ' +
  'from the attached document and respond with ONLY a JSON object — no prose, ' +
  'no markdown fences.\n\n' +
  '{\n' +
  '  "doc_type": "purchase_order" | "invoice" | "other",\n' +
  '  "vendor_name": string | null,        // the SELLER/supplier on an invoice; the SUPPLIER a PO is issued to\n' +
  '  "document_number": string | null,    // invoice number or PO number of THIS document\n' +
  '  "document_date": "YYYY-MM-DD" | null,\n' +
  '  "po_reference": string | null,       // PO number referenced BY an invoice; for a PO, same as document_number\n' +
  '  "currency": string | null,           // ISO code, e.g. "INR"\n' +
  '  "subtotal": number | null,           // before tax, plain number (no separators)\n' +
  '  "discount": number | null,           // discount amount as a POSITIVE number; null if none\n' +
  '  "tax_total": number | null,          // total of CGST+SGST+IGST or other tax\n' +
  '  "grand_total": number | null,        // final payable amount\n' +
  '  "confidence": "high" | "medium" | "low",\n' +
  '  "notes": string | null               // anything odd: handwriting, corrections, multiple documents, unreadable areas\n' +
  '}\n\n' +
  'Rules:\n' +
  '- Amounts must be plain numbers. Indian formats like "1,23,456.78" become 123456.78.\n' +
  '- If an amount-in-words disagrees with the figures, use the figures and say so in notes with confidence "low".\n' +
  '- If a handwritten correction overrides a printed value, use the correction and say so in notes.\n' +
  '- If the file contains MORE THAN ONE document, extract the first and state the count in notes with confidence "low".\n' +
  '- Never guess: use null and lower confidence rather than invent a value.';

// ---------------------------------------------------------------------------
// Deterministic Zoho PO parser (no API calls)
// ---------------------------------------------------------------------------

/**
 * Extracts a PDF's text by converting it to a temporary Google Doc via the
 * Drive REST API (free; also OCRs scanned pages), then deleting the temp doc.
 */
function pdfToText_(file) {
  var token = ScriptApp.getOAuthToken();
  var boundary = 'xxPipelineBoundaryxx';
  var metadata = JSON.stringify({
    name: 'tmp-extract-' + file.getId(),
    mimeType: 'application/vnd.google-apps.document',
  });
  var blob = file.getBlob();
  var payload = Utilities.newBlob(
    '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
    metadata + '\r\n--' + boundary + '\r\nContent-Type: application/pdf\r\n\r\n'
  ).getBytes()
    .concat(blob.getBytes())
    .concat(Utilities.newBlob('\r\n--' + boundary + '--').getBytes());

  var res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'post',
      contentType: 'multipart/related; boundary=' + boundary,
      headers: { Authorization: 'Bearer ' + token },
      payload: payload,
      muteHttpExceptions: true,
    }
  );
  if (res.getResponseCode() !== 200) {
    throw new Error('Drive conversion failed (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300));
  }
  var docId = JSON.parse(res.getContentText()).id;
  try {
    var exp = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + docId + '/export?mimeType=text/plain',
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }
    );
    if (exp.getResponseCode() !== 200) {
      throw new Error('Drive export failed (' + exp.getResponseCode() + ')');
    }
    return exp.getContentText();
  } finally {
    UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + docId, {
      method: 'delete',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
    });
  }
}

/**
 * Normalizes text before regex parsing. Drive's PDF→Doc conversion (and
 * OCR) can emit non-breaking spaces, \r\n endings, and doubled spaces —
 * any of which silently breaks exact-space regexes ("Sub Total" with an
 * NBSP never matches "Sub Total" with a plain space).
 */
function normalizeText_(t) {
  return String(t)
    .replace(/\r\n?/g, '\n')                       // \r\n, \r → \n
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ') // unicode spaces → plain
    .replace(/[^\S\n]+/g, ' ');                    // collapse space runs (keep newlines)
}

/**
 * Deterministic parser for Zoho-format POs (ported from the backfill parser
 * that handled 50/50 real POs with zero errors). Returns an extraction object
 * shaped like the Gemini output, or null if the text doesn't look like a
 * Zoho PO (caller then falls back to Gemini).
 */
function parseZohoPo_(text) {
  text = normalizeText_(text);
  var po = text.match(/#\s*(PO-\d+)/);
  var totalM = text.match(/(?<!Sub )Total\s+(₹|\$|CNY|USD|EUR)?\s*([\d,]+\.?\d*)/);
  if (!po || !totalM) return null;

  var num = function (s) { return parseFloat(s.replace(/,/g, '')); };
  var date = text.match(/Date\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/);
  var ref = text.match(/Ref#\s*:\s*(\S+)/);
  // Vendor name = first non-empty line after "Vendor Address" (tolerates
  // blank lines or the name landing on the same line after conversion).
  var vendor = text.match(/Vendor Address[^\S\n]*:?[^\S\n]*\n+\s*(.+)/) ||
               text.match(/Vendor Address[^\S\n]*:?[^\S\n]+(\S.+)/);
  var sub = text.match(/Sub Total\s+([\d,]+\.?\d*)/);
  var disc = text.match(/Discount\s*\(-\)\s*([\d,]+\.?\d*)/);
  var adj = text.match(/Adjustment\s+(-?[\d,]+\.?\d*)/);
  var taxes = text.match(/(?:IGST|CGST|SGST|UTGST)\S*\s*\([\d.]+%\)\s+[\d,]+\.?\d*/g) || [];
  var taxSum = 0;
  taxes.forEach(function (t) {
    taxSum += num(t.match(/([\d,]+\.?\d*)\s*$/)[1]);
  });

  // Drive conversion sometimes folds the next line (GSTIN, phone) into the
  // vendor line — strip anything from GSTIN/phone onwards.
  var vendorName = vendor ? vendor[1].trim().replace(/\s*(GSTIN|GST IN|Ph(one)?[.:]).*$/i, '').trim() : null;

  var curMap = { '₹': 'INR', '$': 'USD', 'CNY': 'CNY', 'USD': 'USD', 'EUR': 'EUR' };
  var notes = [];
  if (disc) notes.push('discount ' + disc[1]);
  if (adj) notes.push('adjustment ' + adj[1]);
  if (ref) notes.push('ref ' + ref[1]);

  return {
    doc_type: 'purchase_order',
    vendor_name: vendorName,
    document_number: po[1],
    document_date: date ? date[3] + '-' + date[2] + '-' + date[1] : null,
    po_reference: po[1],
    currency: curMap[totalM[1] || '₹'],
    subtotal: sub ? num(sub[1]) : null,
    discount: disc ? num(disc[1]) : 0,
    tax_total: Math.round(taxSum * 100) / 100,
    grand_total: num(totalM[2]),
    confidence: 'high',
    notes: notes.length ? 'deterministic parse; ' + notes.join('; ') : 'deterministic parse',
    line_items: parseZohoPoLines_(text, sub ? num(sub[1]) : null),
  };
}

/**
 * LAYER 2 — Extracts line items (description, qty, UNIT RATE, amount) from
 * Zoho PO text. Deterministic and self-validating: a number run only counts
 * as a line's qty/rate/amount if qty × rate ≈ amount, which makes false
 * matches from numbers inside descriptions ("4:1", "1.0 meter") nearly
 * impossible. Lines must additionally sum to the document subtotal or every
 * line is flagged. Returns [] when no item table is found.
 */
function parseZohoPoLines_(text, subtotal) {
  var HEADER_RE = /#\s*Item\s*&\s*Description(\s+HSN\/SAC)?\s+Qty\s+Rate\s+Amount/;
  var head = HEADER_RE.exec(text);
  if (!head) return [];
  var hasHsn = !!head[1];

  // Region: header → last 'Sub Total'. Drive's conversion can push the
  // numbers AFTER "Authorized Signature"/"Notes", so those markers must NOT
  // terminate the region. If another item header follows the last Sub Total
  // (pdf-extractors that emit totals mid-document at page breaks), fall back
  // to taking everything and stripping totals lines instead.
  var cut = text.lastIndexOf('Sub Total');
  var region;
  if (cut > head.index && !HEADER_RE.test(text.slice(cut))) {
    region = text.slice(head.index, cut);
  } else {
    region = text.slice(head.index);
  }

  region = region
    .replace(/#\s*Item\s*&\s*Description(\s+HSN\/SAC)?\s+Qty\s+Rate\s+Amount/g, '\n') // strip (repeated) headers
    .replace(/(\d[\d,]*\.)\s+(\d)/g, '$1$2')   // rejoin numbers split after the dot: "1,93,898. 30" / "...\n30"
    .replace(/(\d[\d,]*)\n\s*(\.\d+)/g, '$1$2') // ...and split before the dot: "14,63,000\n.00"
    .replace(/^Authorized Signature ?$/gm, '')
    .replace(/^Notes ?$/gm, '')
    // totals lines that leak into the region (page-break layouts)
    .replace(/^(Sub Total|Total\s*[₹$]|Total\s+(CNY|USD|EUR|[\d,])|Discount\s*\(-\)|(IGST|CGST|SGST|UTGST)\S*|Adjustment)[^\n]*$/gm, '')
    .replace(/\n\d{1,2} ?(?=\n)/g, '\n');      // standalone page-number lines

  var isNum = function (t) { return /^-?[\d,]*\d(\.\d+)?$/.test(t); };
  var toN = function (t) { return parseFloat(t.replace(/,/g, '')); };
  var lineOk = function (q, r, a) {
    return q !== null && r !== null && a !== null &&
      Math.abs(q * r - a) <= Math.max(0.51, Math.abs(a) * 0.002);
  };

  var allTokens = region.split(/\s+/).filter(function (t) { return t.length; });

  // ---- PASS 1: pull product-validated qty/rate/amount runs, in order ----
  // A run only counts if qty × rate ≈ amount, so numbers inside
  // descriptions ("4:1", "0.05 mm", "DIN 35") can't form a line.
  var triples = [];
  var rest = [];
  var i = 0;
  while (i < allTokens.length) {
    var consumed = 0;
    var t = allTokens[i];
    var t1 = allTokens[i + 1], t2 = allTokens[i + 2], t3 = allTokens[i + 3], t4 = allTokens[i + 4];

    if (isNum(t)) {
      // (a) HSN qty rate amount
      if (hasHsn && /^\d{4,8}$/.test(t) && t1 && t2 && t3 &&
          isNum(t1) && isNum(t2) && isNum(t3) && lineOk(toN(t1), toN(t2), toN(t3))) {
        triples.push({ hsn: t, qty: toN(t1), rate: toN(t2), amount: toN(t3) });
        consumed = 4;
      // (b) qty rate amount
      } else if (t1 && t2 && isNum(t1) && isNum(t2) && lineOk(toN(t), toN(t1), toN(t2))) {
        triples.push({ hsn: null, qty: toN(t), rate: toN(t1), amount: toN(t2) });
        consumed = 3;
      // (c) qty rate-splitAcrossTokens amount: "18.00 376.3333 33 6,774.00"
      } else if (t1 && t2 && t3 && isNum(t1) && t1.indexOf('.') !== -1 &&
                 /^\d{1,4}$/.test(t2) && isNum(t3) &&
                 lineOk(toN(t), parseFloat(t1.replace(/,/g, '') + t2), toN(t3))) {
        triples.push({ hsn: null, qty: toN(t), rate: parseFloat(t1.replace(/,/g, '') + t2), amount: toN(t3) });
        consumed = 4;
      // (d) HSN + split rate
      } else if (hasHsn && /^\d{4,8}$/.test(t) && t1 && t2 && t3 && t4 &&
                 isNum(t1) && isNum(t2) && t2.indexOf('.') !== -1 &&
                 /^\d{1,4}$/.test(t3) && isNum(t4) &&
                 lineOk(toN(t1), parseFloat(t2.replace(/,/g, '') + t3), toN(t4))) {
        triples.push({ hsn: t, qty: toN(t1), rate: parseFloat(t2.replace(/,/g, '') + t3), amount: toN(t4) });
        consumed = 5;
      }
    }
    if (consumed) { i += consumed; }
    else { rest.push(t); i++; }
  }
  if (!triples.length) return [];

  // ---- PASS 2: split the remaining text into description segments by the
  // printed item numbers 1, 2, 3, ... (Zoho column-flow layouts emit several
  // descriptions in a block, then their numbers in a block — pairing by
  // document order is the layout's own contract). A guard rejects an index
  // lookalike right after a separator ("2D-Lidar 1 / 2 Mount").
  var SEP = { '/': 1, '-': 1, '–': 1, 'x': 1, 'X': 1, 'to': 1, '(': 1, '&': 1, '@': 1, '+': 1 };
  var segs = [];
  var cur = null;
  var expected = 1;
  var prev = '';
  for (var k = 0; k < rest.length; k++) {
    var tok = rest[k];
    if (tok === String(expected) && !SEP[prev]) {
      if (cur !== null) segs.push(cur);
      cur = [];
      expected++;
    } else if (cur !== null) {
      cur.push(tok);
    }
    prev = tok;
  }
  if (cur !== null) segs.push(cur);

  // ---- Pair descriptions with number runs ----
  // A single line is never ambiguous: all description text belongs to it,
  // even if a numbered sub-list inside the description over-segmented.
  var items = [];
  var aligned = segs.length === triples.length || triples.length === 1;
  for (var n = 0; n < triples.length; n++) {
    var descTokens = triples.length === 1 ? rest : (aligned ? segs[n] : (n === 0 ? rest : []));
    items.push(makeLine_(n + 1, descTokens, triples[n].hsn, triples[n].qty, triples[n].rate, triples[n].amount,
      aligned ? '' : '; DESC UNALIGNED (' + segs.length + ' descs vs ' + triples.length + ' lines)'));
  }

  // ---- Reconcile: line amounts must sum to the document subtotal ----
  if (subtotal !== null) {
    var sum = 0;
    items.forEach(function (it) { sum += it.amount; });
    if (Math.abs(sum - subtotal) > Math.max(1, subtotal * 0.001)) {
      items.forEach(function (it) {
        it.check = 'SUM MISMATCH: lines total ' + Math.round(sum * 100) / 100 + ' vs subtotal ' + subtotal;
      });
    }
  }
  return items;
}

function makeLine_(n, descTokens, hsn, qty, rate, amount, checkSuffix) {
  var d = descTokens.join(' ')
    .replace(/\s*\bNotes\b\s.*$/, '')        // strip Notes block folded into a description
    .replace(/\s*\bMade as per\b.*$/i, '')   // ...and its content when the "Notes" line was already removed
    .replace(/\s+/g, ' ')
    .trim();
  // Manufacturer part number: an explicit label wins; else a code-like first token.
  var pn = null;
  var lbl = d.match(/part number[:\s]*([A-Za-z0-9][A-Za-z0-9\-\._\/]{2,})/i);
  if (lbl) pn = lbl[1];
  else {
    var first = d.split(' ')[0] || '';
    if (/^[A-Z0-9][A-Za-z0-9\-\._\/:]{4,}$/.test(first) && /\d/.test(first) && /[A-Za-z]/.test(first)) {
      pn = first.replace(/[:.,]$/, '');
    }
  }
  return {
    n: n, description: d, part_number: pn, hsn: hsn,
    qty: qty, rate: rate, amount: Math.round(amount * 100) / 100,
    check: 'qty×rate OK' + (checkSuffix || ''),
  };
}

// ---------------------------------------------------------------------------
// Gemini (free tier) extraction
// ---------------------------------------------------------------------------

function geminiExtract_(file, laneDocType) {
  var blob = file.getBlob();
  var mime = blob.getContentType();
  if (mime === 'image/jpg') mime = 'image/jpeg';
  var ok = mime === 'application/pdf' || /^image\/(png|jpeg|gif|webp)$/.test(mime);
  if (!ok) throw new Error('Unsupported file type: ' + mime);

  var hint = laneDocType === 'auto'
    ? 'The document may be a purchase order or an invoice.'
    : 'This folder should contain only documents of type "' + laneDocType +
      '". If this document is clearly a different type, still extract it but flag the mismatch in notes.';

  var body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: mime, data: Utilities.base64Encode(blob.getBytes()) } },
        { text: hint + '\n\n' + EXTRACT_FIELDS_INSTRUCTION },
      ],
    }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: CONFIG.GEMINI.MAX_OUTPUT_TOKENS,
      responseMimeType: 'application/json',
    },
  };

  var data = geminiCall_(body);

  // Distinguish the failure modes precisely — a generic "no text" hides
  // exactly the kind of silent-nothing-parses problem we're guarding against.
  if (data.promptFeedback && data.promptFeedback.blockReason) {
    throw new Error('Gemini blocked the document (' + data.promptFeedback.blockReason + ')');
  }
  var cand = (data.candidates || [])[0];
  if (!cand) throw new Error('Gemini returned no candidates: ' + JSON.stringify(data).slice(0, 300));
  var parts = (cand.content || {}).parts || [];
  var text = parts.map(function (p) { return p.text || ''; }).join('');
  if (cand.finishReason === 'MAX_TOKENS') {
    throw new Error('Gemini output truncated (MAX_TOKENS) — raise CONFIG.GEMINI.MAX_OUTPUT_TOKENS');
  }
  if (!text) {
    throw new Error('Gemini returned no text (finishReason: ' + (cand.finishReason || '?') + ')');
  }
  return parseJsonLoose_(text);
}

/**
 * The model actually used for calls: a discovered override (set by
 * self-healing below) wins over the configured default.
 */
function effectiveGeminiModel_() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL_ACTIVE') ||
         CONFIG.GEMINI.MODEL;
}

/**
 * Discovers the best Flash-family model this key can actually use, via
 * ListModels (free — no generation quota). Prefers newest version, full
 * Flash over Lite, stable over preview/experimental.
 */
function resolveGeminiModel_() {
  var res = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + getProp_('GEMINI_API_KEY'),
    { muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) return null;
  var names = (JSON.parse(res.getContentText()).models || [])
    .filter(function (m) {
      return (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1;
    })
    .map(function (m) { return m.name.replace('models/', ''); })
    .filter(function (n) {
      return /flash/.test(n) && !/preview|exp|image|tts|live|audio|thinking|8b/.test(n);
    });
  if (!names.length) return null;
  var score = function (n) {
    var v = parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [0, '0'])[1]) * 100;
    if (!/lite/.test(n)) v += 10;   // full flash beats lite
    if (/latest/.test(n)) v += 1;   // "-latest" alias beats dated snapshot
    return v;
  };
  names.sort(function (a, b) { return score(b) - score(a); });
  return names[0];
}

/**
 * The single funnel for every generateContent call. Enforces the daily
 * budget, paces requests, turns quota errors into QUOTA_STOP, and
 * SELF-HEALS model retirement: on "model not available" it re-discovers a
 * usable Flash model via ListModels, remembers it, and retries once.
 */
function geminiCall_(body, isRetry) {
  if (!budgetAvailable_()) {
    throw new Error(QUOTA_STOP + ': self-imposed daily budget (' + CONFIG.GEMINI.DAILY_BUDGET + ') reached');
  }

  // Pace: stay far below the free RPM limit.
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty('GEMINI_LAST_CALL_MS') || 0);
  var wait = last + CONFIG.GEMINI.MIN_MS_BETWEEN_CALLS - Date.now();
  if (wait > 0) Utilities.sleep(wait);

  var model = effectiveGeminiModel_();
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    model + ':generateContent?key=' + getProp_('GEMINI_API_KEY');

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  props.setProperty('GEMINI_LAST_CALL_MS', String(Date.now()));
  recordBudgetUse_();

  var code = res.getResponseCode();
  if (code === 429) {
    // Real quota hit (RPM or RPD). Do NOT retry — that burns more quota.
    markQuotaExhausted_();
    throw new Error(QUOTA_STOP + ': Gemini returned 429 (quota). Will retry on a later run.');
  }
  if (code >= 500) {
    // Transient Google-side error (503 overloaded, 500). NOT a document
    // problem: leave the file in the inbox and retry on the next run.
    throw new Error(QUOTA_STOP + ': Gemini ' + code + ' (server busy) — file stays in inbox, retried next run.');
  }
  var text = res.getContentText();
  if (code === 404 && /no longer available|not found|NOT_FOUND/i.test(text) && !isRetry) {
    var next = resolveGeminiModel_();
    if (next && next !== model) {
      props.setProperty('GEMINI_MODEL_ACTIVE', next);
      log_('Gemini model "' + model + '" unavailable for this key — switched to "' + next + '" (auto-discovered).');
      return geminiCall_(body, true);
    }
  }
  if (code !== 200) {
    throw new Error('Gemini API error ' + code + ' (model ' + model + '): ' + text.slice(0, 400));
  }
  return JSON.parse(text);
}

// --- Daily budget bookkeeping (resets at midnight Pacific, like Google's) ---

function quotaDayKey_() {
  return Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');
}

function budgetState_() {
  var raw = PropertiesService.getScriptProperties().getProperty('GEMINI_BUDGET');
  var s = raw ? JSON.parse(raw) : {};
  if (s.day !== quotaDayKey_()) s = { day: quotaDayKey_(), used: 0, exhausted: false };
  return s;
}

function saveBudgetState_(s) {
  PropertiesService.getScriptProperties().setProperty('GEMINI_BUDGET', JSON.stringify(s));
}

function budgetAvailable_() {
  var s = budgetState_();
  return !s.exhausted && s.used < CONFIG.GEMINI.DAILY_BUDGET;
}

function recordBudgetUse_() {
  var s = budgetState_();
  s.used++;
  saveBudgetState_(s);
}

function markQuotaExhausted_() {
  var s = budgetState_();
  s.exhausted = true;
  saveBudgetState_(s);
}

function isQuotaStop_(e) {
  return e && String(e.message || e).indexOf(QUOTA_STOP) !== -1;
}

// ---------------------------------------------------------------------------
// Setup helpers — verify the key/model WITHOUT spending generation quota
// ---------------------------------------------------------------------------

/**
 * Run manually from the editor. Calls ListModels (does not count against
 * generateContent quota) and confirms the configured model is available to
 * your key. Check the execution log for the result.
 */
function testGeminiSetup() {
  var res = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=' + getProp_('GEMINI_API_KEY'),
    { muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) {
    console.log('KEY PROBLEM — ListModels returned ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 400));
    return;
  }
  var models = (JSON.parse(res.getContentText()).models || []).map(function (m) {
    return m.name.replace('models/', '');
  });
  console.log('Key is valid. ' + models.length + ' models visible.');
  console.log('Configured model: "' + CONFIG.GEMINI.MODEL + '". Active override: ' +
    (PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL_ACTIVE') || '(none)'));
  console.log('Auto-discovery would pick: "' + resolveGeminiModel_() + '"');
  console.log('Flash-family models visible: ' +
    models.filter(function (m) { return m.indexOf('flash') !== -1 && m.indexOf('preview') === -1; }).join(', '));
  var s = budgetState_();
  console.log('Budget today: ' + s.used + '/' + CONFIG.GEMINI.DAILY_BUDGET + ' used' + (s.exhausted ? ' (EXHAUSTED flag set)' : ''));
}

/**
 * Optional, run manually: makes exactly ONE tiny generateContent call
 * (costs 1 request of daily quota) to prove end-to-end generation works.
 */
function pingGemini() {
  var data = geminiCall_({
    contents: [{ parts: [{ text: 'Reply with exactly: OK' }] }],
    generationConfig: { maxOutputTokens: 5, temperature: 0 },
  });
  console.log(JSON.stringify(data.candidates[0].content.parts));
}

/** Tolerant JSON parse: strips markdown fences and leading/trailing prose. */
function parseJsonLoose_(text) {
  var cleaned = String(text).replace(/```(json)?/g, '').trim();
  var start = cleaned.indexOf('{');
  var end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('Extractor returned no JSON: ' + cleaned.slice(0, 200));
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}
