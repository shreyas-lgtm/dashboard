# Purchase Request form ↔ Asana

Two-way integration between the purchase-request responses sheet and an Asana
board.

- **Sheet → Asana**: setting the approval column to `Approved` creates a task,
  routes it to the right procurement owner, and drops it in **Pending**.
- **Asana → Sheet**: a ten-minute poll reads each card's board section and writes
  that status back to the sheet.

**Status lives in the board sections and nowhere else.** A second copy of the same
fact is how this sheet ended up with `Column 9` and `Final Approval` disagreeing
with each other.

---

## Status flow

The five statuses are board columns, created by `ensureSections()`:

```
Pending → Quotation Awaited → Ordered → Handed Over
                                  ↖ Rework ↙
```

People change status by dragging a card. The sheet follows within ten minutes.

### The price gate

`Ordered` and `Handed Over` require a recorded price. Asana cannot *prevent* a
drag — only react to one — so the sync moves the card back to where the sheet
says it belongs and comments explaining why:

> Moved back to "Quotation Awaited". A price has to be recorded before this can
> go to "Ordered". Add the price on the request row in the responses sheet, then
> move the card again.

There is a visible gap of up to ten minutes before the card snaps back. Shorten
it with `setupSyncTrigger(5)` if that feels too loose.

No revert loop is possible: after the move, Asana matches the sheet, so the next
poll sees no difference and says nothing further.

**Letting procurement set the price without leaving Asana** is worth doing. Create
a price custom field on the project, put its GID in `CFG.customFieldGids.price`,
and the sync copies that value into the sheet *before* evaluating the gate — so
entering the price on the card and dragging it in one go works.

### Reassignment

The assignee is set once, at creation, and **never touched again**. Procurement
pushing tickets between themselves in Asana is expected and is not undone by the
sync.

---

## Routing

From the new form's required **Product type** question. Rules apply in order,
first match wins (`CFG.routingRules`):

| Product type | Owner |
|---|---|
| `Mechanical - OTS`, `Mechanical - Custom` | kiran@origin.tech |
| `Electrical - OTS`, `Electrical - custom` | abish@origin.tech |
| `Office supplies` | syed@origin.tech |
| `Other:` free text | abish@origin.tech |

Matching is case-insensitive on the **start** of the value, so both `Mechanical -`
variants hit one rule and the lowercase `custom` in `Electrical - custom` is fine.

Google Forms writes whatever a requester types into `Other:` straight into the
cell, so unrecognised values fall through to the default. Free text that happens
to start with a known word still routes correctly — `Mechanical fastener` goes to
Kiran.

If a routing address does not match an Asana user, the task is still created but
left unassigned, with a warning in its description and an email to
`CFG.errorNotifyEmail`. Run `verifyRouting()` to catch that before go-live.

---

## Setup

### Step 1: Build the new form, then map the columns

The script finds columns by **header name**, not position, and each field has a
list of candidate names in `COL` — the new form's headers first, the old form's
kept as fallbacks.

After the new form exists and has at least one response, run
**`checkSheetMapping()`**:

```
Approval column:  I
Task URL column:  N
Task GID column:  O

Field mapping:
  col C    productType
  col M    price
  MISSING  prId          (tried: PR_ID | PR ID)
```

Anything `MISSING` needs its real header name added to the front of that entry in
`COL`. Two matter more than the rest: **`price`** gates the Ordered and Handed
Over statuses, and **`productType`** drives all routing. If `price` is unmapped,
nothing can ever reach Ordered.

Also confirm `CFG.sheetName` matches the new responses tab, and that
`CFG.approvalHeaders` contains the new form's approval column name.

### Step 2: Create the Apps Script project

1. Open the responses sheet → **Extensions → Apps Script**
2. Replace the placeholder `Code.gs` with this repo's `Code.gs`
3. **Project Settings → Script Properties → Add script property**
   - Property: `ASANA_PAT`
   - Value: your personal access token

The token belongs in Script Properties and nowhere else — not in `Code.gs`, not
in this repo.

### Step 3: Verify the token

Run `testConnection()`. Approve the OAuth prompt on first run (it needs
spreadsheet access, outbound requests, and mail for error alerts).

```
Token OK. Authenticated as <name> <email>
```

A `401` means the token was copied incompletely — they are long.

### Step 4: Create the Asana project, then the sections

Create the project the tickets land in — e.g. **Procurement** — as a **board**.

Run `discover()` to log workspace, project, user, section and custom-field GIDs.
Put the workspace and project GIDs into `CFG`, then run **`ensureSections()`**:

```
created  Pending
created  Quotation Awaited
created  Ordered
created  Handed Over
created  Rework
```

It only creates what is missing and never reorders what exists, so drag the
columns into workflow order in Asana afterwards.

### Step 5: Check routing and set the alert address

Run **`verifyRouting()`** — all three owners must resolve to Asana users:

```
OK    kiran@origin.tech  ->  1201234567890   (Product type = Mechanical)
OK    abish@origin.tech  ->  1201234567891   (Product type = Electrical)
OK    syed@origin.tech   ->  1201234567892   (Product type = Office supplies)
```

Set `CFG.errorNotifyEmail`. A silently failing integration is worse than none —
approvals would look pushed when they were not.

### Step 6: Install both triggers

```js
setupTrigger()        // sheet -> Asana, on approval
setupSyncTrigger(10)  // Asana -> sheet, every 10 minutes
```

