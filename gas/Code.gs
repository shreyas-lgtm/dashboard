/**************** CONFIG ****************/
const CONFIG = {
  SHEET_NAME: "Form responses 1",
  HEADERS: {
    TIMESTAMP: "Timestamp",
    EMAIL: "Email address",
    ITEM: "Item Name/ Description",
    QTY: "Quantity",
    ESTIMATE: "Estimate",
    PART_NUMBER: "Part Number/Link",
    LINK: "Link",
    JUSTIFICATION: "Justification for Purchase",
    FINAL_APPROVAL: "Final Approval",
    MANAGER_APPROVAL: "Manager Approval",
    URGENCY_LEVEL: "Urgency Level",
    TEAM: "Team",
    PREFERRED_VENDOR: "Preferred Vendor/ Source",
    PR_ID: "PR_ID",
    ATTACHMENT: "Attachment",
    ORDER_STATUS: "Order Status",
    PRODUCT_CATEGORY: "Product Main Category",
    LEAD_TIME: "Lead time",
    ETA: "ETA",
    APPROVAL_DATE: "Approval Date",
    ORDERED_DATE: "Ordered Date"
  },
  ORDER_STATUS_DEFAULT: "Pending",
  PR_PREFIX: "PR"
};

/**************** HELPERS ****************/

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) throw new Error(`Sheet not found: ${CONFIG.SHEET_NAME}`);
  return sh;
}

function getHeaderMap_(sh) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h, i) => { if (h && String(h).trim()) map[String(h).trim()] = i + 1; });
  return map;
}

function col_(map, headerName) {
  const c = map[headerName];
  if (!c) throw new Error(`Missing column header: "${headerName}"`);
  return c;
}

/**
 * Classifies an Order Status value into one of 10 pipeline stages.
 * Stages: pending_requester, pending_sourcing, sourcing, quotation,
 *         ordered, paid, in_transit, delivered, handed_over, cancelled
 */
function classifyOrderStatus_(osRaw) {
  const os = String(osRaw || '').trim().toLowerCase();
  if (!os) return 'pending_requester';

  // Cancellation – check early
  if (os.includes('cancel')) return 'cancelled';

  // Completed delivery states
  if (os.includes('handed over') || os.includes('handover') || os.includes('hand over')) return 'handed_over';
  if (os.includes('delivered') || os.includes('received by team') || os.includes('received by requester')) return 'delivered';

  // Transit
  if (os.includes('in transit') || os.includes('shipped') || os.includes('dispatched') || os.includes('courier')) return 'in_transit';

  // Paid (check before ordered to catch "paid and ordered" style values)
  if (os === 'paid' || os.includes('payment done') || os.includes('payment sent') ||
      os.includes('payment completed') || (os.includes('paid') && !os.includes('prepaid'))) return 'paid';

  // Ordered
  if (os === 'ordered' || os.includes('order placed') || os.includes('po issued') ||
      os.includes('po raised') || os.includes('purchase order sent')) return 'ordered';

  // Quotation / RFQ / Negotiation
  if (os === 'quotation' || os === 'rfq' || os.includes('quotation') ||
      os.includes('quote') || os.includes('negotiat') || os.includes('rfq')) return 'quotation';

  // Specific pending sub-states
  if (os.includes('pending from requester') || os.includes('pending from requestor') ||
      os.includes('pending - requester') || os.includes('pending-requester')) return 'pending_requester';
  if (os.includes('pending from sourcing') || os.includes('pending from sourcing team') ||
      os.includes('pending - sourcing') || os.includes('pending-sourcing') ||
      os.includes('pending sourcing')) return 'pending_sourcing';

  // Generic sourcing / vendor search
  if (os === 'sourcing' || os.includes('sourcing') || os.includes('vendor search') ||
      os.includes('finding vendor') || os.includes('looking for vendor')) return 'sourcing';

  // Generic pending fallback
  if (os.includes('pending')) return 'pending_requester';

  // Default: newly approved items with no clear status → sourcing
  return 'sourcing';
}

/** Returns a normalised approval status string for a column value */
function normaliseApproval_(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'approved') return 'approved';
  if (v === 'rejected') return 'rejected';
  if (v === 'reverify' || v === 're-verify' || v === 'reverify') return 'reverify';
  return 'pending';
}

/**************** PR GENERATOR ****************/

