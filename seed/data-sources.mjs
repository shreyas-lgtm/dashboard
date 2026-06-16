/**
 * Maps your Google Sheet columns → ERPNext fields, for the data loader.
 *
 * ⚠️ The mapping below is a PLACEHOLDER. Once you share your sheet's real
 * column names (run `node seed/inspect-sheet.mjs <url>`), we fill in the
 * `mapRow` functions so they read YOUR columns.
 *
 * Sheet URLs come from .env so your specific sheets aren't committed:
 *   SHEET_ITEMS_URL, SHEET_SUPPLIERS_URL  (published-as-CSV links)
 */

// --- small helpers for cleaning sheet values ---
const bool = (v) => (/^(1|y|yes|true|x)$/i.test(String(v).trim()) ? 1 : 0);
const num = (v) => {
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};
const clean = (v) => String(v ?? '').trim();

export const sources = [
  {
    name: 'Items',
    csvUrl: process.env.SHEET_ITEMS_URL,
    doctype: 'Item',
    // Identify an existing record so re-runs update instead of duplicate.
    match: (doc) => [['item_code', '=', doc.item_code]],
    update: false, // set true to overwrite existing items from the sheet
    // TODO: rewrite using YOUR real column names (left side = your headers).
    mapRow: (row) => {
      const code = clean(row['Item Code'] || row['SKU'] || row['Code']);
      if (!code) return null; // skip rows with no code
      return {
        item_code: code,
        item_name: clean(row['Item Name'] || row['Name'] || code),
        item_group: clean(row['Item Group'] || row['Category'] || 'Raw Materials'),
        stock_uom: clean(row['UOM'] || row['Unit'] || 'Nos'),
        gst_hsn_code: clean(row['HSN'] || row['HSN/SAC Code']),
        is_stock_item: 1,
        has_batch_no: bool(row['Has Batch No']),
        create_new_batch: bool(row['Has Batch No']),
        has_expiry_date: bool(row['Has Expiry Date']),
        shelf_life_in_days: num(row['Shelf Life In Days']),
        has_serial_no: bool(row['Has Serial No']),
        valuation_rate: num(row['Rate'] || row['Valuation Rate']),
        description: clean(row['Description']),
      };
    },
  },
  {
    name: 'Suppliers',
    csvUrl: process.env.SHEET_SUPPLIERS_URL,
    doctype: 'Supplier',
    match: (doc) => [['supplier_name', '=', doc.supplier_name]],
    update: false,
    // TODO: rewrite using YOUR real column names.
    mapRow: (row) => {
      const name = clean(row['Supplier Name'] || row['Vendor'] || row['Name']);
      if (!name) return null;
      return {
        supplier_name: name,
        supplier_group: clean(row['Supplier Group'] || row['Type'] || 'Local'),
        supplier_type: clean(row['Supplier Type'] || 'Company'),
        country: clean(row['Country'] || 'India'),
      };
    },
  },
];
