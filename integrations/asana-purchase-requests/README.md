# Purchase Request form ↔ Asana

Two-way integration between the purchase-request responses sheet and an Asana
board.

- **Sheet → Asana**: setting the approval column to `Approved` creates a task,
  routes it to the right procurement owner, and drops it in **Pending**.
- **Asana → Sheet**: a ten-minute poll writes each card's board section back as
  the order status, and mirrors its comments into the sheet.

**Status lives in the board sections and nowhere else.** A second copy of the same
fact is how this sheet ended up with `Column 9` and `Final Approval` disagreeing
with each other.

---

## Status flow

The five statuses are board columns, created by `ensureSections()`:

```
Pending → Quotation Awaited → Ordered → Handed Over
              ↕                                      
           Rework                     Cancelled
```

`Cancelled` and `Rework` are not price-gated; `Ordered` and `Handed Over` are.

People change status by dragging a card. The sheet follows within ten minutes.

### The price gate

`Ordered` and `Handed Over` require a recorded price. Asana cannot *prevent* a
drag — only react to one — so the sync moves the card back to where the sheet
says it belongs and comments explaining why:

> Moved back to "Quotation Awaited". The price has to be recorded on this
> request's row in the responses sheet before it can go to "Ordered". Add the
> price against this PR ID in the sheet, then move the card again.

There is a visible gap of up to ten minutes before the card snaps back. Shorten
it with `setupSyncTrigger(5)` if that feels too loose.

No revert loop is possible: after the move, Asana matches the sheet, so the next
poll sees no difference and says nothing further.

**Price is only ever entered in the responses sheet**, never in Asana. A card
cannot leave Quotation Awaited for Ordered until a price exists on that PR ID's
row — and it must contain at least one digit. `NA`, `-`, `TBD` and formula
errors like `#N/A` do not count; the old sheet's placeholder habits would
otherwise let cards through the gate with no price at all. `0` does count. This is the one place procurement has to touch the sheet rather than the
board; everything else is done by dragging cards.

If the sheet has no recorded status to move the card back to, the sync comments
but leaves the card alone — guessing would drag a ticket that has legitimately
progressed back to Pending.

### Rework

Rework means the **requester** has to recheck the request. Requesters have no
Asana access, so when a card lands in Rework the sync emails them directly with
the PR ID and item, asking for a correction. Without that the one person who has
to act would never see it.

### Who uses Asana

**The procurement team only** — Kiran, Abish and Syed. Requesters never get a
seat, are never added as followers, and interact solely through the Google Form
and email. That keeps the board quiet and avoids buying seats for the whole
company.

### Reassignment

The assignee is set once, at creation, and **never touched again**. Procurement
pushing tickets between themselves in Asana is expected and is not undone by the
sync.

### Comments

Asana comments are mirrored into an `Asana Comments` column, newest first, one
per line:

```
[10/08 11:15] Abish Kumar: Quotation received, / 6531 INR
[09/08 05:32] Kiran: Vendor confirmed lead time 3 days
```

One-way, Asana → sheet. Comments typed in the sheet are not pushed to Asana —
there would be no reliable way to tell a new sheet comment from an edited mirror
of an Asana one.

Details worth knowing:

- **System events are excluded.** "moved this task to Ordered" and similar are
  filtered out; only real comments are mirrored.
- **The log is rebuilt from Asana each poll, not appended to.** So there is no
  "last seen comment" bookkeeping to drift, and a comment edited or deleted in
  Asana corrects itself in the sheet. The flip side: the sheet is a mirror, so
  editing that cell by hand achieves nothing lasting.
- **Multi-line comments are collapsed** with ` / ` so one comment stays on one
  line and the cell remains readable.
- Capped at the 20 most recent comments and 5000 characters
  (`CFG.commentsMaxCount`, `CFG.commentsMaxChars`); a cell holds 50k, so this is
  deliberately conservative.
- Fetching comments costs one extra API call per task, so it only runs for tasks
  Asana reports as modified since the last poll. The cutoff is rolled back five
  minutes so a change landing mid-run is not missed, and `LAST_SYNC_AT` only
  advances after a clean run — a failed run re-examines the same window rather
  than skipping it.
- Set `CFG.syncComments = false` to turn this off.

On the old sheet the mirror lands in the existing `SCM Remark` column; on a fresh
sheet an `Asana Comments` column is created.

### Unrecognised sections

A section whose name is not in `CFG.statuses` is **ignored**, never written to the
sheet, and reported by email once per sync. Someone adding an "On Hold" column
would otherwise write that string straight into `Order Status`.

---

## Approval

**Lead Approval is always filled; Final Approval only sometimes.** So Lead
Approval is the normal gate, and Final Approval is an occasional higher authority
that outranks it — once Final Approval is decided, Lead Approval is set to match
automatically. A blank Final Approval changes nothing.

