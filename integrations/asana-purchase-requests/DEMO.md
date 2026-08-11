# Demo runbook — first live run

Goal: walk one purchase request through the entire lifecycle, live, in ~45
minutes including setup. This doubles as the verification run the README calls
for — after this, the system is proven, not just tested.

## What you need before starting

| # | Thing | Notes |
|---|---|---|
| 1 | The new Google Form, live | With the **Product type** question. Submit one throwaway response so the responses sheet exists |
| 2 | The responses sheet open | Note the exact tab name — usually `Form responses 1` |
| 3 | A **Lead Approval** dropdown column | Values exactly: `Approved`, `Rejected`, `Re-verify` |
| 4 | Your Asana PAT | You have this. Keep it in a password manager, not a doc |
| 5 | An Asana project named **Procurement** | Create as a **Board**, not a list |
| 6 | Kiran, Abish, Syed as workspace **members** | Guests cannot be assigned tasks |
| 7 | 2 browser tabs | Sheet + Asana board side by side is most of the demo's effect |

## Setup (~20 min, one time)

Work through these in order. Each step's expected output is shown — stop and
report anything different.

**1. Install the script.**
Sheet → Extensions → Apps Script → delete the placeholder → paste `Code.gs` →
save.

**2. Store the token.**
⚙ Project Settings → Script Properties → Add:
property `ASANA_PAT`, value = your token.

**3. `testConnection()`** — pick it in the function dropdown, Run, approve the
OAuth prompts (it asks for spreadsheet, external requests, email).
```
Token OK. Authenticated as <you> <your email>
```

**4. `discover()`** — copies the log's two key numbers into the top of the code:
```js
workspaceGid: '<from === WORKSPACES ===>',
projectGid:   '<from === PROJECTS ===, the Procurement one>',
errorNotifyEmail: 'shreyas@origin.tech',   // while you are there
```
Save.

**5. `ensureSections()`** — creates the six board columns:
```
created  Pending
created  Quotation Awaited
created  Ordered
created  Handed Over
created  Rework
created  Cancelled
```
Drag them into that order in Asana (the script never reorders).

**6. `verifyRouting()`** — all three owners must say OK:
```
OK    kiran@origin.tech  ->  12010...   (Product type = Mechanical)
OK    abish@origin.tech  ->  12010...   (Product type = Electrical)
OK    syed@origin.tech   ->  12010...   (Product type = Office supplies)
```
A FAIL means that person is not a member of the workspace yet.

**7. `checkSheetMapping()`** — every field should resolve. If anything prints
`MISSING`, paste the whole output back to Claude; `price` and `productType` are
the two that must not be missing.

**8. `seedPrIdCounter(1527)`** — in the editor, temporarily type at the bottom:
```js
function runSeed() { seedPrIdCounter(1527); }
```
Run `runSeed`, confirm the log says next is `PR-2026-1528`, delete the helper.

**9. Install the triggers:**
`setupTrigger()` then `setupSyncTrigger(5)` — 5-minute sync for the demo so
nobody waits ten minutes; relax to 10 after.

## The demo itself (~20 min)

Two tabs open: responses sheet and Asana board.

| # | Do | Expect | Proves |
|---|---|---|---|
| 1 | Submit the form: item "Demo widget", **Product type = Mechanical - OTS**, your own email as requester | Within seconds the row gets `PR-2026-1528` | PR_ID counter |
| 2 | Set that row's **Lead Approval = Approved** | Within seconds: `Asana Task` URL + GID on the row, `Order Status = Pending`; card in **Pending** on the board, assigned to **Kiran**, description carries all fields | Ticket creation + routing |
| 3 | Drag the card to **Quotation Awaited** | Within 5 min the sheet's status follows | Asana → sheet sync |
| 4 | Add a comment on the card: "Vendor quoted 4,500" | Within 5 min it appears in the sheet's comments column | Comment mirror |
| 5 | Drag the card to **Ordered** — with the price cell **empty** | Within 5 min the card snaps back to Quotation Awaited with a comment explaining why | The price gate |
| 6 | Type `4500` in the row's price cell, drag to **Ordered** again | It sticks; sheet says Ordered | Gate satisfied |
| 7 | Edit your form response (Forms → Responses → edit), change quantity | Within seconds the card description updates + a comment notes the edit | Edit handling — the one documented-but-unobserved behaviour |
| 8 | Set **Lead Approval = Re-verify** on the row | Card moves to **Rework**; you (as requester) get an email | Decision revision + requester email |
| 9 | Set it back to **Approved**, drag card to **Handed Over** | Sticks (price exists); sheet follows | Full lifecycle complete |
| 10 | Delete the demo card in Asana and the demo row, or leave them as the worked example | — | — |

Step 5 has a deliberate oddity worth narrating if you demo to others: the card
sits in Ordered for up to 5 minutes before snapping back. Asana cannot block a
drag, only react to one.

## If something misbehaves

- Grab the error from Apps Script → **Executions** (every run is logged there)
- Paste it, plus which step you were on, back to Claude
- Nothing is damaged by a failed step: re-running is safe everywhere — creation
  is idempotent, the sync self-corrects, and the price gate cannot loop

## After the demo

- `setupSyncTrigger(10)` to relax the poll
- Decide who owns the installation: triggers run as whoever installed them, so
  consider redoing steps 1–9 as a shared account before real traffic (10 min)
- Turn off the old form's accepting-responses so requests stop splitting across
  two sheets