Each replaces any previous copy of itself rather than stacking duplicates.

### Step 7: Test end to end

1. Submit a test request, picking `Mechanical - OTS`.
2. Set the approval column to `Approved`. Within seconds a task link appears in
   `Asana Task`, assigned to Kiran, sitting in **Pending**, and `Order Status`
   reads `Pending`.
3. Drag it to **Quotation Awaited**. Within ten minutes the sheet follows.
4. Drag it to **Ordered** with the price empty. It should bounce back with a
   comment.
5. Fill in the price, drag it to **Ordered** again. It should stick, and
   `Ordered Date` gets stamped if that column exists.

To re-test a row, clear its `Asana Task` cell and re-enter the approval.

---

## Behaviour

| Situation | What happens |
|---|---|
| Approval column set to `Approved` | Task created, routed, placed in Pending; URL + GID written back |
| Approval set to `Rejected` | Nothing |
| Approval edited to `Approved` twice | Second edit skipped; the existing URL is the guard |
| Rows approved by fill-down or paste | Every touched row processed, not just the first |
| Two people approving at once | Serialised by `LockService`, so no double-creation |
| Card dragged between sections | Status written to the sheet on the next poll |
| Card dragged to Ordered / Handed Over with no price | Moved back, comment posted, sheet unchanged |
| Price entered on the card (if the custom field is configured) | Copied to the sheet, then the gate is re-evaluated |
| Ticket reassigned in Asana | Left alone — the sync never writes assignees |
| Task created by hand in Asana | Ignored by the sync; it has no GID in the sheet |
| Routed owner is not an Asana user | Task created unassigned, warning in the description, email sent |
| Asana call fails | `ERROR: …` written into the `Asana Task` cell, email sent, other rows unaffected |

### Ticket shape

```
Title     PR-2026-1515 · DC motor for Operation Station Turntable POC
Assignee  by routing rule
Follower  requester, if their email matches an Asana user
Section   Pending
Due       approval date + urgency allowance
Notes:
  Requester:         harini@origin.tech
  Item:              DC motor for Operation Station Turntable POC
  Quantity:          1
  Part / model no.:  24V/12RPM
  Product type:      Electrical - OTS
  Urgency:           High (Needed within 2-3 day)
  Preferred vendor:  -

  Justification
  -------------
  Need urgently for POC of turntable

  Link
  ----
  https://thinkrobotics.com/products/37mm-encoder-dc-metal-gearmotors

  ---
  Routed to abish@origin.tech - Product type = Electrical.
  Move this card between sections to update its status; the sheet follows.
```

`Link` sits in its own block because some of these URLs run to several hundred
characters. `Justification` is included on top of the seven requested fields — it
was filled on 78 of 78 rows on the old form and is the only field saying *why* an
item is needed. Drop the `justification` lines in `buildNotes_` for strictly the
seven.

Due date allowances, from `CFG.dueDaysByUrgency`:

| Urgency | Due |
|---|---|
| `Critical …` | +1 day |
| `High …` | +3 days |
| `Normal …` | +7 days |
| `Planned …` | +30 days |

Matching is on the leading word, so the parenthetical wording can change freely.

---

## Why polling, not webhooks

An Asana webhook needs a public HTTPS endpoint and a handshake, which in Apps
Script means a Web App deployed to "anyone". At ~19 tickets a week a ten-minute
poll costs almost nothing and has far less to go wrong. The trade-off is latency:
a status change takes up to ten minutes to reach the sheet.

The sheet is never read as a status source — the sync is one-way, Asana to sheet.
If someone edits `Order Status` in the sheet by hand it will be overwritten on the
next poll, which is the intended behaviour given sections are the source of truth.

---

## Backfilling

`backfillApproved()` is deliberately not wired to any trigger — dropping a whole
backlog onto a new board buries it. Run it in batches from the editor:

```js
backfillApproved(10)   // oldest 10 approved rows without a task
```

It sleeps between calls to stay inside Asana's rate limit and skips anything that
already has a URL, so re-running is safe.

---

## Not yet verified against a live Asana workspace

The offline suite covers the pure logic — routing across all six Product type
options, the price gate, status comparison, section reading, column resolution
against both the old and the expected new header rows, and the ticket body:

```
node integrations/asana-purchase-requests/test-local.js
```

92 assertions. What it cannot check is the Asana API contract itself: payload
shapes for task creation, section moves, comments, and pagination. Those need one
real run through Step 7.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `ASANA_PAT is not set in Script Properties` | Property missing or misspelled |
| `Asana 401` | Token truncated on copy, or revoked |
| `Asana 403` | Token's owner lacks access to that project |
| `Asana 404` on `/tasks` | `CFG.projectGid` wrong — re-run `discover()` |
| `Could not find the approval column` | Header renamed — add the new name to the front of `CFG.approvalHeaders`; the error lists the current headers |
| `No status column …` | `Order Status` could not be found or created — check `COL.status` |
| Nothing happens on approval | `setupTrigger()` not run, or `CFG.sheetName` does not match the tab |
| Status never syncs | `setupSyncTrigger()` not run, or the row has no `Asana Task GID` |
| Everything bounces out of Ordered | `price` is unmapped — run `checkSheetMapping()` |
| Cards land outside any section | `ensureSections()` not run, so `Pending` does not exist |

Execution logs are under **Executions** in the Apps Script editor.
