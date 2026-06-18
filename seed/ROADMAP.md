# MOMA Robot ERP — Build Roadmap

Goal: replicate the Origin V3 Project Tracker (Design → Procurement → Fabrication
→ IQC, plus planning & manpower) in ERPNext on Frappe Cloud.

The tracker has ~717 parts. ~455 have part numbers and ~638 a per-robot qty —
the rest are still *in design*. So we build the framework and it fills in as
parts get released. Each phase below is usable on its own.

## Where we are (done)
- **Structure**: warehouses (Main Office + Contract Manufacturer × Stores/WIP/Rejected),
  item groups, supplier groups, MR + PO approval workflows.
- **Data**: items (UID-coded), suppliers, opening stock — loaded from Excel, idempotent.
- All as re-runnable scripts in `seed/`.

## Mapping: tracker band → ERPNext

| Tracker band | ERPNext home | Native fit |
|---|---|---|
| Design & Release (revision, drawings, release status) | Custom fields on Item + custom "Design Release" DocType + workflow | ❌ custom (no native PLM) |
| BOM (Subsystem→Subassembly→Part, QTY per Robot) | Multi-level **BOM** | ✅ |
| Make vs Buy (Custom vs OTS) | Item: manufactured (has BOM) vs purchased | ✅ |
| Procurement (vendor, lead time, dates, qty to order) | **Buying** + Production Plan shortages | ✅ |
| Fabrication (Sheet metal/CNC/3D print, processing time) | **Work Order** + Routing/Operations + Job Card | ✅ |
| Manufacturing & manpower planning, assembly schedule | **Production Plan** + **Workstation/Operation** capacity + Job Card scheduling | ✅ (advanced) |
| IQC (type, status, QC report, rework) | **Quality Inspection** + templates | ✅ |
| Auto status / schedule health / "ready" flags | Custom fields + server scripts / dashboards | ❌ custom |

## Phases

### Phase 1 — Item enrichment (extends current loader) — *script*
Load all parts from the full tracker with:
- Make/Buy: Part Category `Custom` → manufactured; `OTS/Fasteners/Consumables` → purchased.
- Item attributes: Part type (Sheet metal/CNC/3D print/PCB-A), Material, Mass, Subassembly.
- Lead time, default supplier from the procurement band.
Prereq for BOMs. Low risk.

### Phase 2 — BOMs — *script + review*
Build a BOM per Subassembly from `QTY per Robot`, nested into a top-level
robot BOM. Only release-ready parts; in-design parts added as they finalize.

### Phase 3 — Manufacturing planning — *config + use*
**Production Plan**: enter robot qty → explode BOMs → auto-create Work Orders
(Custom parts) and Material Requests/POs (purchased shortfalls).

### Phase 4 — Routing, workstations & manpower — *config*
Define Operations (Sheet metal, CNC, 3D print, Assembly), Workstations with
hourly capacity, and Routings. Production Plan/Work Orders then schedule
assembly and load capacity; assign people via Job Cards. Manpower planning.

### Phase 5 — Quality / IQC — *config + script*
Quality Inspection Templates per part type; link to Purchase Receipt (incoming)
and Work Order (in-process). Replaces the IQC band.

### Phase 6 — Design/Release tracker (PLM) + auto-status — *custom app*
Custom fields on Item (Revision, Release Status, drawing/datasheet attachments)
and/or a custom **Design Release** DocType with an engineering-release workflow.
Auto roll-up flags (Overall Status, Schedule Health, Part Ready) via server
scripts. This is the non-native part and belongs in a **custom Frappe app**
(fixtures + code), deployed to Frappe Cloud via GitHub — the reproducible
"structure as code" approach.

## Architectural note
Phases 1–3 and 5 are largely **native config + API loader scripts** (what we've
been doing). Phase 4 is config. **Phase 6 needs a custom app** (custom DocTypes,
fields, workflows, server scripts) — at that point we graduate from loader
scripts to a versioned Frappe app, which also makes the whole structure
replicable on any site.

## Full workbook tab inventory (Origin V3 Tracker)
The source workbook has 24 tabs. How each maps:

| Tab | Purpose | ERPNext | Verdict |
|---|---|---|---|
| Design Tracker | part master + design/release status | Items + custom design fields | core + custom |
| AMR JIG BOM, Harness BOM | BOMs (clean PRT codes; harness = AWG/cores/len) | BOM (multi-level) | ✅ native |
| Inventory | batch MRP (req for N robots vs stock vs to-order) | Production Plan | ✅ native (this is MRP) |
| Procurement Pivot | procurement rollup | Buying reports | ✅ native |
| Manpower | crew capacity + man-days/phase | Project capacity / custom | ⚠️ weak — consider keep in sheet |
| Gantt | plan vs forecast schedule | Project + Tasks (Gantt) | ⚠️ partial — consider keep in sheet |
| Assembly Sign-off | per-component assembly checklist | Quality Inspection / custom DocType | custom |
| Actuals | phase-gated built/validated, buffer | Work Order / Project actuals | partial |
| Major Components, Mech Sys Requirements, Component Placement Status | design requirements | custom fields / DocType | custom |
| ToDos, Dashboard, Subsystem ownership, Scrap, Principles | PM/admin | Project/Task, reports | partial |
| *- Orig tabs | backups of originals | — | ignore |

### Recommended scope decision
- **Build in ERPNext:** Items, BOMs, Production Plan/MRP, Buying, Quality Inspection.
- **Custom app (Phase 6):** design-release/PLM, Assembly Sign-off, auto-status.
- **Keep in the sheet / a PM tool (don't ERP-ify):** Manpower man-day model and
  Gantt plan-vs-forecast — poor native fit, high custom cost, low payoff.