function nextPRID_(sh, headerMap) {
  try {
    const prCol = col_(headerMap, CONFIG.HEADERS.PR_ID);
    const year = new Date().getFullYear();
    const prefix = `${CONFIG.PR_PREFIX}-${year}-`;
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return `${prefix}0001`;
    const prValues = sh.getRange(2, prCol, lastRow - 1, 1).getValues().flat();
    let maxSeq = 0;
    for (const v of prValues) {
      if (!v || typeof v !== "string" || !v.startsWith(prefix)) continue;
      const seq = parseInt(v.split("-")[2], 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
    return `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
  } catch (error) { Logger.log(`Error in nextPRID_: ${error.message}`); throw error; }
}

/**************** TRIGGERS ****************/

function onFormSubmit(e) {
  try {
    if (!e || !e.range) return;
    const sh = getSheet_();
    const headerMap = getHeaderMap_(sh);
    const row = e.range.getRow();
    const prCol = col_(headerMap, CONFIG.HEADERS.PR_ID);
    const statusCol = col_(headerMap, CONFIG.HEADERS.ORDER_STATUS);
    if (!sh.getRange(row, prCol).getValue()) sh.getRange(row, prCol).setValue(nextPRID_(sh, headerMap));
    if (!sh.getRange(row, statusCol).getValue()) sh.getRange(row, statusCol).setValue(CONFIG.ORDER_STATUS_DEFAULT);
  } catch (error) {
    Logger.log(`Error in onFormSubmit: ${error.message}`);
    const email = Session.getActiveUser().getEmail();
    if (email) MailApp.sendEmail(email, "Error in PR Script", `${error.message}\n\n${error.stack}`);
  }
}

function onEdit(e) { onEditWithExport(e); }

/**************** MANUAL TEST FUNCTIONS ****************/

function testPRIDGeneration() {
  try { Browser.msgBox(`Next PR_ID: ${nextPRID_(getSheet_(), getHeaderMap_(getSheet_()))}`); }
  catch (e) { Browser.msgBox(`Error: ${e.message}`); }
}

function backfillMissingPRIDs() {
  try {
    const sh = getSheet_(); const headerMap = getHeaderMap_(sh);
    const prCol = col_(headerMap, CONFIG.HEADERS.PR_ID);
    const lastRow = sh.getLastRow(); let count = 0;
    for (let row = 2; row <= lastRow; row++) {
      if (!sh.getRange(row, prCol).getValue()) {
        sh.getRange(row, prCol).setValue(nextPRID_(sh, headerMap)); count++;
        SpreadsheetApp.flush();
      }
    }
    Browser.msgBox(`Updated ${count} rows with PR_IDs`);
  } catch (e) { Browser.msgBox(`Error: ${e.message}`); }
}

/**************** EMAIL NOTIFICATION ****************/

function sendPRUpdateEmail_(sh, headerMap, row, editedCol) {
  const H = CONFIG.HEADERS;
  const email = sh.getRange(row, col_(headerMap, H.EMAIL)).getValue();
  if (!email) return;
  const prId = sh.getRange(row, col_(headerMap, H.PR_ID)).getValue() || "(no PR_ID)";
  const item = sh.getRange(row, col_(headerMap, H.ITEM)).getValue() || "";
  const qty = sh.getRange(row, col_(headerMap, H.QTY)).getValue() || "";
  const estimate = sh.getRange(row, col_(headerMap, H.ESTIMATE)).getValue() || "";
  const orderStatus = sh.getRange(row, col_(headerMap, H.ORDER_STATUS)).getValue() || "";
  const lead = sh.getRange(row, col_(headerMap, H.LEAD_TIME)).getValue() || "";
  const eta = sh.getRange(row, col_(headerMap, H.ETA)).getValue() || "";
  const fa = sh.getRange(row, col_(headerMap, H.FINAL_APPROVAL)).getValue() || "";
  const ma = sh.getRange(row, col_(headerMap, H.MANAGER_APPROVAL)).getValue() || "";
  const urg = sh.getRange(row, col_(headerMap, H.URGENCY_LEVEL)).getValue() || "";
  const team = sh.getRange(row, col_(headerMap, H.TEAM)).getValue() || "";
  const changed = Object.entries(H).find(([k, h]) => { try { return col_(headerMap, h) === editedCol; } catch(e) { return false; } });
  const subject = `${prId} | ${changed ? changed[1] : "Purchase Request"} Updated`;
  const body = `Hi,\n\nUpdate on your Purchase Request.\n\nPR ID: ${prId}\nItem: ${item}\nQty: ${qty}\n${estimate ? 'Estimate: '+estimate+'\n' : ''}\nOrder Status: ${orderStatus||"Not set"}\nUrgency: ${urg||"Not set"}\nTeam: ${team||"Not set"}\n\nLead time: ${lead||"N/A"}\nETA: ${eta||"N/A"}\n\nFinal Approval: ${fa||"Pending"}\nManager Approval: ${ma||"Pending"}\n\nRegards,\nProcurement Team`;
  try { MailApp.sendEmail(email, subject, body); } catch(e) { Logger.log(`Email error: ${e.message}`); }
}

/**************** EXPENSE EXPORT CONFIG ****************/
const EXPORT_CONFIG = {
  SOURCE_SHEET: "Form responses 1", EXPORT_SHEET: "Expense Tracker",
  EXPORT_STATUSES: ["Paid", "Handed Over"],
  EXPORT_COLUMNS: { ITEM: "Item Name/ Description", QUANTITY: "Quantity", PRODUCT_CATEGORY: "Product Main Category", PR_ID: "PR_ID", ORDER_STATUS: "Order Status", TIMESTAMP: "Timestamp" }
};

/**************** EXPENSE EXPORT FUNCTIONS ****************/

function getOrCreateExpenseSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let es = ss.getSheetByName(EXPORT_CONFIG.EXPORT_SHEET);
  if (!es) {
    es = ss.insertSheet(EXPORT_CONFIG.EXPORT_SHEET);
    const h = ["PR_ID","Item Name/ Description","Quantity","Product Main Category","Sub Category","Amount","Order Status","Export Date","Original Request Date"];
    es.getRange(1,1,1,h.length).setValues([h]).setFontWeight("bold").setBackground("#4285F4").setFontColor("#FFFFFF");
    es.setFrozenRows(1);
  }
  return es;
}

function isAlreadyExported_(es, prId) {
  if (!prId || es.getLastRow() < 2) return false;
  return es.getRange(2,1,es.getLastRow()-1,1).getValues().flat().includes(prId);
}

function updateExistingEntry_(es, prId, newStatus) {
  if (es.getLastRow() < 2) return false;
  const ids = es.getRange(2,1,es.getLastRow()-1,1).getValues().flat();
  for (let i = 0; i < ids.length; i++) { if (ids[i] === prId) { es.getRange(i+2,7).setValue(newStatus); return true; } }
  return false;
}

function exportToExpenseTracker_(src, hm, row) {
  const es = getOrCreateExpenseSheet_(); const EC = EXPORT_CONFIG.EXPORT_COLUMNS;
  const prId = src.getRange(row, col_(hm, EC.PR_ID)).getValue();
  if (isAlreadyExported_(es, prId)) { updateExistingEntry_(es, prId, src.getRange(row, col_(hm, EC.ORDER_STATUS)).getValue()); return false; }
  es.appendRow([prId, src.getRange(row, col_(hm, EC.ITEM)).getValue(), src.getRange(row, col_(hm, EC.QUANTITY)).getValue(), src.getRange(row, col_(hm, EC.PRODUCT_CATEGORY)).getValue(), "", "", src.getRange(row, col_(hm, EC.ORDER_STATUS)).getValue(), new Date(), src.getRange(row, col_(hm, EC.TIMESTAMP)).getValue()]);
  return true;
}

function shouldExport_(status) { return status && EXPORT_CONFIG.EXPORT_STATUSES.includes(status); }

/**************** ENHANCED ONEDIT (WITH AUTO-STAMPING) ****************/

function onEditWithExport(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== CONFIG.SHEET_NAME || e.range.getRow() === 1) return;
    const headerMap = getHeaderMap_(sh);
    const editedCol = e.range.getColumn();
    const editedRow = e.range.getRow();

    // Auto-stamp Approval Date
    const approvalCol = col_(headerMap, CONFIG.HEADERS.FINAL_APPROVAL);
    if (editedCol === approvalCol && String(e.value||'').trim().toLowerCase() === 'approved') {
      try { const c = col_(headerMap, CONFIG.HEADERS.APPROVAL_DATE); if (!sh.getRange(editedRow, c).getValue()) sh.getRange(editedRow, c).setValue(new Date()); } catch(err) {}
    }

    // Auto-stamp Ordered Date
    const statusCol = col_(headerMap, CONFIG.HEADERS.ORDER_STATUS);
    if (editedCol === statusCol) {
      const ns = classifyOrderStatus_(String(e.value||'').trim());
      if (ns === 'ordered' || ns === 'paid' || ns === 'in_transit') {
        try { const c = col_(headerMap, CONFIG.HEADERS.ORDERED_DATE); if (!sh.getRange(editedRow, c).getValue()) sh.getRange(editedRow, c).setValue(new Date()); } catch(err) {}
      }
    }

    // Email notifications
    const watchCols = [CONFIG.HEADERS.ORDER_STATUS, CONFIG.HEADERS.LEAD_TIME, CONFIG.HEADERS.ETA, CONFIG.HEADERS.FINAL_APPROVAL, CONFIG.HEADERS.MANAGER_APPROVAL]
      .map(h => { try { return col_(headerMap, h); } catch(e) { return null; } }).filter(c => c !== null);
    if (watchCols.includes(editedCol) && !(typeof e.oldValue !== "undefined" && String(e.oldValue) === String(e.value))) {
      sendPRUpdateEmail_(sh, headerMap, editedRow, editedCol);
    }

    // Expense export
    if (editedCol === statusCol) {
      if (shouldExport_(e.value)) exportToExpenseTracker_(sh, headerMap, editedRow);
      else if (shouldExport_(e.oldValue) && !shouldExport_(e.value)) {
        updateExistingEntry_(getOrCreateExpenseSheet_(), sh.getRange(editedRow, col_(headerMap, CONFIG.HEADERS.PR_ID)).getValue(), e.value);
      }
    }
  } catch (error) { Logger.log(`Error in onEditWithExport: ${error.message}`); }
}

/**************** BULK EXPORT ****************/

function backfillHandedOverItems() {
  try {
    const sh = getSheet_(); const hm = getHeaderMap_(sh);
    const sc = col_(hm, CONFIG.HEADERS.ORDER_STATUS); const lr = sh.getLastRow();
    let exp = 0, upd = 0;
    for (let r = 2; r <= lr; r++) {
      if (shouldExport_(sh.getRange(r, sc).getValue())) { if (exportToExpenseTracker_(sh, hm, r)) exp++; else upd++; }
      if (r % 50 === 0) SpreadsheetApp.flush();
    }
    SpreadsheetApp.flush();
    Browser.msgBox(`New: ${exp}, Updated: ${upd}`);
  } catch (e) { Browser.msgBox(`Error: ${e.message}`); }
}

function viewExportSummary() {
  try {
    const es = getOrCreateExpenseSheet_(); const lr = es.getLastRow();
    if (lr < 2) { Browser.msgBox("No items exported"); return; }
    const counts = {};
    es.getRange(2,7,lr-1,1).getValues().flat().forEach(s => { counts[s] = (counts[s]||0)+1; });
    let msg = `Total: ${lr-1}\n\n`;
    for (const [s,c] of Object.entries(counts)) msg += `${s}: ${c}\n`;
    Browser.msgBox(msg);
  } catch (e) { Browser.msgBox(`Error: ${e.message}`); }
}

/**************** PAYMENT REPORT ****************/
const PAYMENT_CONFIG = {
  SOURCE_SHEET: "Form responses 1", PAYMENT_REPORT_SHEET: "Founder Payment Report",
  REPORT_COLUMNS: { PR_ID: "PR_ID", VENDOR: "Preferred Vendor/ Source", ITEM: "Item Name/ Description", QUANTITY: "Quantity", PRODUCT_CATEGORY: "Product Main Category", ORDER_STATUS: "Order Status", FINAL_APPROVAL: "Final Approval" }
};

function getOrCreatePaymentReportSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let rs = ss.getSheetByName(PAYMENT_CONFIG.PAYMENT_REPORT_SHEET);
  if (!rs) {
    rs = ss.insertSheet(PAYMENT_CONFIG.PAYMENT_REPORT_SHEET);
    const h = ["Select","PR_ID","Item Name/ Description","Quantity","Vendor Name","Bill No.","Founder Approval","Product Main Category","Sub Category","Amount"];
    rs.getRange(1,1,1,h.length).setValues([h]).setFontWeight("bold").setBackground("#0F9D58").setFontColor("#FFFFFF").setHorizontalAlignment("center");
    rs.setFrozenRows(1);
  }
  return rs;
}

function addItemsToFounderReport() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet(); const ui = SpreadsheetApp.getUi();
    const resp = ui.prompt('Add Items','Enter PR_IDs (comma-separated):',ui.ButtonSet.OK_CANCEL);
    if (resp.getSelectedButton() !== ui.Button.OK) return;
    const prIds = resp.getResponseText().trim().split(',').map(s=>s.trim()).filter(Boolean);
    if (!prIds.length) { ui.alert('No PR_IDs'); return; }
    const src = getSheet_(); const hm = getHeaderMap_(src); const rs = getOrCreatePaymentReportSheet_();
    const es = ss.getSheetByName(EXPORT_CONFIG.EXPORT_SHEET); if (!es) { ui.alert('Expense Tracker not found'); return; }
    const em = {}; if (es.getLastRow()>=2) es.getRange(2,1,es.getLastRow()-1,9).getValues().forEach(r => { em[r[0]] = {sub:r[4]||"",amt:r[5]||""}; });
    const pc = col_(hm,PAYMENT_CONFIG.REPORT_COLUMNS.PR_ID); let added=0, nf=[];
    for (const sid of prIds) {
      let found = false;
      for (let r = 2; r <= src.getLastRow(); r++) {
        if (src.getRange(r,pc).getValue() === sid) {
          found = true;
          if (rs.getLastRow()>=2 && rs.getRange(2,2,rs.getLastRow()-1,1).getValues().flat().includes(sid)) break;
          const ed = em[sid]||{sub:"",amt:""};
          rs.appendRow([false, sid, src.getRange(r,col_(hm,PAYMENT_CONFIG.REPORT_COLUMNS.ITEM)).getValue()||"", src.getRange(r,col_(hm,PAYMENT_CONFIG.REPORT_COLUMNS.QUANTITY)).getValue()||"", src.getRange(r,col_(hm,PAYMENT_CONFIG.REPORT_COLUMNS.VENDOR)).getValue()||"", "", src.getRange(r,col_(hm,PAYMENT_CONFIG.REPORT_COLUMNS.FINAL_APPROVAL)).getValue()||"", src.getRange(r,col_(hm,PAYMENT_CONFIG.REPORT_COLUMNS.PRODUCT_CATEGORY)).getValue()||"", ed.sub, ed.amt]);
          rs.getRange(rs.getLastRow(),1).insertCheckboxes(); added++; break;
        }
      }
      if (!found) nf.push(sid);
    }
    SpreadsheetApp.flush();
    let msg = `Added ${added} item(s)`; if (nf.length) msg += `\nNot found: ${nf.join(', ')}`;
    ui.alert(msg); ss.setActiveSheet(rs);
  } catch (e) { SpreadsheetApp.getUi().alert(`Error: ${e.message}`); }
}

function removeCheckedItems() {
  try {
    const rs = getOrCreatePaymentReportSheet_(); const lr = rs.getLastRow();
    if (lr < 2) { SpreadsheetApp.getUi().alert('No items'); return; }
    const cb = rs.getRange(2,1,lr-1,1).getValues(); let c = 0;
    for (let i = cb.length-1; i >= 0; i--) { if (cb[i][0]===true) { rs.deleteRow(i+2); c++; } }
    SpreadsheetApp.flush(); SpreadsheetApp.getUi().alert(c > 0 ? `Removed ${c}` : 'None checked');
  } catch (e) { SpreadsheetApp.getUi().alert(`Error: ${e.message}`); }
}

function clearFounderReport() {
  try {
    const ui = SpreadsheetApp.getUi();
    if (ui.alert('Clear?','Delete ALL items?',ui.ButtonSet.YES_NO)!==ui.Button.YES) return;
    const rs = getOrCreatePaymentReportSheet_(); if (rs.getLastRow()>1) rs.deleteRows(2,rs.getLastRow()-1);
    ui.alert('Cleared');
  } catch (e) { SpreadsheetApp.getUi().alert(`Error: ${e.message}`); }
}

function addCurrentRowToReport() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet(); const as = ss.getActiveSheet(); const ar = as.getActiveRange();
    if (!ar || as.getName()!==CONFIG.SHEET_NAME || ar.getRow()===1) { SpreadsheetApp.getUi().alert('Select a data row in Form responses 1'); return; }
    const hm = getHeaderMap_(as); const prId = as.getRange(ar.getRow(), col_(hm, PAYMENT_CONFIG.REPORT_COLUMNS.PR_ID)).getValue();
    if (!prId) { SpreadsheetApp.getUi().alert('No PR_ID'); return; }
    const rs = getOrCreatePaymentReportSheet_();
    if (rs.getLastRow()>=2 && rs.getRange(2,2,rs.getLastRow()-1,1).getValues().flat().includes(prId)) { SpreadsheetApp.getUi().alert(`${prId} already in report`); return; }
    const es = ss.getSheetByName(EXPORT_CONFIG.EXPORT_SHEET); let sub="",amt="";
    if (es && es.getLastRow()>=2) { for (const r of es.getRange(2,1,es.getLastRow()-1,9).getValues()) { if (r[0]===prId) { sub=r[4]||""; amt=r[5]||""; break; } } }
    const row = ar.getRow();
    rs.appendRow([false, prId, as.getRange(row,col_(hm,PAYMENT_CONFIG.REPORT_COLUMNS.ITEM)).getValue()||"", as.getRange(row,col_(hm,PAYMENT_CONFIG.REPORT_COLUMNS.QUANTITY)).getValue()||"", as.getRange(row,col_(hm,PAYMENT_CONFIG.REPORT_COLUMNS.VENDOR)).getValue()||"", "", as.getRange(row,col_(hm,PAYMENT_CONFIG.REPORT_COLUMNS.FINAL_APPROVAL)).getValue()||"", as.getRange(row,col_(hm,PAYMENT_CONFIG.REPORT_COLUMNS.PRODUCT_CATEGORY)).getValue()||"", sub, amt]);
    rs.getRange(rs.getLastRow(),1).insertCheckboxes(); SpreadsheetApp.flush();
    SpreadsheetApp.getUi().alert(`Added ${prId}`); ss.setActiveSheet(rs);
  } catch (e) { SpreadsheetApp.getUi().alert(`Error: ${e.message}`); }
}

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('💰 Founder Payment').addItem('➕ Add Items by PR_ID','addItemsToFounderReport').addItem('➕ Add Current Row','addCurrentRowToReport').addSeparator().addItem('✅ Remove Checked','removeCheckedItems').addItem('🗑️ Clear Report','clearFounderReport').addToUi();
  ui.createMenu('📊 Dashboard').addItem('Open Procurement Dashboard','openDashboard_').addToUi();
}

/**************** BACKFILL DATES ****************/

function backfillApprovalDates() {
  try {
    const sh = getSheet_(); const hm = getHeaderMap_(sh); const lr = sh.getLastRow();
    const ac = col_(hm, CONFIG.HEADERS.FINAL_APPROVAL); const adc = col_(hm, CONFIG.HEADERS.APPROVAL_DATE); const tc = col_(hm, CONFIG.HEADERS.TIMESTAMP);
    let c = 0;
    for (let r = 2; r <= lr; r++) {
      if (String(sh.getRange(r,ac).getValue()||'').trim().toLowerCase()==='approved' && !sh.getRange(r,adc).getValue()) {
        sh.getRange(r,adc).setValue(sh.getRange(r,tc).getValue() || new Date()); c++;
      }
      if (r%50===0) SpreadsheetApp.flush();
    }
    SpreadsheetApp.flush(); Browser.msgBox(`Backfilled ${c} rows`);
  } catch (e) { Browser.msgBox(`Error: ${e.message}`); }
}

function backfillOrderedDates() {
  try {
    const sh = getSheet_(); const hm = getHeaderMap_(sh); const lr = sh.getLastRow();
    const sc = col_(hm, CONFIG.HEADERS.ORDER_STATUS); const odc = col_(hm, CONFIG.HEADERS.ORDERED_DATE); const tc = col_(hm, CONFIG.HEADERS.TIMESTAMP);
    let c = 0;
    for (let r = 2; r <= lr; r++) {
      const cls = classifyOrderStatus_(sh.getRange(r,sc).getValue());
      if ((cls==='ordered'||cls==='paid'||cls==='in_transit'||cls==='delivered'||cls==='handed_over') && !sh.getRange(r,odc).getValue()) {
        sh.getRange(r,odc).setValue(sh.getRange(r,tc).getValue() || new Date()); c++;
      }
      if (r%50===0) SpreadsheetApp.flush();
    }
    SpreadsheetApp.flush(); Browser.msgBox(`Backfilled ${c} rows`);
  } catch (e) { Browser.msgBox(`Error: ${e.message}`); }
}

/**************** PROCUREMENT DASHBOARD ****************/

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Dashboard')
    .setTitle('Artila Procurement Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Returns comprehensive procurement data for the dashboard.
 * Covers all approval states (pending, approved, rejected, reverify)
 * and all 10 pipeline stages.
 */
function getDashboardData() {
  const sh = getSheet_();
  const headerMap = getHeaderMap_(sh);
  const H = CONFIG.HEADERS;
  const lastRow = sh.getLastRow();

  const emptyResult = {
    totalRequests: 0,
    approvalBreakdown: {
      total: 0,
      deptApproved: 0, deptRejected: 0, deptPending: 0,
      founderApproved: 0, founderRejected: 0, founderPending: 0, founderReverify: 0
    },
    stageCounts: {
      pending_requester: 0, pending_sourcing: 0, sourcing: 0, quotation: 0,
      ordered: 0, paid: 0, in_transit: 0, delivered: 0, handed_over: 0, cancelled: 0
    },
    activeItems: [], pendingItems: [], rejectedItems: [], completedItems: [],
    vendorFlags: [], timestamp: new Date().toISOString()
  };

  if (lastRow < 2) return emptyResult;

  const allData = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
  const colIdx = {};
  Object.entries(H).forEach(([key, headerName]) => {
    try { colIdx[key] = col_(headerMap, headerName) - 1; }
    catch (e) { colIdx[key] = -1; }
  });

  const tz = Session.getScriptTimeZone();
  const now = new Date();

  const approvalBreakdown = {
    total: 0,
    deptApproved: 0, deptRejected: 0, deptPending: 0,
    founderApproved: 0, founderRejected: 0, founderPending: 0, founderReverify: 0
  };

  const stageCounts = {
    pending_requester: 0, pending_sourcing: 0, sourcing: 0, quotation: 0,
    ordered: 0, paid: 0, in_transit: 0, delivered: 0, handed_over: 0, cancelled: 0
  };

  const activeItems = [];
  const pendingItems = [];
  const rejectedItems = [];
  const completedItems = [];
  const vendorFlagsRaw = [];

  for (let i = 0; i < allData.length; i++) {
    const row = allData[i];

    // Skip G&A rows
    const category = colIdx.PRODUCT_CATEGORY >= 0 ? String(row[colIdx.PRODUCT_CATEGORY] || '').trim() : '';
    if (category === 'General & Administrative') continue;

    approvalBreakdown.total++;

    const finalApprovalRaw = colIdx.FINAL_APPROVAL >= 0 ? String(row[colIdx.FINAL_APPROVAL] || '').trim() : '';
    const managerApprovalRaw = colIdx.MANAGER_APPROVAL >= 0 ? String(row[colIdx.MANAGER_APPROVAL] || '').trim() : '';
    const orderStatusRaw = colIdx.ORDER_STATUS >= 0 ? String(row[colIdx.ORDER_STATUS] || '').trim() : '';

    const deptStatus = normaliseApproval_(managerApprovalRaw);
    const founderStatus = normaliseApproval_(finalApprovalRaw);

    // Tally approval breakdown
    if (deptStatus === 'approved') approvalBreakdown.deptApproved++;
    else if (deptStatus === 'rejected') approvalBreakdown.deptRejected++;
    else approvalBreakdown.deptPending++;

    if (founderStatus === 'approved') approvalBreakdown.founderApproved++;
    else if (founderStatus === 'rejected') approvalBreakdown.founderRejected++;
    else if (founderStatus === 'reverify') approvalBreakdown.founderReverify++;
    else approvalBreakdown.founderPending++;

    // Date helpers
    let ts = colIdx.TIMESTAMP >= 0 ? row[colIdx.TIMESTAMP] : '';
    const tsStr = ts instanceof Date ? Utilities.formatDate(ts, tz, 'dd/MM/yyyy HH:mm:ss') : String(ts || '');

    let approvalDate = colIdx.APPROVAL_DATE >= 0 ? row[colIdx.APPROVAL_DATE] : '';
    let approvalDateStr = '', daysSinceApproval = -1;
    if (approvalDate instanceof Date && !isNaN(approvalDate.getTime())) {
      daysSinceApproval = Math.floor((now - approvalDate) / 86400000);
      approvalDateStr = Utilities.formatDate(approvalDate, tz, 'dd/MM/yyyy');
    }

    let orderedDate = colIdx.ORDERED_DATE >= 0 ? row[colIdx.ORDERED_DATE] : '';
    let orderedDateStr = '', daysApprovalToOrdered = -1;
    if (orderedDate instanceof Date && !isNaN(orderedDate.getTime())) {
      orderedDateStr = Utilities.formatDate(orderedDate, tz, 'dd/MM/yyyy');
      if (approvalDate instanceof Date && !isNaN(approvalDate.getTime())) {
        daysApprovalToOrdered = Math.floor((orderedDate - approvalDate) / 86400000);
      }
    }

    let eta = colIdx.ETA >= 0 ? row[colIdx.ETA] : '';
    let leadTime = colIdx.LEAD_TIME >= 0 ? row[colIdx.LEAD_TIME] : '';
    const etaStr = eta instanceof Date && !isNaN(eta.getTime()) ? Utilities.formatDate(eta, tz, 'dd/MM/yyyy') : String(eta || '');
    const leadTimeStr = leadTime instanceof Date && !isNaN(leadTime.getTime()) ? Utilities.formatDate(leadTime, tz, 'dd/MM/yyyy') : String(leadTime || '');

    const vendor = colIdx.PREFERRED_VENDOR >= 0 ? String(row[colIdx.PREFERRED_VENDOR] || '') : '';
    const prId = colIdx.PR_ID >= 0 ? String(row[colIdx.PR_ID] || '') : '';
    const itemName = colIdx.ITEM >= 0 ? String(row[colIdx.ITEM] || '') : '';

    const baseItem = {
      timestamp: tsStr,
      email: colIdx.EMAIL >= 0 ? String(row[colIdx.EMAIL] || '') : '',
      item: itemName,
      quantity: colIdx.QTY >= 0 ? String(row[colIdx.QTY] || '') : '',
      estimate: colIdx.ESTIMATE >= 0 ? String(row[colIdx.ESTIMATE] || '') : '',
      partNumber: colIdx.PART_NUMBER >= 0 ? String(row[colIdx.PART_NUMBER] || '') : '',
      justification: colIdx.JUSTIFICATION >= 0 ? String(row[colIdx.JUSTIFICATION] || '') : '',
      urgency: colIdx.URGENCY_LEVEL >= 0 ? String(row[colIdx.URGENCY_LEVEL] || '') : '',
      team: colIdx.TEAM >= 0 ? String(row[colIdx.TEAM] || '') : '',
      vendor, prId,
      orderStatus: orderStatusRaw,
      category,
      eta: etaStr, leadTime: leadTimeStr,
      approvalDate: approvalDateStr, orderedDate: orderedDateStr,
      daysSinceApproval, daysApprovalToOrdered,
      managerApproval: managerApprovalRaw,
      finalApproval: finalApprovalRaw,
      rowNum: i + 2
    };

    // Route item to the correct bucket
    if (founderStatus === 'rejected') {
      rejectedItems.push(Object.assign({}, baseItem, { statusClass: 'rejected', approvalState: 'rejected' }));

    } else if (founderStatus === 'reverify') {
      rejectedItems.push(Object.assign({}, baseItem, { statusClass: 'reverify', approvalState: 'reverify' }));

    } else if (founderStatus !== 'approved') {
      // Pending some level of approval
      let approvalState = 'pending_founder';
      if (deptStatus === 'rejected') approvalState = 'dept_rejected';
      else if (deptStatus !== 'approved') approvalState = 'pending_dept';
      pendingItems.push(Object.assign({}, baseItem, { statusClass: approvalState, approvalState }));

    } else {
      // Founder approved → classify by order status stage
      const stageCls = classifyOrderStatus_(orderStatusRaw);

      // Increment stage count
      if (stageCounts.hasOwnProperty(stageCls)) stageCounts[stageCls]++;
      else stageCounts.sourcing++;

      // SLA logic
      let slaFlag = '', slaFlagType = '', slaDaysOver = 0;
      if (stageCls === 'pending_requester' || stageCls === 'pending_sourcing' || stageCls === 'sourcing') {
        if (daysSinceApproval > 2) {
          slaFlag = 'Sourcing overdue — ' + daysSinceApproval + 'd since approval (SLA: 2d)';
          slaFlagType = 'sourcing'; slaDaysOver = daysSinceApproval - 2;
        }
      } else if (stageCls === 'quotation') {
        if (daysSinceApproval > 5) {
          slaFlag = 'Payment overdue — ' + daysSinceApproval + 'd since approval (SLA: 5d)';
          slaFlagType = 'payment'; slaDaysOver = daysSinceApproval - 5;
        } else if (daysSinceApproval > 2) {
          slaFlag = 'Negotiation slow — ' + daysSinceApproval + 'd since approval (SLA: 2d)';
          slaFlagType = 'sourcing'; slaDaysOver = daysSinceApproval - 2;
        }
      } else if (stageCls === 'ordered' || stageCls === 'paid') {
        if (daysApprovalToOrdered > 5) {
          slaFlag = 'Pre-order took ' + daysApprovalToOrdered + 'd (SLA: 5d)';
          slaFlagType = 'payment_slow'; slaDaysOver = daysApprovalToOrdered - 5;
        }
      } else if (stageCls === 'in_transit') {
        if (eta instanceof Date && !isNaN(eta.getTime()) && now > eta) {
          const d = Math.floor((now - eta) / 86400000);
          slaFlag = 'Past ETA by ' + d + ' days'; slaFlagType = 'transit'; slaDaysOver = d;
        }
      }

      // Vendor late flag
      if (eta instanceof Date && leadTime instanceof Date && !isNaN(eta.getTime()) && !isNaN(leadTime.getTime())) {
        const daysLate = Math.floor((leadTime - eta) / 86400000);
        if (daysLate > 0) vendorFlagsRaw.push({ vendor, prId, item: itemName, eta: etaStr, actualArrival: leadTimeStr, daysLate });
      }

      const enriched = Object.assign({}, baseItem, { statusClass: stageCls, slaFlag, slaFlagType, slaDaysOver });

      if (stageCls === 'handed_over' || stageCls === 'delivered') {
        completedItems.push(enriched);
      } else if (stageCls === 'cancelled') {
        completedItems.push(enriched);
      } else {
        activeItems.push(enriched);
      }
    }
  }

  // Aggregate vendor flags
  const vs = {};
  vendorFlagsRaw.forEach(vf => {
    const n = vf.vendor || 'Unknown';
    if (!vs[n]) vs[n] = { vendor: n, lateCount: 0, totalDaysLate: 0, items: [] };
    vs[n].lateCount++; vs[n].totalDaysLate += vf.daysLate; vs[n].items.push(vf);
  });

  return {
    totalRequests: approvalBreakdown.total,
    approvalBreakdown,
    stageCounts,
    activeItems,
    pendingItems,
    rejectedItems,
    completedItems,
    vendorFlags: Object.values(vs).sort((a, b) => b.lateCount - a.lateCount),
    timestamp: new Date().toISOString()
  };
}

function openDashboard_() {
  const url = 'https://script.google.com/a/macros/origin.tech/s/AKfycbzss7TaBO7y__Zvt683JM_clFF_4KSpo0jOb6w6te4YQFJyFE4b8-rFyhTWwyoySpjb/exec';
  const html = HtmlService.createHtmlOutput(
    '<script>window.open("' + url + '","_blank");google.script.host.close();</script>'
  ).setWidth(100).setHeight(50);
  SpreadsheetApp.getUi().showModalDialog(html, 'Opening Dashboard...');
}
