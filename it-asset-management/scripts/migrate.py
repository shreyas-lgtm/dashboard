#!/usr/bin/env python3
"""
Migrate the legacy "Procurement ...& Inventory" sheet into a clean IT asset register.

Why this exists (handover note):
  The old sheet overloaded one "Assigned To" column with people AND states
  ("Storage", "Spare", "Robot", "Simulation", ...), had no status/date fields,
  inconsistent categories/locations, and two cells corrupted into #VALUE! errors.

  This script encodes every transformation as a rule so the migration is
  reproducible and auditable. Edit RAW below if the source changes, then run:
      python3 migrate.py
  It writes ../clean-register.csv and prints a summary of what it changed.

All monetary values are INR. GST is 18% where recomputation was needed.
"""
import csv
import os
import re

# --- Source rows copied from the legacy sheet -------------------------------
# Pipe-delimited: id|item|assignee|serial|category|location|condition|unit|tax|total|model
# Empty field = blank in source. "VALUE" sentinel = a #VALUE! error cell.
RAW = """
0003|Lenovo LOQ|Sandeep||Personal Computer|Deployment Table||163979.00|29516.22|193495.22|15ARP9
0004|Dell Mouse|Prateek||Computer Accessories|Deployment Table|||0.00|309.00|MS116P
0005|Lenovo LOQ|Dhruv|MP2Q30JS|Personal Computer|Perception Table||138965.00|25013.70|163978.70|15ARP9
0006|Lenovo LOQ|Akhil|MP2HM3TV|Personal Computer|Perception Table||82189.00|14794.02|96983.02|15ARP10
0007|Insta 360 ONE X2|||Camera|Perception Table||25415.00|4574.70|29989.70|
0008|Intel RealSense Depth Camera D435i||243222072442|Camera|Perception Table||33500.00|6030.00|39530.00|D435i
0009|Nvidia Jetson Agx Orin|Raj||Orin|Perception Table||173600.00|31248.00|204848.00|
0010|Dell Monitor|Rishi Agarwal|CN-01X0R7-TV20-49E-0D5T-A00|Monitor|AI Table|||0.00|13999.00|
0011|LG Monitor|Ravikiran|409TFYA1P634|Monitor|Perception Table||13499.00|2429.82|15928.82|32MR50C
0012|Dell Monitor|Naveen|CN-05NT8R-PRC00-4CN-0728|Computer Accessories|Perception Table|||0.00|0.00|MS116P
0013|Lenovo LOQ|Rishi Agarwal|MP2RT6MA|Personal Computer|Embedded Table||82189.00|14794.02|96983.02|15ARP9
0014|Benq Monitor|Anant|ET8BR02065SL0|Monitor|AI Table||10998.00|1979.64|12977.64|GW2790-B
0015|LG Monitor|Aniket|411NTVS8J295|Monitor|AI Table||8859.32|1594.68|10454.00|27MS550
0016|Dell Keyboard|Ravikiran|CN-04WJ8P-LO300-4AH-K013-A07|Computer Accessories|AI Table|||0.00|1349.00|KM3322W
0017|ASUS|Storage|M8NRKD03399031A|Personal Computer|Deployment Table||65000.00|11700.00|76700.00|FX516PM
0018|Dell Mouse|Storage|CN-05NT8R-PRC00-53K-030H|Computer Accessories|Deployment Table|||0.00|279.00|MS116P
0019|Lenovo Thinkpad|Shreyas|PF0T116Q|Personal Computer|Procurement Table|||0.00|0.00|20HES1LR00
0020|LG Monitor|Shreyas|411NTXR3S050|Monitor|Procurement Table||8859.32|1594.68|10454.00|27MS550
0021|Lenovo LOQ|Mithul|MP2RTXLT|Personal Computer|HR Table||81490.00|14668.20|96158.20|15ARP9D2
0022|Dell Monitor|Arfath|CN-09T9CX-WSL00-48A-ES1L-A02|Monitor|Full Stack Table||9299.00|1673.82|10972.82|S2725H
0023|ASUS Mouse|Arfath|S3BMLA100038DPZ|Computer Accessories|Full Stack Table|||0.00|0.00|MW203
0024|Lenovo LOQ|Devansh|MP2QMPR7|Personal Computer|Full Stack Table||80189.89|14434.18|94624.07|15ARP9
0025|Dell Monitor|Devansh|CN-09T9CX-WSL00-48A-DUNL-A02|Monitor|Full Stack Table||9299.00|1673.82|10972.82|S2725H
0026|Logitech Mouse|Devansh||Computer Accessories|Full Stack Table|||0.00|0.00|M331
0027|LG Monitor|Tanay|406NTUWBK510|Monitor|Full Stack Table||11987.29|2157.71|14145.00|24GN65R
0028|Lenovo LOQ|Tanay|MP2Q2NLV|Personal Computer|Full Stack Table||69262.71|12467.29|81730.00|15ARP9
IT0029|Dell Mouse|Viral|CN-05NT8R-PRC00-53H-0199|Computer Accessories|Deployment Table|||0.00|0.00|MS116P
TL0001|Stanley 5m Measuring Tape|Anand||Tools|Mechanical Table|||0.00|0.00|
TL0002|Stanley 5m Measuring Tape|Anand||Tools|Mechanical Table|||0.00|0.00|
TL0003|Stanley 5m Measuring Tape|Anand||Tools|Deployment Table|||0.00|0.00|
TL0004|Stanley 5m Measuring Tape|Anand||Tools|Deployment Table|||0.00|0.00|
IT0030|Lenovo LOQ|Arfath|MP2RTF7K|Personal Computer|Full Stack Table||69262.71|12467.29|81730.00|15ARP9D2
IT0031|Dell Monitor|Harsh Kothari|CN-01X0R7-TV200-4BQ-0KBT-A00|Monitor|Full Stack Table||9099.00|1637.82|10736.82|SE2725H
IT0032|Logitech Mouse|Tirth Vyas||Computer Accessories|Robotics Table|||0.00|0.00|M331
IT0033|Samsung Monitor|Lakshya|4J6NH4CR200958L|Monitor|Robotics Table|||0.00|0.00|LS24A310NHWXXL
IT0034|Lenovo LOQ|Ujjwal|MP2RT5FA|Personal Computer|Robotics Table||69059.32|12430.68|81490.00|15ARP9D2
IT0035|Lenovo Mouse|Ujjwal|Z13PJ9QC|Computer Accessories|Robotics Table|||0.00|0.00|SM-8823
IT0036|Lenovo Monitor|Mohit Patil|UP1032H9|Monitor|Robotics Table|||0.00|0.00|A24270FL0
IT0037|Lenovo LOQ|Akshaya Katiganere Anandappa|MP2RT6NN|Personal Computer|Robotics Table||70076.27|12613.73|82690.00|15ARP9D2
IT0038|Logitech Mouse|Akshaya Katiganere Anandappa||Computer Accessories|Robotics Table|||0.00|0.00|M331
IT0039|Acer Monitor|Spare|MMTJDSI0014510E1F83W01|Monitor|HR Table|||0.00|0.00|EK220Q
IT0040|Zebronics Monitor|Vehan|ZBW11UV01357|Monitor|Robotics Table||6136.45|1104.56|7241.01|EA124
IT0041|Lenovo LOQ|Storage|MP2YYHXQ|Personal Computer|Robotics Table||70330.50|12659.49|82989.99|15ARP9D3
IT0042|Logitech Mouse|Storage||Computer Accessories|Robotics Table|||0.00|0.00|M331
IT0043|Dell Monitor|Abhishek|CN-01X0R7-TV200-512-0ZQT-A00|Monitor|Robotics Table||7626.28|1372.73|8999.01|SE2725H
IT0044|Lenovo LOQ|Rajtilak Pal|MP2HM2CV|Personal Computer|Robotics Table||VALUE|VALUE|VALUE|15ARP9D2
IT0045|Benq Monitor|Sankalp|ETH4S0571101Q|Monitor|Robotics Table||10998.00|1979.64|12977.64|GW2790-L
IT0046|Benq Monitor|Robot|ETGAR039865L0|Monitor|V2.1||8812.72|1586.29|10399.01|GW2790-L
IT0047|Dell Mouse|Raj Mohammed|CN-0GXCWV-LO300-47U-01E6|Computer Accessories|Robotics Table|||0.00|0.00|MS116
IT0048|Ant Esports Keyboard|Simulation|AEMK1450PBGKK0125|Computer Accessories|Robotics Table|||0.00|0.00|MK1450
IT0049|Dell Monitor|Rakshit|CN-01X0R7-TV200-4AG-04GT-A00|Monitor|Robotics Table||7626.28|1372.73|8999.01|SE2725H
IT0050|MSI Vector|Nilesh|K2407N0118075|Personal Computer|Robotics Table||220330.50|VALUE|VALUE|17HXA14VHG
IT0051|LG Monitor|Simulation|504NTFAC6467|Monitor|Robotics Table||11987.29|2157.71|14145.00|27GS65F
IT0052|Benq Monitor|Navigation|ETH4S0129001Q|Monitor|Robotics Table||8058.94|1450.61|9509.55|GW2790-L
IT0053|Dell Keyboard|Simulation|CN-0W41TY-M6D00-477-08K3-A04|Computer Accessories|Robotics Table|||0.00|0.00|
IT0054|Dell Mouse|Simulation|CN-05NT8R-PRC00-4A7-0A15|Computer Accessories|Robotics Table|||0.00|0.00|MS116
IT0055|Ant Keyboard|Lakshya|AVFKBRI02WDCK0125|Computer Accessories|Robotics Table|||0.00|0.00|FKBRI02
IT0056|Dell Monitor|Tushar|CN0TW1TJWSL00492ADSLA05|Monitor|Mechanical Table||7626.28|1372.73|8999.01|S2721HN
IT0057|Logitech Mouse|Sankalp|2452ZEW3WK78|Computer Accessories|Mechanical Table|||0.00|0.00|M331
IT0058|Dell Monitor|Rajtilak Pal|CN-01X0R7-TV200-49E-1DWT-A00|Monitor|Mechanical Table||7626.28|1372.73|8999.01|SE2725H
IT0059|Dell Monitor|Ashish|CN-0TW1TJ-WSL00-492-AUDL-A05|Monitor|Mechanical Table||7626.28|1372.73|8999.01|S2721HN
IT0060|Logitech Mouse|Spare|2423LZXNV858|Computer Accessories|Mechanical Table|No Dongle||0.00|0.00|M170
IT0061|Logitech Mouse|Spare|2515LV24NP88|Computer Accessories|Mechanical Table|No Dongle||0.00|0.00|M331
IT0062|Lenovo LOQ|Nisarg Mahale|MP2QS7C0|Personal Computer|Mechanical Table||70330.00|12659.40|82989.40|15ARP9D2
IT0063|Dell Mouse|Prathisha||Computer Accessories|CVAT|||0.00|0.00|S2725H
IT0064|Dell Monitor|Nisarg Mahale|CN-09T0CX-WSL00-47Q-EMXL-A02|Monitor|Mechanical Table||7626.27|1372.73|8999.00|S2721HN
IT0065|Lenovo LOQ|Rakshith N|MP2QMSS7|Personal Computer|Mechanical Table||70330.00|12659.40|82989.40|ARP9D2
IT0066|Dell Monitor|Simulation|CN-01X0R7-TV200-4CG-0C7T-A00|Monitor|Mechanical Table||9023.18|1624.17|10647.35|SE2725H
IT0067|Lenovo LOQ|store|MP2HL85L|Personal Computer|Mechanical Table|||0.00|0.00|15ARP9D2
IT0068|Logitech Mouse|store||Computer Accessories|Mechanical Table|||0.00|0.00|M331
IT0069|Dell Monitor|Sujay|CN-01X0R7-TV200-4CG-0MET-A00|Monitor|Mechanical Table|||0.00|0.00|SE2715H
IT0070|Dell Monitor|Vishal|CN-01X0R7-TV200-48C-0BET-A00|Monitor|Mechanical Table|||0.00|0.00|SE2715H
IT0071|Dell Monitor|Rohith|CN-0TW1TJ-WSL00-492-ATZL-A05|Monitor|Mechanical Table|||0.00|0.00|S2721HN
IT0072|Lenovo LOQ|Rohith|MP2RHA2G|Personal Computer|Mechanical Table|||0.00|0.00|15ARP9D2
IT0073|Dell Monitor|Badri|CN-0TW1TJ-WSL00-486-FPXL-A05|Monitor|Embedded Table|||0.00|0.00|S2721HN
IT0074|Logitech Mouse|Adnan|2437ZEZBXM78|Computer Accessories|Embedded Table|||0.00|0.00|M220
IT0075|MSI Monitor|Deptha|BC0M264700837|Monitor|Embedded Table|||0.00|0.00|3BC0
IT0076|LG Monitor|Anand|504NTXRC6466|Monitor|Mechanical Table||8473.72|1525.27|9998.99|LG27GS65F
IT0077|Lenovo LOQ|Anand|MP2RJ54Y|Personal Computer|Mechanical Table|||0.00|0.00|15ARP9D2
IT0078|Logitech Mouse|Anand|2515LV34NNW8|Computer Accessories|Mechanical Table|||0.00|1295.00|M331
IT0079|LG Monitor|Kathan|409TFDZ1Q130|Monitor|Embedded Table||11355.08|2043.91|13398.99|32MR50C
IT0080|Dell Monitor|Arun|CN-01XR7-RV200-49E-1DTT-A00|Monitor|Embedded Table|||0.00|8999.00|SE2725H
IT0081|HP Mouse|Rohith|7CH1529XJ3|Computer Accessories|Mechanical Table|||0.00|0.00|STA-AM02
IT0082|LG Monitor|Lubna|503TOJK2R220|Monitor|HR Table|||0.00|5799.00|22MR410
IT0083|Logitech Mouse|Lubna|2516LV02WBU8|Computer Accessories|HR Table|||0.00|1295.00|M331
IT0084|Dell Laptop|Lubna||Personal Computer|HR Table|||0.00|0.00|
IT0085|Lenovo LOQ|Shyamala|PF53X8VL|Personal Computer|CVAT Table|||0.00|0.00|V15G4AMN1
IT0086|Dell Mouse|Dhruv|CN-05NT8R-PRC00-53H-01HN|Computer Accessories|HR Table|||0.00|0.00|MS116P
IT0087|Benq Monitor|Yogesh|ETH4S0481601Q|Monitor|Operations Table||8058.94|1450.61|9509.55|GW2790-L
IT0088|Benq Monitor|Simulation|ETGAR03971SL0|Monitor|Operations Table|||0.00|0.00|GW2790-B
IT0089|Benq Monitor|Bhuvnesh|ETP8P05546021Q|Monitor|Operations Table|||0.00|0.00|GW2790-L
IT0090|Lenovo LOQ|Storage|MP2RHCB4|Personal Computer|Operations Table|||0.00|0.00|15ARP9D2
DV0001|Teensy Board 4.1|Storage||Development|Teensy Board Compartment||2281.00|410.58|2691.58|
DV0002|Teensy Board 4.1|Storage||Development|Teensy Board Compartment||2281.00|410.58|2691.58|
DV0003|Teensy Board 4.1|Storage||Development|Teensy Board Compartment||2281.00|410.58|2691.58|
DV0004|Teensy Board 4.1|Storage||Development|Teensy Board Compartment||2281.00|410.58|2691.58|
DV0005|Teensy Board 4.1|Storage||Development|Teensy Board Compartment||2281.00|410.58|2691.58|
DV0006|Teensy Board 4.1|Storage||Development|Teensy Board Compartment||2281.00|410.58|2691.58|
DV0007|Teensy Board 4.1|Storage||Development|Teensy Board Compartment||2281.00|410.58|2691.58|
DV0008|Teensy Board 4.1|Storage||Development|Teensy Board Compartment||2281.00|410.58|2691.58|
DV0009|Teensy Board 4.1|Storage||Development|Teensy Board Compartment||2281.00|410.58|2691.58|
DV0010|Teensy Board 4.1|Storage||Development|Teensy Board Compartment||2281.00|410.58|2691.58|
DV0011|Waveshare USB to CAN Adapter Dual-Channel CAN Analyzer||22773|Development|US Box|||0.00|0.00|
DV0012|Waveshare Isolated USB To 4-Ch RS232 Converter||27022|Development|US Box||2939.00|529.02|3468.02|
DV0013|Waveshare Isolated USB To 4-Ch RS232 Converter||27022|Development|US Box||2939.00|529.02|3468.02|
TL0006|Freemans WS05 Wire Stripper and Cutter|Spare||Tool|Embedded Table|||0.00|0.00|
TL0007|Freemans WS05 Wire Stripper and Cutter|Spare||Tool|Embedded Table|||0.00|0.00|
TL0008|Freemans WS05 Wire Stripper and Cutter|Spare||Tool|Embedded Table|||0.00|0.00|
IT0091|Mini DisplayPort to UHD HDMI Active Cable Adapter||CP879A|Adapter||||0.00|0.00|P137-06N-HDMI
TL0009|AGARO Regal 800W Handheld Vacuum Cleaner|Embedded|RE250626719|Tool|Mechanical||1699.00|305.82|2004.82|Regal
DV0014|Robosense Airy 96 beam|Kathan|3009BEA00221|Development|Embedded||110000.00|19800.00|129800.00|Airy
DV0015|Robosense Airy 96 beam|Kathan|3009BEAE1413|Development|Embedded||110000.00|19800.00|129800.00|Airy
IT0092|Lenovo Thinkpad|Store|PW0AK9E1|Personal Computer|Operations|||0.00|0.00|IdeaPad Flex 5 14ALC7
DV0016|Mounting Bracket|Robot|526064|Development|Tool System V2||135.00|24.30|159.30|MS4-WR
DV0017|Pressure Regulator|Robot|529419|Development|Tool System V2||1713.00|308.34|2021.34|MS4-LR-1/4-D7-AS
DV0018|Standard Based Cylinder|Robot|35193|Development|Tool System V2||2600.00|468.00|3068.00|DSNU-25-400-PPV-A
DV0019|Standard Based Cylinder|Robot||Development|Tool System V2||2600.00|468.00|3068.00|
DV0020|Standard Based Cylinder|Robot||Development|Tool System V2||2600.00|468.00|3068.00|
DV0021|Standard Based Cylinder|Robot||Development|Tool System V2||2600.00|468.00|3068.00|
TL0010|Insize Digital Vernier Caliper|Anand|1401255976|Tool|Mechanical Lab||2195.00|395.10|2590.10|1112-150
TL0011|BTALI Air Compressor BT 9 OFAC|Sankalp|BT0010122024|Tool|V2||6650.00|1197.00|7847.00|
IT0093|Logitech Mouse|Tanay|2516LVQ2XGS8|Computer Accessories|Full Stack Table|||0.00|0.00|M331
IT0094|Lenovo LOQ|Prabhav|MP2RHA2S|Personal Computer|A I Table|||0.00|0.00|15ARP8D2
IT0095|Lenovo LOQ|Harini|MP2NRLH7|Personal Computer|Mechanical Table|Damaged by employee||0.00|0.00|15ARP9D2
IT0096|Logitech Mouse|Harini|2516LV52XEJ8|Computer Accessories|Mechanical Table|||0.00|0.00|M331
""".strip()

