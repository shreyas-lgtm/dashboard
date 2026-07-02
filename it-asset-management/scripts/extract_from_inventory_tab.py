#!/usr/bin/env python3
"""
Extract ALL IT assets from the 'Inventory' tab of the source
'Procurement & Inventory' spreadsheet (downloaded as .xlsx) and normalize them
into the clean 16-column IT Asset Register schema.

Supersedes the hardcoded migrate.py: reads the live tab directly, so it captures
every IT-tagged row (the earlier read_file_content view truncated at IT-0096).

Run:  python3 extract_from_inventory_tab.py <src.xlsx>
Writes ../clean-register-full.csv and prints a summary.
"""
import sys, re, csv, os, collections
import openpyxl

SRC = sys.argv[1] if len(sys.argv) > 1 else "/tmp/claude-0/-home-user-dashboard/aada5366-1a40-5ba8-a74f-231a48afea26/scratchpad/src.xlsx"
GST = 0.18

# Column indexes in the Inventory tab (0-based)
C_ITEM, C_ID, C_ASSIGN, C_SERIAL, C_CAT, C_LOC, C_COND, C_UNIT, C_TAX, C_TOTAL, C_MODEL = 1, 2, 3, 7, 8, 9, 10, 11, 12, 13, 14

# An item is an IT asset if its ID is IT/ITO-prefixed, or a bare number with an IT category.
IT_CATS_NUMERIC = {"personal computer", "monitor", "computer accessories", "laptop",
                   "pc", "cpu", "keyboard", "key board", "mouse", "gpu", "ssd", "computer"}

# Canonical category normalization (case/plurals/typos -> clean label).
def norm_cat(raw):
    c = (raw or "").strip()
    k = c.lower()
    m = {
        "personal computer": "Personal Computer", "pc": "Personal Computer",
        "cpu": "Personal Computer", "laptop": "Personal Computer", "computer": "Personal Computer",
        "monitor": "Monitor",
        "computer accessories": "Computer Accessories", "key board": "Computer Accessories",
        "keyboard": "Computer Accessories", "mouse": "Computer Accessories",
        "wired gamepad": "Computer Accessories",
        "ssd": "Storage", "nas": "Storage", "nas hard ware": "Storage", "hard drive": "Storage",
        "gpu": "GPU",
        "ups": "UPS", "power bank": "UPS", "battery": "UPS",
        "network switch": "Networking", "router": "Networking", "hub": "Networking",
        "orin": "Compute", "ai": "Compute", "developer kit": "Compute", "dev board": "Compute",
        "charger": "Accessory - Charger", "charger adapter": "Accessory - Charger",
        "adapter": "Accessory - Charger", "convertor": "Accessory - Charger",
        "tab": "Tablet",
    }
    return m.get(k, c if c else "(uncategorized)")

# End-user computing categories the owner originally scoped to.
CORE_IT = {"Personal Computer", "Monitor", "Computer Accessories", "GPU"}

STORAGE_TOK = {"storage", "store"}
SPARE_TOK = {"spare"}
SYSTEM_TOK = {"robot", "simulation", "navigation", "embedded"}


def is_it_asset(idv, cat):
    if re.match(r"^ITO?\d", idv, re.I):
        return True
    if re.fullmatch(r"\d+(\.0)?", idv) and cat.lower() in IT_CATS_NUMERIC:
        return True
    return False


def norm_id(raw):
    raw = raw.strip()
    m = re.match(r"^([A-Za-z]*)0*?(\d+)(?:\.0)?$", raw)
    if not m:
        return raw
    prefix = (m.group(1) or "IT").upper()
    if prefix == "ITO":
        prefix = "IT"  # fold ITO -> IT
    return f"{prefix}-{int(m.group(2)):04d}"


def to_num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "")
    if s == "" or s.upper().startswith("#") or "VALUE" in s.upper():
        return None
    # long pasted text in a value cell -> treat as lost
    if len(s) > 15 and not re.fullmatch(r"[\d.]+", s):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def classify(assignee):
    r = (assignee or "").strip()
    low = r.lower()
    if low == "":
        return ("Unassigned", "", "")
    if low in STORAGE_TOK:
        return ("In Storage", "", "")
    if low in SPARE_TOK:
        return ("Available", "", "")
    if low in SYSTEM_TOK:
        return ("Deployed", r.title(), "Allocated to a system/setup, not a person")
    return ("In Use", r, "")


