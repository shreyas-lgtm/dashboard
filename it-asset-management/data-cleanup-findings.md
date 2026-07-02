# Data Cleanup Findings — legacy sheet → clean register

What was wrong in the old *"Procurement …& Inventory"* sheet, and how the migration ([`scripts/migrate.py`](./scripts/migrate.py)) resolved each item.

## Scope: IT assets only

The IT register tracks **end-user computing equipment only** — laptops/CPUs, monitors, keyboards, mice, GPUs. The old sheet had mixed in gear owned by other inventories; those **35 rows** were moved out to [`non-it-assets.csv`](./non-it-assets.csv) (kept, not deleted, so they can be handed to their owners):

| Moved out | Count | Belongs to |
|---|---|---|
| Development / R&D (Teensy, Waveshare, Robosense LiDAR, Festo pneumatics) | 21 | R&D inventory |
| Tools (tapes, wire strippers, vacuum, caliper, compressor) | 10 | Tools inventory |
| Cameras (Insta360, RealSense) | 2 | Vision Systems |
| Compute (Jetson AGX Orin) | 1 | Compute & Controllers |
| Adapter / loose cable (DisplayPort→HDMI) | 1 | Signal & Interface Cables |

**Result: 90 IT assets, total value ₹19,37,308.07.** (Want the DP→HDMI adapter kept in the IT register? Add `"Adapter"` to `IT_CATEGORIES` in `migrate.py` and re-run.)

## Structural problems (fixed by the new schema)

| # | Problem | Fix |
|---|---------|-----|
| 1 | **"Assigned To" overloaded** — held people *and* states (`Storage`, `Spare`, `Robot`, `Simulation`, `Navigation`, `Embedded`, `store`/`Store`). Impossible to tell who actually holds what. | Split into two columns: **Status** (state) + **Assigned To (Holder)** (person only). Across the 90 IT assets: 70 In Use, 8 In Storage, 8 Deployed-to-system, 3 Available, 1 Damaged. |
| 2 | **No dates** — no way to know when something was assigned or returned, so offboarding collection was untrackable. | Added **Date Received / Date Assigned / Date Returned** (blank in migration — backfill going forward). |
| 3 | **No status field** — "in use vs spare vs retired" was guesswork. | Added **Status** dropdown with 8 defined states. |
| 4 | **Phantom columns** — several empty trailing columns (`FHY`, blanks) and unused `Laptop ID / Charger ID / Device ID` (filled on exactly one row). | Dropped. Schema is now 16 meaningful columns. |
| 5 | **Header clutter** — merged title rows, "Assigned To Cleanup", "Item Location Cleanup", stray count numbers in column A. | Removed. One clean header row. |

## Corrupted / erroneous cells (fixed)

| Asset (new tag) | Problem | Fix |
|---|---|---|
| **IT-0044** (Lenovo LOQ, Rajtilak Pal) | Unit Value cell contained a pasted Slack message ("Requesting servicing for two pumps…") → `#VALUE!` in Tax & Total. Original cost **lost**. | Blanked the cost cells; flagged **"backfill from invoice"** in Notes. |
| **IT-0050** (MSI Vector, Nilesh) | Unit Value `2,20,330.50` (Indian digit grouping) broke the formula → `#VALUE!`. | Parsed to `220330.50`, recomputed Tax `39,659.49` and Total `2,59,989.99` at 18% GST. |

## Normalizations (applied automatically)

| Type | Before → After |
|---|---|
| **Asset tags** | Mixed `0003`, `IT0029`, `TL0001`, `DV0011` → unified `IT-0003`, `IT-0029`, `TL-0001`, `DV-0011`. |
| **Categories** | `Tools`→`Tool`; `Development `(trailing space)→`Development`; `Orin`→`Compute`. |
| **Locations** | `A I Table`→`AI Table`; trailing spaces trimmed. |
| **Condition notes** | `(No Dongle)` moved from Condition to Notes; `Damaged by employee` → Condition `Damaged` + Status `Damaged`. |
| **Item names** | Minor typo cleanup: `Meauring`→`Measuring`, `Cyclinder`→`Cylinder`. |

## Flagged for human verification (not auto-changed)

| Asset | Flag |
|---|---|
| **IT-0012** | Named "Dell Monitor" but Category is `Computer Accessories`. Verify the real category. |
| **~40 rows** | **Unit Value blank or 0** on real hardware (monitors, mice, some laptops). Backfill from invoices during the first monthly audit — these drag the total value down artificially. |
| **~30 rows** | **Serial No. blank** on laptops/monitors. Fill in during audit; the conditional-formatting rule (yellow) will keep surfacing them. |
| **`Aanad` / `Anand`** | Assignee spelled two ways across rows — confirm it's one person and standardize. |

## How to re-run

If the source sheet changes and you want to re-migrate, edit the `RAW` block in `scripts/migrate.py` and run `python3 scripts/migrate.py`. It regenerates `clean-register.csv` and reprints this summary.
