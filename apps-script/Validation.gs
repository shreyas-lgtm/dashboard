/**
 * Validation layer: arithmetic checks, dual-read agreement, Zoho PO
 * cross-check, and duplicate detection. Produces a status + reasons.
 */

/**
 * Decide the row's status from all available signals.
 * Returns { status, checks: [..], zohoTotal, secondTotal }.
 */
function validate_(extracted, secondRead, lane, dedupeIndex) {
  var checks = [];
  var passes = 0;

  var total = toNum_(extracted.grand_total);
  var subtotal = toNum_(extracted.subtotal);
  var tax = toNum_(extracted.tax_total);

  // --- Hard failures first ---
  if (total === null || total <= 0) {
    return result_(CONFIG.STATUS.REVIEW, ['no grand total extracted'], null, null);
  }

  var dupeKey = dedupeKey_(extracted);
  if (dupeKey && dedupeIndex[dupeKey]) {
    return result_(CONFIG.STATUS.DUPLICATE,
      ['same vendor + doc number already in Register (row ' + dedupeIndex[dupeKey] + ')'],
      null, null);
  }

  // --- Check 1: arithmetic (subtotal + tax = total) ---
  if (subtotal !== null && tax !== null) {
    if (Math.abs(subtotal + tax - total) <= Math.max(1, total * 0.001)) {
      checks.push('arithmetic OK');
      passes++;
    } else {
      checks.push('ARITHMETIC MISMATCH: ' + subtotal + ' + ' + tax + ' ≠ ' + total);
      return result_(CONFIG.STATUS.REVIEW, checks, null, null);
    }
  } else {
    checks.push('arithmetic not checkable (missing subtotal/tax)');
  }

  // --- Check 2: dual-read agreement (Scans lane, when Document AI ran) ---
  var secondTotal = secondRead ? toNum_(secondRead.grand_total) : null;
  if (lane.dualRead) {
    if (secondTotal !== null) {
      if (closeEnough_(total, secondTotal)) {
        checks.push('dual read agrees');
        passes++;
      } else {
        checks.push('DUAL READ DISAGREES: Claude ' + total + ' vs DocAI ' + secondTotal);
        return result_(CONFIG.STATUS.REVIEW, checks, null, secondTotal);
      }
    } else {
      checks.push('single extractor only (Document AI not configured)');
    }
  }

  // --- Check 3: Zoho PO cross-check (best effort) ---
  var zohoTotal = null;
  var poRef = extracted.po_reference || (extracted.doc_type === 'purchase_order' ? extracted.document_number : null);
  if (poRef) {
    try {
      zohoTotal = lookupZohoPoTotal_(poRef);
      if (zohoTotal !== null) {
        if (extracted.doc_type === 'purchase_order') {
          // A PO document should match its Zoho record exactly-ish.
          if (closeEnough_(total, zohoTotal)) { checks.push('matches Zoho PO'); passes++; }
          else { checks.push('DIFFERS FROM ZOHO PO: doc ' + total + ' vs Zoho ' + zohoTotal); return result_(CONFIG.STATUS.REVIEW, checks, zohoTotal, secondTotal); }
        } else {
          // An invoice may legitimately be a partial billing of the PO —
          // flag only when it EXCEEDS the PO amount.
          if (total <= zohoTotal * (1 + CONFIG.TOTAL_TOLERANCE)) { checks.push('within Zoho PO amount'); passes++; }
          else { checks.push('EXCEEDS ZOHO PO: invoice ' + total + ' vs PO ' + zohoTotal); return result_(CONFIG.STATUS.REVIEW, checks, zohoTotal, secondTotal); }
        }
      } else {
        checks.push('no PO on record (Zoho)');
      }
    } catch (e) {
      checks.push('Zoho lookup failed: ' + e.message);
    }
  } else if (extracted.doc_type === 'invoice') {
    checks.push('no PO reference on invoice');
  }

  // --- Extractor confidence + oddity notes count against auto-accept ---
  if (extracted.confidence === 'low') {
    checks.push('extractor confidence low');
    return result_(CONFIG.STATUS.REVIEW, checks, zohoTotal, secondTotal);
  }

  // --- Decision: how many independent passes does this amount need? ---
  var needed = total >= CONFIG.HIGH_VALUE_THRESHOLD ? 2 : 1;
  var status = passes >= needed ? CONFIG.STATUS.AUTO : CONFIG.STATUS.REVIEW;
  if (status === CONFIG.STATUS.REVIEW) {
    checks.push('needs ' + needed + ' passing check(s), got ' + passes);
  }
  return result_(status, checks, zohoTotal, secondTotal);
}

function result_(status, checks, zohoTotal, secondTotal) {
  return { status: status, checks: checks, zohoTotal: zohoTotal, secondTotal: secondTotal };
}

function dedupeKey_(extracted) {
  if (!extracted.document_number) return null;
  var vendor = String(extracted.vendor_name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  var num = String(extracted.document_number).toLowerCase().replace(/[^a-z0-9]/g, '');
  return vendor + '|' + num;
}

/** Builds { dedupeKey -> rowNumber } from the existing Register. */
function buildDedupeIndex_(sheet) {
  var index = {};
  var last = sheet.getLastRow();
  if (last < 2) return index;
  var data = sheet.getRange(2, 1, last - 1, CONFIG.REGISTER_HEADERS.length).getValues();
  var vendorCol = CONFIG.REGISTER_HEADERS.indexOf('Vendor');
  var numCol = CONFIG.REGISTER_HEADERS.indexOf('Doc Number');
  data.forEach(function (row, i) {
    var key = dedupeKey_({ vendor_name: row[vendorCol], document_number: row[numCol] });
    if (key) index[key] = i + 2;
  });
  return index;
}

/**
 * Looks up a PO total via the dashboard's Vercel proxy.
 * Returns the PO total as a number, or null when not found / proxy not configured.
 */
function lookupZohoPoTotal_(poNumber) {
  var base = PropertiesService.getScriptProperties().getProperty('ZOHO_PROXY_URL');
  if (!base) return null;

  var url = base + '?path=purchaseorders&search_text=' + encodeURIComponent(poNumber);
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('proxy returned ' + res.getResponseCode());
  }
  var pos = (JSON.parse(res.getContentText()).purchaseorders) || [];
  var norm = String(poNumber).toLowerCase().replace(/[^a-z0-9]/g, '');
  for (var i = 0; i < pos.length; i++) {
    var candidate = String(pos[i].purchaseorder_number || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (candidate === norm) return toNum_(pos[i].total);
  }
  return null;
}

function closeEnough_(a, b) {
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * CONFIG.TOTAL_TOLERANCE);
}

function toNum_(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}