GST_RATE = 0.18

# Assignee tokens that are really a STATE, not a person.
STORAGE_TOKENS = {"storage", "store"}
SPARE_TOKENS = {"spare"}
# Assignee tokens that mean "deployed onto a system / owned by a team".
SYSTEM_TOKENS = {"robot", "simulation", "navigation", "embedded"}

# Canonical category map (fixes trailing spaces, plurals, odd labels).
CATEGORY_MAP = {
    "tools": "Tool",
    "tool": "Tool",
    "development": "Development",
    "orin": "Compute",
    "personal computer": "Personal Computer",
    "computer accessories": "Computer Accessories",
    "monitor": "Monitor",
    "camera": "Camera",
    "adapter": "Adapter",
}

# Canonical location map (fixes spacing typos only; unknowns pass through title-cased).
LOCATION_MAP = {
    "a i table": "AI Table",
}

# Item/category mismatches worth flagging (item clearly not its recorded category).
def category_mismatch(item, category):
    it = item.lower()
    if "monitor" in it and category == "Computer Accessories":
        return "Item looks like a Monitor but category is Computer Accessories - verify"
    if "mouse" in it and category == "Personal Computer":
        return "Item looks like a Mouse but category is Personal Computer - verify"
    return None


def norm_id(raw):
    """0003 -> IT-0003, IT0029 -> IT-0029, TL0001 -> TL-0001, DV0011 -> DV-0011."""
    m = re.match(r"^([A-Za-z]*)0*?(\d+)$", raw)
    if not m:
        return raw
    prefix, num = m.group(1).upper(), int(m.group(2))
    if prefix == "":
        prefix = "IT"
    return f"{prefix}-{num:04d}"