HEADER = ["Asset Tag", "Item", "Category", "Serial No.", "Model No.", "Status",
          "Assigned To (Holder)", "Team / Location", "Date Received", "Date Assigned",
          "Date Returned", "Condition", "Unit Value (INR)", "Tax (INR)", "Total (INR)", "Notes"]


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    ws = wb["Inventory"]
    rows = list(ws.iter_rows(values_only=True))

    out, total_val, flags = [], 0.0, []
    seen_ids = collections.Counter()

    for r in rows:
        item = str(r[C_ITEM]).strip() if r[C_ITEM] not in (None, "") else ""
        if item == "" or item == "Item Description":
            continue
        idv = str(r[C_ID]).strip() if r[C_ID] not in (None, "") else ""
        cat_raw = str(r[C_CAT]).strip() if r[C_CAT] not in (None, "") else ""
        if not is_it_asset(idv, cat_raw):
            continue

        tag = norm_id(idv) if idv else "(no-id)"
        seen_ids[tag] += 1
        cat = norm_cat(cat_raw)
        status, holder, note = classify(r[C_ASSIGN])
        notes = [note] if note else []

        # condition + dongle/damage notes
        cond = ""
        craw = str(r[C_COND]).strip() if r[C_COND] not in (None, "") else ""
        if craw:
            if "dongle" in craw.lower():
                cond = "Good"; notes.append("No USB dongle")
            elif craw.lower().startswith("damaged"):
                cond = "Damaged"; notes.append(craw)
                if status == "In Use":
                    status = "Damaged"
            else:
                cond = craw

        u, t, tot = to_num(r[C_UNIT]), to_num(r[C_TAX]), to_num(r[C_TOTAL])
        # recover corrupted cost cells
        if u is not None and (t is None or tot is None):
            t = round(u * GST, 2) if t is None else t
            tot = round(u + t, 2) if tot is None else tot
            notes.append("Tax/Total recomputed at 18% GST")
        if u is None and t is None and tot is None:
            notes.append("No cost recorded - backfill from invoice")

        if cat not in CORE_IT:
            notes.append(f"Non-core IT category ({cat}) - verify scope")

        if tot is not None:
            total_val += tot

        # Emit 0.00 (never blank) for cost cells: blank numeric cells caused
        # Google Sheets CSV import to collapse the Unit Value/Tax columns.
        # The "No cost recorded" note above preserves which are truly unknown.
        fmt = lambda x: "0.00" if x is None else f"{x:.2f}"
        out.append([
            tag, item, cat,
            str(r[C_SERIAL]).strip() if r[C_SERIAL] not in (None, "") else "",
            str(r[C_MODEL]).strip() if r[C_MODEL] not in (None, "") else "",
            status, holder,
            str(r[C_LOC]).strip() if r[C_LOC] not in (None, "") else "",
            "", "", "", cond, fmt(u), fmt(t), fmt(tot), "; ".join(notes),
        ])

    outp = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "clean-register-full.csv"))
    with open(outp, "w", newline="") as f:
        w = csv.writer(f); w.writerow(HEADER); w.writerows(out)

    dups = {k: v for k, v in seen_ids.items() if v > 1}
    core = sum(1 for r in out if r[2] in CORE_IT)
    print(f"Wrote {len(out)} IT assets -> {outp}")
    print(f"  core end-user devices (PC/Monitor/Accessories/GPU): {core}")
    print(f"  other IT-tagged (UPS/networking/storage/etc.): {len(out)-core}")
    print(f"Total inventory value (recorded): INR {total_val:,.2f}")
    print("Status:", dict(collections.Counter(r[5] for r in out)))
    print("Categories:", dict(collections.Counter(r[2] for r in out).most_common()))
    print(f"Duplicate Asset Tags ({len(dups)}):", dict(dups))
    novalue = sum(1 for r in out if r[14] in ("", "0.00"))
    print(f"Assets with blank/zero value: {novalue}")


if __name__ == "__main__":
    main()
