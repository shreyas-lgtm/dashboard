# IT Asset Register — Setup Guide

This is how to build the register as a Google Sheet so it stays **simple, self-checking, and handover-proof**. The data is already prepared in [`clean-register.csv`](./clean-register.csv) — you just import it and apply the settings below.

## 1. Create the sheet

1. New Google Sheet → **File ▸ Import ▸ Upload** `clean-register.csv` → *Replace current sheet*.
2. Rename the tab **`Register`**.
3. Select row 1 → **View ▸ Freeze ▸ 1 row**. Bold it.

## 2. Columns — essential vs optional

16 columns total, but only **9 are essential** — those are the minimum to hand over the job *and* track offboarding. The other 7 are "proper data" extras (value, model, location): cheap to keep, safe to drop if you want maximum simplicity.

| # | Column | Type | Essential? | Notes |
|---|--------|------|:---:|-------|
| A | **Asset Tag** | text | ✅ | Unique `IT-####`. Never reused. Identifies the item. |
| B | **Item** | text | ✅ | e.g. "Lenovo LOQ". |
| C | **Category** | dropdown | ✅ | Keeps scope clean + lets you filter. See list below. |
| D | **Serial No.** | text | ✅ | Manufacturer serial — the real-world identity. |
| E | **Model No.** | text | ⬜ optional | Handy for reordering/warranty; not needed for lifecycle. |
| F | **Status** | dropdown | ✅ | The lifecycle state. **Core.** |
| G | **Assigned To (Holder)** | text | ✅ | Person's full name. Blank unless Status = In Use. **Core.** |
| H | **Team / Location** | dropdown | ⬜ optional | Nice for finding a device; lifecycle works without it. |
| I | **Date Received** | date | ⬜ optional | Intake date. Useful for age/audit, not for offboarding. |
| J | **Date Assigned** | date | ✅ | When given to current holder. Needed for the lifecycle. |
| K | **Date Returned** | date | ✅ | When returned. **Without this you can't track collection on exit.** |
| L | **Condition** | dropdown | ⬜ optional | New/Good/Fair/Damaged. Damage can also just go in Notes. |
| M | **Unit Value (INR)** | number | ⬜ optional | From invoice. For financial reporting only. |
| N | **Tax (INR)** | number | ⬜ optional | GST. Financial only. |
| O | **Total (INR)** | number | ⬜ optional | Auto = M + N (see §4). Financial only. |
| P | **Notes** | text | ✅ | Repairs, damage, flags. |

**The 9 essential columns** (A, B, C, D, F, G, J, K, P) are all you need for a working handover-ready lifecycle: *what it is, who has it, what state it's in, when it was assigned/returned.*
**The 7 optional columns** (E, H, I, L, M, N, O) add financial + logistics detail. Keep them if you want "proper data" in one place; delete the columns if you want the leanest possible sheet — nothing in the process breaks.

> **Why this beats the old sheet:** it separates **who holds it** (G) from **what state it's in** (F) — the old sheet crammed both into one column — and adds the **dates** (J/K) that make offboarding auditable.

## 3. Dropdowns (Data ▸ Data validation)

Apply each to its whole column (row 2 down). Use "Reject input" so typos can't creep back in.

- **Category (C):** `Personal Computer`, `Monitor`, `Computer Accessories`, `GPU` — IT assets only. (Cameras, compute modules, R&D dev hardware, tools and loose cables are tracked in other inventories, not here.)
- **Status (F):** `In Use`, `Available`, `In Storage`, `Deployed`, `In Repair`, `Damaged`, `Retired`, `Lost`
- **Condition (L):** `New`, `Good`, `Fair`, `Damaged`
- **Team / Location (H):** seed from existing values — `Perception Table`, `AI Table`, `Embedded Table`, `Full Stack Table`, `Robotics Table`, `Mechanical Table`, `Operations Table`, `HR Table`, `Procurement Table`, `Deployment Table`, `CVAT Table`, `Mechanical Lab`, `US Box`, `Teensy Board Compartment`, `Tool System V2`, `V2`, `V2.1` (add as needed).

## 4. Formulas

- **Total (O2, fill down):** `=IF(M2="","",M2+N2)` — total is always unit + tax, never hand-typed.
- Optional **Tax auto-fill (N2)** if you want GST computed: `=IF(M2="","",ROUND(M2*0.18,2))`. (Leave as-is if tax varies by item.)

## 5. Conditional formatting (makes problems jump out)

Format ▸ Conditional formatting on the `Register` range:

| Rule (custom formula) | Colour | Catches |
|---|---|---|
| `=AND($F2="In Use",$G2="")` | red | In Use but nobody named |
| `=AND($F2<>"In Use",$G2<>"")` | orange | Holder set but not In Use (stale) |
| `=AND(OR($C2="Personal Computer",$C2="Monitor"),$D2="")` | yellow | Laptop/monitor with no serial |
| `=$M2=""` | grey | Missing cost |

## 6. Dashboard tab (auto-summary, zero maintenance)

Add a second tab **`Dashboard`**:

```
Total assets            =COUNTA(Register!A2:A)
Total value (INR)       =SUM(Register!O2:O)
In Use                  =COUNTIF(Register!F2:F,"In Use")
Available (spare)       =COUNTIF(Register!F2:F,"Available")
In Storage              =COUNTIF(Register!F2:F,"In Storage")
In Repair               =COUNTIF(Register!F2:F,"In Repair")
Damaged                 =COUNTIF(Register!F2:F,"Damaged")
Missing serial          =COUNTIFS(Register!C2:C,"Personal Computer",Register!D2:D,"")+COUNTIFS(Register!C2:C,"Monitor",Register!D2:D,"")
```

**Per-person holdings** (the offboarding view): `=QUERY(Register!A2:P, "select G, count(A) where F='In Use' group by G order by count(A) desc label count(A) 'Items Held'")`

## 7. Access & handover

- Share the sheet with the IT team as **Editor**; everyone else **Viewer**.
- Put this file, the SOP, and the sheet in one Drive folder named **"IT Asset Management"**.
- Protect the header row (Data ▸ Protect sheet ▸ row 1) so it can't be edited accidentally.

That's the entire system: one tab of data, one dashboard tab, dropdowns to stop typos, formulas to catch gaps. Anyone handed this can run it from the SOP.
