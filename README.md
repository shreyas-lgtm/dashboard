# My Verizon — Account Overview

A single-screen dashboard that takes the confusing parts of the My Verizon
website — your bill, your plan, each phone line, the device-payment plans, and
your SIMs — and lays them out in one clear view, with plain-language
explanations of every Verizon term.

Built because the real Verizon site scatters this across a dozen screens and
buries it under jargon.

## What it shows

| Section | Answers the question |
|---------|----------------------|
| **Summary cards** | What's my total, when's it due, how much is plan vs devices, how much data did we use? |
| **Where your bill goes** | What are all these charges? (plan, device payments, perks, *surcharges*, taxes) — tap any row for a plain explanation |
| **What am I actually paying for?** | A glossary decoding Verizon vocabulary: line access, device payment agreements, promo credits, surcharges, eSIM, ICCID, billing cycle |
| **Your lines** | One card per phone: its plan charge, the device on it, how far along the device payoff is (and the *net* cost after promo credits), and its SIM |
| **SIMs & eSIMs** | Every SIM, its type, which line and device it's on, and whether it's active |

## Important: where the data comes from

**Verizon has no public consumer API**, and there's no safe, supported way to
log into a My Verizon account programmatically. So this dashboard does **not**
connect to Verizon. Instead it renders account data *you* provide. There are
two ways to do that:

### Option A — edit the sample file (recommended, no server)

The dashboard ships in mock mode showing a realistic sample account. To see
your own numbers, open [`src/mockData.ts`](src/mockData.ts) and replace the
values with the ones from your latest bill:

> My Verizon → **Bill** → **View bill** / **Bill details**, plus **Devices**
> for the device-payment balances and **Plan** for line charges.

Everything on the dashboard is computed from that one object.

### Option B — serve your own JSON

Set `VITE_USE_MOCK=false` and deploy the [`api/verizon.js`](api/verizon.js)
serverless endpoint. Paste your account (matching the `VerizonAccount` shape in
[`src/types.ts`](src/types.ts)) into the `ACCOUNT_JSON` environment variable, or
edit the endpoint to read from a Google Sheet / private gist / database.

## Run it locally

```bash
npm install
npm run dev          # opens with the sample account (mock mode is the default)
```

Build for production:

```bash
npm run build        # type-checks with tsc, then builds with Vite → dist/
```

## Deploy to Vercel

```bash
npm install -g vercel
vercel --prod
```

If you want live data (Option B), set `VITE_USE_MOCK=false` and add the
`ACCOUNT_JSON` environment variable in the Vercel dashboard
(Settings → Environment Variables). Never commit real account data to git.

## Tech

React + TypeScript + Vite + Tailwind. No runtime dependency on any Verizon
service. Data shape lives in `src/types.ts`; the glossary and colors in
`src/config.ts`.
