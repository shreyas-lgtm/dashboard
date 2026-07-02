# IT Asset Management

A simple, handover-ready system for tracking IT assets end to end — from the moment a device arrives, through who it's assigned to, to collecting it back when someone leaves. **Scope: end-user computing equipment only — laptops/CPUs, monitors, keyboards, mice, GPUs.**

Built to replace the old *"Procurement …& Inventory"* sheet, which had grown hard to maintain (people and states mixed in one column, no dates, corrupted cells, phantom columns).

## What's here

| File | What it is | For whom |
|------|-----------|----------|
| **[QUICK-START.md](./QUICK-START.md)** | One page: the 3 daily moves + offboarding checklist. All you need day to day. | **Read this first.** Whoever runs IT assets. |
| **[IT-Asset-Management-SOP.md](./IT-Asset-Management-SOP.md)** | The full end-to-end process: intake → assignment → return/offboarding → retire. Roles, steps, forms. | Reference when the cheat sheet isn't enough. |
| **[register-template.md](./register-template.md)** | How to build the register as a Google Sheet: columns, dropdowns, formulas, dashboard, conditional formatting. | Whoever sets up the sheet. |
| **[clean-register.csv](./clean-register.csv)** | The migrated data — 90 IT assets in the new 16-column schema. Import this into Sheets. | Import once. |
| **[non-it-assets.csv](./non-it-assets.csv)** | 35 non-IT items (cameras, R&D dev hardware, tools, cables) moved out of the IT register — kept so they can be handed to their owners. | Reference. |
| **[data-cleanup-findings.md](./data-cleanup-findings.md)** | Exactly what was wrong in the old sheet and how it was fixed/flagged. | Reference / audit trail. |
| **[scripts/migrate.py](./scripts/migrate.py)** | Reproducible migration script (source data + transform rules). | If the source ever changes. |

## Get started in 3 steps

1. **Set up the sheet** — follow [register-template.md](./register-template.md): import `clean-register.csv`, add the dropdowns and dashboard. (~15 min, once.) It marks which 13 columns are essential (incl. cost + team) vs the 3 minor optional ones.
2. **Learn the flow** — read [QUICK-START.md](./QUICK-START.md) (one page). The whole thing rests on one habit: *update the sheet the moment an asset changes hands.*
3. **Backfill the gaps** — during the first monthly audit, fill blank serial numbers and unit values flagged in [data-cleanup-findings.md](./data-cleanup-findings.md).

## The idea in one line

> One sheet is the single source of truth. Every asset always has a **Status**; if it's **In Use** it has exactly one named **Holder**. Assignment sets the holder + date; offboarding clears the holder + records the return — and HR won't close out an exit until the person's asset list is empty.

That's what makes it simple, efficient, and safe to hand to anyone.