def to_float(s):
    s = s.strip().replace(",", "")
    if s == "" or s.upper() == "VALUE":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def classify(assignee):
    """Return (status, holder, note) from the overloaded 'Assigned To' value."""
    r = assignee.strip().lower()
    if r == "":
        return ("Unassigned", "", "")
    if r in STORAGE_TOKENS:
        return ("In Storage", "", "")
    if r in SPARE_TOKENS:
        return ("Available", "", "")
    if r in SYSTEM_TOKENS:
        return ("Deployed", assignee.strip().title(), "Allocated to a system/setup, not a person")
    return ("In Use", assignee.strip(), "")


HEADER = [
    "Asset Tag", "Item", "Category", "Serial No.", "Model No.",
    "Status", "Assigned To (Holder)", "Team / Location",
    "Date Received", "Date Assigned", "Date Returned",
    "Condition", "Unit Value (INR)", "Tax (INR)", "Total (INR)", "Notes",
]


def main():
    out_rows = []
    findings = []
    total_value = 0.0

    for line in RAW.splitlines():
        raw_id, item, assignee, serial, category, location, condition, unit, tax, total, model = line.split("|")

        asset_tag = norm_id(raw_id)
        notes = []

        # --- category
        cat_clean = CATEGORY_MAP.get(category.strip().lower(), category.strip())
        mism = category_mismatch(item, cat_clean)
        if mism:
            notes.append(mism)
            findings.append(f"{asset_tag}: {mism}")

        # --- location
        loc_key = location.strip().lower()
        loc_clean = LOCATION_MAP.get(loc_key, location.strip())

        # --- status / holder from assignee
        status, holder, cnote = classify(assignee)
        if cnote:
            notes.append(cnote)

        # --- condition / dongle notes
        cond = ""
        c = condition.strip()
        if c.lower() == "no dongle":
            cond = "Good"
            notes.append("No USB dongle")
        elif c.lower().startswith("damaged"):
            cond = "Damaged"
            notes.append(condition.strip())
            if status == "In Use":
                status = "Damaged"
        # else leave condition blank for backfill

        # --- money, with corruption fixes
        u = to_float(unit)
        t = to_float(tax)
        tot = to_float(total)

        if "VALUE" in (unit, tax, total):
            if raw_id == "IT0044":
                # Unit Value cell was overwritten by a pasted Slack message. Value lost.
                u = t = tot = None
                notes.append("Cost data lost in old sheet (cell corrupted) - backfill from invoice")
                findings.append(f"{asset_tag}: cost cells were corrupted (#VALUE!) - blanked, needs invoice backfill")
            elif raw_id == "IT0050":
                # Unit was '2,20,330.50' (Indian grouping) -> parser handled digits; recompute tax/total.
                u = 220330.50
                t = round(u * GST_RATE, 2)
                tot = round(u + t, 2)
                notes.append("Recovered from #VALUE!: recomputed tax/total at 18% GST")
                findings.append(f"{asset_tag}: recovered #VALUE! -> unit 220330.50, tax {t}, total {tot}")

        if tot is not None:
            total_value += tot

        fmt = lambda x: "" if x is None else f"{x:.2f}"

        out_rows.append([
            asset_tag, item.strip(), cat_clean, serial.strip(), model.strip(),
            status, holder, loc_clean,
            "", "", "",            # Date Received / Assigned / Returned - new, to backfill
            cond, fmt(u), fmt(t), fmt(tot), "; ".join(notes),
        ])

    out_path = os.path.join(os.path.dirname(__file__), "..", "clean-register.csv")
    out_path = os.path.abspath(out_path)
    with open(out_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        w.writerows(out_rows)

    # --- summary
    from collections import Counter
    status_counts = Counter(r[5] for r in out_rows)
    print(f"Wrote {len(out_rows)} assets -> {out_path}")
    print(f"Total inventory value (INR): {total_value:,.2f}")
    print("Status breakdown:")
    for s, n in status_counts.most_common():
        print(f"  {s:12s} {n}")
    print(f"\nData issues fixed/flagged ({len(findings)}):")
    for fnd in findings:
        print(f"  - {fnd}")


if __name__ == "__main__":
    main()
