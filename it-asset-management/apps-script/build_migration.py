#!/usr/bin/env python3
"""
Convert clean-register-full.csv (our 16-col schema) into the column order the
IT Asset Tracker Apps Script expects on its 'Hardware' tab, ready to paste.

Hardware tab column order (A..N):
  A Timestamp | B Category | C Name / Description | D Manufacturer | E Model |
  F Serial Number | G Assigned To | H Status | I Location | J Purchase Date |
  K Cost | L Warranty Expiry | M Notes | N Asset Tag
(O Days, P Alert, Q Age are formulas already in the sheet — leave them out.)

Also prints the distinct Employees / Categories / Statuses to paste into CONFIG.
"""
import csv, os, re, collections

SRC = os.path.join(os.path.dirname(__file__), "..", "clean-register-full.csv")
OUT = os.path.join(os.path.dirname(__file__), "hardware-import.csv")

BRANDS = ["Lenovo", "Dell", "LG", "Benq", "HP", "Samsung", "Acer", "MSI", "ASUS",
          "Logitech", "Zebronics", "Ant", "Rapoo", "Portronics", "Apple", "Nvidia",
          "Mivii", "Teltonika", "TP-Link", "APC", "Ambrane", "Insta", "Intel",
          "Robosense", "Freemans", "Stanley", "Insize", "Waveshare", "Seagate", "QNAP"]

def manufacturer(item):
    low = item.lower()
    for b in BRANDS:
        if low.startswith(b.lower()):
            return b
    return ""

HW_HEADER = ["Timestamp", "Category", "Name / Description", "Manufacturer", "Model",
             "Serial Number", "Assigned To", "Status", "Location", "Purchase Date",
             "Cost", "Warranty Expiry", "Notes", "Asset Tag"]

def main():
    rows_out = []
    employees, categories, statuses = set(), set(), set()
    with open(os.path.abspath(SRC)) as f:
        for r in csv.DictReader(f):
            item = r["Item"].strip()
            cat = r["Category"].strip()
            status = r["Status"].strip()
            holder = r["Assigned To (Holder)"].strip()
            # Cost = all-in Total (incl. GST) so the dashboard total matches prior figure.
            total = r["Total (INR)"].strip()
            cost = "" if total in ("", "0.00", "0") else total
            rows_out.append([
                "",                       # A Timestamp (blank for migrated rows)
                cat,                      # B Category
                item,                     # C Name / Description
                manufacturer(item),       # D Manufacturer
                r["Model No."].strip(),   # E Model
                r["Serial No."].strip(),  # F Serial Number
                holder,                   # G Assigned To
                status,                   # H Status
                r["Team / Location"].strip(),  # I Location
                "",                       # J Purchase Date (unknown)
                cost,                     # K Cost
                "",                       # L Warranty Expiry (unknown)
                r["Notes"].strip(),       # M Notes
                r["Asset Tag"].strip(),   # N Asset Tag (keep existing physical tag)
            ])
            if holder:
                employees.add(holder)
            categories.add(cat)
            statuses.add(status)

    with open(os.path.abspath(OUT), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(HW_HEADER)
        w.writerows(rows_out)

    print(f"Wrote {len(rows_out)} rows -> {os.path.abspath(OUT)}")
    print(f"\n--- CONFIG.CATEGORIES ({len(categories)}) ---")
    print(sorted(categories))
    print(f"\n--- STATUS_OPTIONS ({len(statuses)}) ---")
    print(sorted(statuses))
    print(f"\n--- EMPLOYEES ({len(employees)}) ---")
    print(sorted(employees, key=str.lower))

if __name__ == "__main__":
    main()
