# ERPNext Structure Seeder

Builds the **procurement & inventory structure** on a Frappe Cloud / ERPNext
site — warehouses, item groups, supplier groups, units, the contract-manufacturer
supplier, and the Material Request + Purchase Order approval workflows.

It is **idempotent**: it creates only what's missing, so you can re-run it safely
and point it at a fresh site to replicate the same structure (this is the
"reproducible" part — the structure is captured here as code).

## What it creates

| Thing | Details |
|-------|---------|
| Units of Measure | Nos, Kg, Litre, Box, … (skips any ERPNext already ships) |
| Item Groups | Raw Materials, Spares & Maintenance, Finished Goods |
| Supplier Groups | Local, Import, Services, Subcontractor |
| Warehouses | `Main Office` + `Contract Manufacturer`, each with Stores / In-Process / Rejected |
| Supplier | Contract Manufacturer (group: Subcontractor) for the subcontracting flow |
| Workflows | Material Request approval; Purchase Order approval (auto-flow ≤ ₹25,000) |

Edit [`structure.mjs`](./structure.mjs) to change any of the above — it's plain data.

## Setup

1. In ERPNext: **My Settings → API Access → Generate Keys** to get an API
   key + secret.
2. Copy `.env.example` to `.env` and fill in:
   ```
   FRAPPE_URL=https://yoursite.frappe.cloud
   FRAPPE_API_KEY=...
   FRAPPE_API_SECRET=...
   FRAPPE_COMPANY=My Company        # exact company name in ERPNext
   PO_APPROVAL_THRESHOLD=25000
   ```

## Run

```bash
npm run seed:dry     # preview — makes no changes
npm run seed         # apply
```

Requires Node 18+ (for built-in `fetch` and `--env-file`).

## What this does NOT do (by design)

Bulk **Items** and **Suppliers** are *data*, not structure — load those via
ERPNext's **Data Import** (CSV/Excel) tool, which is far faster than scripting
hundreds of rows. Set each item's batch / serial / expiry tracking flags there.

Order: run the seeder first (so item groups, warehouses and UOMs exist), then
import items and suppliers.
