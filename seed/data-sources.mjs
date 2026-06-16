/**
 * Maps your "MOMA EBOM / procurement tracker" sheet → ERPNext fields.
 *
 * Both Items and Suppliers are pulled from the SAME sheet (one wide table where
 * each row is a part with its vendor). Duplicates (same Part Number, or a vendor
 * appearing on many rows) are handled automatically by the idempotent upsert.
 *
 * Source file/URL comes from .env:
 *   SHEET_PARTS_FILE   path to your local Excel/CSV   (e.g. seed/data/parts.xlsx)
 *   SHEET_PARTS_URL    OR a published-as-CSV link     (fallback if no file)
 * Default placeholder HSN (overridable):
 *   DEFAULT_HSN_CODE  (default 84799090 — "other machines & mechanical appliances")
 */

const clean = (v) => String(v ?? '').trim();
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};
const cap = (s, n = 140) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

const SOURCE = process.env.SHEET_PARTS_FILE || process.env.SHEET_PARTS_URL;
const DEFAULT_HSN = process.env.DEFAULT_HSN_CODE || '84799090';

export const sources = [
  {
    name: 'Items (parts)',
    source: SOURCE,
    doctype: 'Item',
    match: (doc) => [['item_code', '=', doc.item_code]],
    update: false, // set true to overwrite existing items from the sheet
    mapRow: (row) => {
      const code = clean(row['Part Number']);
      if (!code) return null; // skip rows without a part number

      const desc = clean(row['Component Description']);
      const name = desc ? `${code} — ${desc}` : code;

      return {
        item_code: code,
        item_name: cap(name),
        item_group: 'Raw Materials',
        stock_uom: 'Nos',
        gst_hsn_code: DEFAULT_HSN,
        is_stock_item: 1,
        description: desc || code,
      };
    },
  },
  {
    name: 'Suppliers (vendors)',
    source: SOURCE,
    doctype: 'Supplier',
    match: (doc) => [['supplier_name', '=', doc.supplier_name]],
    update: false,
    mapRow: (row) => {
      const vendor = clean(row['Vendor']);
      if (!vendor) return null; // many rows have no vendor — skip them
      return {
        supplier_name: vendor,
        supplier_group: 'Local',
        supplier_type: 'Company',
        country: 'India',
      };
    },
  },
];