| Lead Approval | Final Approval | Governs | Lead cell rewritten |
|---|---|---|---|
| *(blank)* | `Approved` | **Approved** | yes → `Approved` |
| `Re-verify` | `Approved` | **Approved** | yes → `Approved` |
| `Rejected` | `Approved` | **Approved** | yes → `Approved` |
| `Approved` | `Rejected` | **Rejected** | yes → `Rejected` |
| `Approved` | `Approved` | Approved | no — already agrees |
| anything | *(blank or unrecognised)* | the Lead Approval value | no |

A **final rejection outranks a lead approval too**. Without that, a request the
senior overruled would still be ordered — so the override works in both
directions. Only `Approved` and `Rejected` cascade; `Re-verify` in the Final
Approval column is ignored.

The cascade is written back to the Lead Approval cell so the sheet stays
self-consistent and anything filtering on that column keeps working. A script
write does not re-fire `onEdit`, so there is no loop. Tickets created this way
say so in their description: *"Approved via Final Approval; Lead Approval was set
to match."*

Set `CFG.finalApprovalOverrides = false` to disable, and the mechanism is skipped
entirely if the sheet has no Final Approval column.

### The Lead Approval dropdown

The requester chases their own lead, who sets **Lead Approval** on the sheet. All
three dropdown values are acted on:

| Decision | No ticket yet | Ticket already exists |
|---|---|---|
| `Approved` | Ticket created, routed, placed in Pending | Nothing — unless it was Cancelled, in which case it returns to Pending |
| `Rejected` | Requester emailed | Card moved to **Cancelled**, comment posted, requester emailed |
| `Re-verify` | Requester emailed | Card moved to **Rework**, comment posted, requester emailed |

Anything else, including blank, is ignored.

Matching is exact rather than prefix-based here — unlike routing — because
`Rejected` and `Re-verify` both begin with "Re".

Either column starts this off: an edit to Lead Approval **or** Final Approval
runs the same logic.

### Revised decisions

A decision changed after the ticket exists is handled, in both directions.
`Approved → Rejected` cancels the card. `Rejected → Approved` brings it back to
Pending with a comment, so it is never stranded in Cancelled with nothing to
signal that it is live again.

### The requester edits their response after approval

Google fires the form-submit trigger **again** when a requester edits a response,
and the row is updated in place — so a row that already carries a `PR_ID` is, by
definition, an edit rather than a new request. That is the whole detection
mechanism; no extra state is needed.

| Card state | What happens |
|---|---|
| No card yet (not approved) | Nothing — the card created later uses the new values anyway |
| Pending / Quotation Awaited / Rework / Cancelled | Card name and description refreshed, comment posted noting the edit |
| **Ordered / Handed Over** | Card refreshed **and** escalated: a comment warns that the order was placed against the earlier spec, and `errorNotifyEmail` is alerted |

Asana keeps the previous description in the task's own activity history, so
overwriting loses nothing.

**Prevention is cheaper.** Google Forms has *Settings → Responses → Allow response
editing*, off by default. If you leave it off, this situation cannot arise and the
detection above never fires. Turn it on only if you want requesters fixing their
own typos rather than going through Rework — which is a reasonable trade, and now
a safe one.

### Late rejection, after the money is spent

Because Final Approval is often filled well after Lead Approval, a `Rejected` can
land on a request that has already been **Ordered** or **Handed Over**. Cancelling
then would be wrong — the order is placed, or the item is already with the
requester.

So for any status in `CFG.pointOfNoReturn` the card is **left exactly where it
is**, and instead:

- a comment is posted saying it was rejected but not cancelled, and why
- `CFG.errorNotifyEmail` is alerted, because someone has to decide whether the
  order can be returned or cancelled with the vendor

`Re-verify` behaves the same way past that line: sending an already-ordered item
back to Rework would misrepresent it as pending.

Comments name which column was changed — `Lead Approval` or `Final Approval` — so
it is clear where a late reversal came from.

### Requester emails

Requesters have no Asana seat, so they are emailed only when **they** need to act:

| Trigger | Why |
|---|---|
| `Rejected` | Otherwise a rejection is silent and they wait indefinitely |
| `Re-verify` | Their lead wants something confirmed before approving |
| Card moved to Rework | Procurement needs the request corrected |

`Approved`, `Ordered` and `Handed Over` are deliberately silent — the requester is
already chasing the approval, and they learn about delivery by receiving the item.
Add an entry to `REQUESTER_EMAILS` and a call site if that changes.

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

## PR_ID

PR_IDs are assigned by this script on form submission, from a counter in Script
Properties — not by a formula.

