# Bulk import: Items & Suppliers

Use these after the structure seeder has run (so Item Groups, UOMs and Supplier
Groups already exist). These are the *data* that fills the structure — load them
with ERPNext's built-in **Data Import** tool, not the seeder.

## Files

- `items_template.csv` — your products/materials, with batch / serial / expiry columns
- `suppliers_template.csv` — your vendors

Open them in Excel or Google Sheets, **replace the sample rows with your own**,
keep the header row exactly as-is, and save as CSV.

## How to import into ERPNext

1. In ERPNext, search the top bar for **Data Import** and open it.
2. Click **New**.
3. **Document Type** → choose **Item** (or **Supplier**).
4. **Import Type** → **Insert New Records**.
5. Upload your filled-in CSV.
6. Click **Map Columns** — ERPNext auto-matches the headers; confirm they're right.
7. Click **Start Import**. Errors (if any) are listed per-row so you can fix and re-upload.

> Tip: ERPNext's Data Import can also **Download Template** for any doctype with the
> exact column names for *your* site (including any custom fields). If a column here
> doesn't map, grab that template and copy your data into it.

## Item columns explained

| Column | Meaning |
|--------|---------|
| Item Code | Unique ID/SKU (e.g. RM-0001). Required. |
| Item Name | Human-readable name. |
| Item Group | Must be one of: Raw Materials, Spares & Maintenance, Finished Goods. |
| Default Unit of Measure | e.g. Nos, Kg, Litre (must already exist). |
| HSN/SAC Code | Required (GST/India). Goods use an HSN code, services a SAC code. Must be a valid code that exists in ERPNext's GST HSN Code list. Put each product's real code here. |
| Maintain Stock | 1 = stock item (tracked in inventory), 0 = non-stock/service. |
| Has Batch No | 1 = track by batch/lot. |
| Create New Batches Automatically | 1 = ERPNext makes a batch on receipt (use with Has Batch No). |
| Has Expiry Date | 1 = batch carries an expiry. Needs Has Batch No = 1. |
| Shelf Life In Days | Days until expiry from manufacture (e.g. 365). Blank if no expiry. |
| Has Serial No | 1 = track each unit by a unique serial number. |
| Valuation Rate | Default cost per unit (optional, helps stock valuation). |
| Description | Optional notes. |

**Rules of thumb**
- Batch *and* serial on the same item is uncommon — pick one per item.
- Expiry requires batches (`Has Batch No = 1` and `Has Expiry Date = 1`).
- Service/non-inventory items: set `Maintain Stock = 0` and leave tracking flags 0.

## Supplier columns

| Column | Meaning |
|--------|---------|
| Supplier Name | Vendor name. Required. |
| Supplier Group | Local / Import / Services / Subcontractor (must already exist). |
| Supplier Type | Company or Individual. |
| Country | Vendor's country. |

> Contacts, addresses, bank details and tax IDs are separate records in ERPNext.
> Add them on each Supplier afterward, or import them via their own Data Imports
> (Contact, Address) once the suppliers exist.
