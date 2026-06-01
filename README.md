# Origin Dashboard

This app hosts two tools, switchable from the top navigation:

1. **Manufacturing Cost Calculator** — budgetary part pricing from the SPMIL
   Annexure A rate card (default view). See below.
2. **Zoho Procurement — Live Pipeline Dashboard** — the original procurement
   dashboard.

---

## Manufacturing Cost Calculator

A calculator that estimates the manufacturing cost of machined/fabricated parts
from the **Annexure A — Manufacturing Rate Card** in the SPMIL contract-
manufacturing proposal (`SPMIL/ORIGIN/2026-05/003 Rev 5`). Build up a per-system
BOM (AMR, Sprayer, Sander, Operation Station), upload a drawing or CAD model to
pre-fill parameters, and get an itemised, rate-card-faithful estimate.

### How the cost is calculated

Per part, following the rate card sections A–F exactly:

| Step | Rate-card basis |
|------|-----------------|
| **Material** | finished kg × gross-up factor × (1 + 5% yield loss) × material ₹/kg |
| **Processing** | finished kg × process ₹/kg × multipliers (2.0× precision grind, 1.4× flatness) |
| **Holes** | drilled ₹8 + tapped ₹16 + countersunk ₹28, per hole |
| **Finishing** | finished kg × finish ₹/kg (powder ₹75, anodise ₹250) |
| **Small-part penalty** | ₹150/kg flat if the part is < 2 kg |
| **Buffer + QC** | subtotal × (1 + 7.5% design risk + 10% QC) = **unit cost** |

The rate card excludes SPMIL margin (23%) and GST (18%), so both are **off by
default** and offered as optional package-level toggles.

The whole rate card lives in one file — `src/calculator/rateCard.ts` — so a
revision is a one-line edit. The math is pure and unit-tested
(`src/calculator/costEngine.test.ts`).

### Drawing / CAD upload

Drag in a file to pre-fill the form (you always confirm the values):

| Format | What gets extracted |
|--------|--------------------|
| **STL** (binary + ASCII) | True solid volume → mass via material density + bounding box. Re-derives mass when you change material or units. |
| **DXF** | Counts `CIRCLE` entities as candidate drilled holes; reads drawing extents and hole Ø range. |
| **STEP / IGES** | Scans ASCII text for material, finish, weight and hole callouts; detects model units and B-rep complexity. |
| **PDF** | Scans readable text for callouts (compressed vector geometry is not parsed — enter parameters by hand). |

All parsing runs client-side; no file leaves the browser. Parsers are
dependency-free and tested (`src/calculator/fileParsers/parsers.test.ts`).

### Run / test

```bash
npm install
npm run dev      # open the app, "Manufacturing Calculator" is the default tab
npm test         # vitest — cost engine + parser tests
```

---

## Zoho Procurement — Live Pipeline Dashboard

A React dashboard that pulls live data from Zoho Procurement's API and shows where things are stuck in the procurement workflow. Designed to be embedded as a native Web Tab inside Zoho Procurement.

## Architecture

```
Zoho Procurement (data)
    ↓ API calls (auto-refresh every 5 min)
Vercel serverless proxy  ← handles OAuth token refresh, hides credentials
    ↓
React frontend (Vite + TypeScript + Tailwind)
    ↓ embedded via Web Tab
Zoho Procurement sidebar
```

## Pipeline KPIs

| KPI | Source | Filter |
|-----|--------|--------|
| PRs Awaiting Approval | Purchase Requests | status = `pending_approval` |
| Approved PRs Pending PO | Purchase Requests | status = `approved`, no linked PO |
| POs Pending Approval | Purchase Orders | status = `pending_approval` |
| Open POs (Pending Delivery) | Purchase Orders | status = `issued` |
| Items Received Pending Bill | Purchase Receives | billing_status ≠ `billed` |
| Overdue POs | Purchase Orders | status = `issued`, delivery_date < today |

Additional widgets: total spend this month, top 5 vendors by PO value, overdue POs detail table, stuck approved PRs table.

## Setup

### 1. Zoho credentials

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Where to find it |
|----------|-----------------|
| `ZOHO_CLIENT_ID` | [Zoho API Console](https://api-console.zoho.com) → Self Client |
| `ZOHO_CLIENT_SECRET` | Same self-client |
| `ZOHO_REFRESH_TOKEN` | Exchange auth code via Apps Script (see Phase 1 checklist) |
| `ZOHO_ORGANIZATION_ID` | Already set to `60068679686` |

### 2. Local development

```bash
npm install

# Option A: mock data (no Zoho credentials needed)
VITE_USE_MOCK=true npm run dev

# Option B: live Zoho data via vercel dev
npm install -g vercel
vercel dev          # runs both frontend + serverless proxy on port 3000
```

### 3. Deploy to Vercel

```bash
vercel --prod
```

Set the four `ZOHO_*` environment variables in the Vercel dashboard (Settings → Environment Variables) — **never commit `.env` to git**.

### 4. Embed in Zoho Procurement

1. Go to **Settings → Customization → Web Tabs**
2. Click **New Web Tab**
3. Paste your Vercel deployment URL
4. Name it **"Pipeline Dashboard"**
5. Save — it now appears in Zoho's left sidebar

## Adjusting status strings

If your Zoho instance returns different status values than expected, update `src/config.ts`. The Phase 1 checklist asks you to document the exact statuses returned by each module — once you have live API responses, compare them against the constants in that file.

## API budget

~1,200 calls/day against a 10,000/day limit (12% usage). Dashboard fetches all modules on page load and auto-refreshes every 5 minutes.