The old form's values prove that is the right choice. They track submission order
rather than row position, so they survived the sheet being sorted; and they
contain gaps (1450, 1501, 1520, 1521, 1523, 1525, 1526 are missing from
1444–1527). A `ROW()`-based formula renumbers every row when the sheet is sorted,
and neither a `ROW()` nor a `RANK()` formula can produce gaps. So the old values
were written once and stored as literals.

A counter reproduces that and is immune to both sorting and row deletion. An
issued PR_ID never changes, which matters when it has been quoted on a PO.

```js
seedPrIdCounter(1527)   // next issued is PR-2026-1528
```

The counter defaults to `CFG.prIdStartFrom` (1527) if never seeded, so the
sequence continues from the old form rather than restarting.

---

## Setup

### Step 1: Build the new form, then map the columns

The script finds columns by **header name**, not position, and each field has a
list of candidate names in `COL` — the new form's headers first, the old form's
kept as fallbacks.

After the new form exists and has at least one response, run
**`checkSheetMapping()`**:

```
Lead Approval:    I
Final Approval:   J
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
seedPrIdCounter(1527) // continue the old form's numbering
setupTrigger()        // PR_ID + edited responses, and Asana task on approval
setupSyncTrigger(10)  // Asana -> sheet, every 10 minutes
```

`setupTrigger()` installs `onFormSubmitHandler` and `onApprovalEdit`, removing any
previous copies — including one installed under the older
`onFormSubmitAssignPrId` name.

Each replaces any previous copy of itself rather than stacking duplicates.

### Step 7: Test end to end

1. Submit a test request, picking `Mechanical - OTS`.
2. Set the approval column to `Approved`. Within seconds a task link appears in
   `Asana Task`, assigned to Kiran, sitting in **Pending**, and `Order Status`
   reads `Pending`.
3. Drag it to **Quotation Awaited** and add a comment on the card. Within ten
   minutes the sheet's status and comment columns both follow.
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
| Approval set to `Rejected` | Requester emailed; existing card moved to Cancelled |
| Approval set to `Re-verify` | Requester emailed; existing card moved to Rework |
| Approval flipped back to `Approved` | A Cancelled card returns to Pending |
| Approval edited to `Approved` twice | Second edit skipped; the existing URL is the guard |
| Rows approved by fill-down or paste | Every touched row processed, not just the first |
| Two people approving at once | Serialised by `LockService`, so no double-creation |
| Card dragged between sections | Status written to the sheet on the next poll |
| Card dragged to Ordered / Handed Over with no price | Moved back, comment posted, sheet unchanged |
| Card dragged to a section not in `CFG.statuses` | Ignored, not written to the sheet, reported by email |
| Card dragged to Rework | Status synced, and the requester is emailed to recheck |
| Comment added in Asana | Mirrored to the sheet's comment column on the next poll |
| Comment edited or deleted in Asana | Mirror is rebuilt, so the sheet corrects itself |
| Comment typed into the sheet | Not pushed to Asana, and overwritten on the next poll |
| Form submitted | PR_ID assigned from the counter; never overwritten if already present |
| Response edited by the requester | Card name and description refreshed; escalated if already Ordered |
| Ticket reassigned in Asana | Left alone — the sync never writes assignees |
| Task created by hand in Asana | Ignored by the sync; it has no GID in the sheet |
| Routed owner is not an Asana user | Task created unassigned, warning in the description, email sent |
| Asana call fails | `ERROR: …` written into the `Asana Task` cell, email sent, other rows unaffected |

### Ticket shape

```
Title     PR-2026-1515 · DC motor for Operation Station Turntable POC
Assignee  by routing rule
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
already has a URL, so re-running is safe. It also processes **only `Approved`
rows** — handing the whole sheet to the row processor would fire rejection and
re-verify emails at requesters over historical decisions.

---

## Not yet verified against a live Asana workspace

The offline suite covers the pure logic — routing across all six Product type
options, the price gate, status comparison, section reading, column resolution
against both the old and the expected new header rows, and the ticket body:

```
node integrations/asana-purchase-requests/test-local.js
```

What it cannot check is the Asana API contract itself: payload shapes for task
creation, section moves, comments, and pagination. Those need one real run
through Step 7.

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
| Comments never appear | `CFG.syncComments` is false, or the task has only system events |
| Comments stopped updating | A failed run leaves `LAST_SYNC_AT` behind; check **Executions** |
| `These required columns are not mapped` | `price`, `productType` or `item` header not found — run `checkSheetMapping()` |
| Everything bounces out of Ordered | No price on the row, the cell has no digits (`NA`, `-`), or `price` is unmapped |
| PR_IDs restart from 1 | Counter never seeded — run `seedPrIdCounter(1527)` |
| PR_ID blank on a new row | `onFormSubmitAssignPrId` not installed, or no PR_ID column |
| Cards land outside any section | `ensureSections()` not run, so `Pending` does not exist |

Execution logs are under **Executions** in the Apps Script editor.
