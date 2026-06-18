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
// For multi-tab workbooks (e.g. the full tracker): which tab + which 0-based
// row holds the column headers (Design Tracker has a band row above headers).
const SHEET = process.env.SHEET_PARTS_TAB || undefined;
const HEADER_ROW = Number(process.env.SHEET_HEADER_ROW || 0);

// Part Category → ERPNext Item Group, and whether it's made (has a BOM) or bought.
const CATEGORY = {
  'TOP LEVEL ASSY': { group: 'Finished Goods', make: true },
  'SUB ASSY': { group: 'Sub-Assemblies', make: true },
  Custom: { group: 'Fabricated Parts', make: true },
  OTS: { group: 'Purchased Parts', make: false },
  Fasteners: { group: 'Fasteners', make: false },
  Consumables: { group: 'Consumables', make: false },
  'OPS - Consumables': { group: 'Consumables', make: false },
  'Packing material': { group: 'Packing Material', make: false },
};
const DEFAULT_CATEGORY = { group: 'Raw Materials', make: false };

export const sources = [
  {
    name: 'Items (parts)',
    source: SOURCE,
    sheet: SHEET,
    headerRow: HEADER_ROW,
    doctype: 'Item',
    match: (doc) => [['item_code', '=', doc.item_code]],
    update: true, // re-sync enriched fields (group, make/buy, lead time) on re-run
    mapRow: (row) => {
      // Item code = your internal UID (P0473…); fall back to Part Number if missing.
      const uid = clean(row['UID']);
      const partNo = clean(row['Part Number']);
      const code = uid || partNo;
      if (!code) return null; // skip rows with neither UID nor Part Number

      const desc = clean(row['Component Description']);
      const cat = CATEGORY[clean(row['Part Category'])] || DEFAULT_CATEGORY;
      const partType = clean(row['Part type']);
      const subassembly = clean(row['Subassembly']);
      const lead = num(row['Lead Time (days)']);
      const name = [partNo, desc].filter(Boolean).join(' — ') || subassembly || code;

      return {
        item_code: code,
        item_name: cap(name),
        item_group: cat.group,
        stock_uom: 'Nos',
        gst_hsn_code: DEFAULT_HSN,
        is_stock_item: 1,
        // Make vs Buy: Custom/assemblies are manufactured; the rest are purchased.
        default_material_request_type: cat.make ? 'Manufacture' : 'Purchase',
        include_item_in_manufacturing: cat.make ? 1 : 0,
        is_purchase_item: 1,
        ...(lead !== undefined ? { lead_time_days: lead } : {}),
        // Manufacturer part no / type / subassembly kept searchable until the
        // custom-app phase adds dedicated fields.
        description: [
          partNo && `Part No: ${partNo}`,
          partType && partType !== 'Not Applicable' && `Type: ${partType}`,
          subassembly && `Subassembly: ${subassembly}`,
          desc,
        ].filter(Boolean).join(' — ') || code,
      };
    },
  },
  {
    name: 'Suppliers (vendors)',
    source: SOURCE,
    sheet: SHEET,
    headerRow: HEADER_ROW,
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
