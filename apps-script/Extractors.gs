/**
 * Extraction layer: Claude (primary, all lanes) and Google Document AI
 * (secondary cross-check for the Scans lane, optional).
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

/**
 * Runs Claude extraction on a Drive file (PDF or image).
 * Returns the parsed JSON object.
 */
function claudeExtract_(file, laneDocType) {
  var blob = file.getBlob();
  var mime = blob.getContentType();
  var contentBlock;

  if (mime === 'application/pdf') {
    contentBlock = {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: Utilities.base64Encode(blob.getBytes()) },
    };
  } else if (/^image\/(png|jpeg|jpg|gif|webp)$/.test(mime)) {
    contentBlock = {
      type: 'image',
      source: { type: 'base64', media_type: mime === 'image/jpg' ? 'image/jpeg' : mime, data: Utilities.base64Encode(blob.getBytes()) },
    };
  } else {
    throw new Error('Unsupported file type: ' + mime);
  }

  var hint = laneDocType === 'auto'
    ? 'The document may be a purchase order or an invoice.'
    : 'This folder should contain only documents of type "' + laneDocType +
      '". If this document is clearly a different type, still extract it but flag the mismatch in notes.';

  var payload = {
    model: CONFIG.CLAUDE_MODEL,
    max_tokens: CONFIG.CLAUDE_MAX_TOKENS,
    messages: [{
      role: 'user',
      content: [contentBlock, { type: 'text', text: hint + '\n\n' + EXTRACT_FIELDS_INSTRUCTION }],
    }],
  };

  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': getProp_('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  if (res.getResponseCode() !== 200) {
    throw new Error('Claude API error ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 500));
  }

  var body = JSON.parse(res.getContentText());
  var text = (body.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('');

  return parseJsonLoose_(text);
}

/**
 * Runs Google Document AI Invoice Parser on a Drive file (optional 2nd read).
 * Returns { grand_total, vendor_name, document_number } or null when not configured.
 * Requires the Apps Script project to be attached to the same GCP project.
 */
function docAiExtract_(file) {
  if (!docAiConfigured_()) return null;

  var p = PropertiesService.getScriptProperties();
  var project = p.getProperty('DOCAI_PROJECT_ID');
  var location = p.getProperty('DOCAI_LOCATION');
  var processor = p.getProperty('DOCAI_PROCESSOR_ID');

  var url = 'https://' + location + '-documentai.googleapis.com/v1/projects/' +
    project + '/locations/' + location + '/processors/' + processor + ':process';

  var blob = file.getBlob();
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({
      rawDocument: {
        content: Utilities.base64Encode(blob.getBytes()),
        mimeType: blob.getContentType(),
      },
    }),
    muteHttpExceptions: true,
  });

  if (res.getResponseCode() !== 200) {
    throw new Error('Document AI error ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 500));
  }

  var doc = JSON.parse(res.getContentText()).document || {};
  var out = { grand_total: null, vendor_name: null, document_number: null };
  (doc.entities || []).forEach(function (e) {
    if (e.type === 'total_amount') out.grand_total = numFromDocAi_(e);
    if (e.type === 'supplier_name') out.vendor_name = e.mentionText || null;
    if (e.type === 'invoice_id') out.document_number = e.mentionText || null;
  });
  return out;
}

function numFromDocAi_(entity) {
  if (entity.normalizedValue && entity.normalizedValue.moneyValue) {
    var m = entity.normalizedValue.moneyValue;
    return Number(m.units || 0) + Number(m.nanos || 0) / 1e9;
  }
  var n = parseFloat(String(entity.mentionText || '').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
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
