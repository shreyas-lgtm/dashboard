# Purchase Request form → Asana

Creates an Asana task when the approval column on the purchase-request responses
sheet is set to `Approved`.

- **Sheet:** `Purchase Request form (Responses)`, tab `Form responses 1`
- **Trigger column:** J, headed `Lead approval`.
- **Guard against duplicates:** the task URL is written into an `Asana Task`
  column; rows that already have one are skipped.

At current volume this creates roughly 19 tasks a week.

## Why the trigger is `onEdit` and not `onFormSubmit`

Approval is typed in by hand well after the form is submitted, so a submit-time
hook would fire while column J is still empty. It also has to be an
**installable** trigger rather than a simple one: simple triggers are barred
from services that need authorization, so a simple `onEdit` cannot reach the
Asana API at all.

---

## Setup

### Step 1: Header on J1 — done

J1 reads `Lead approval`, and `CFG.approvalHeaders` is set to match.

If you ever rename it again, add the new name to the **front** of that list:

```js
approvalHeaders: ['Lead approval', 'Approval Decision', 'Column 9'],
```

Matching ignores case and surrounding spaces, and the column is found by name
rather than by position — so moving it is safe too. If none of the listed names
are present the script stops with an error naming what it expected and dumping
the actual header row; it will not fall back to guessing a column position,
because reading the wrong column would create tasks from unrelated data.

While you are in there, consider deleting column K (`Final Approval`). It only
ever contains `Approved`, 18 times, and every one of those rows is already
approved in column J. Two approval columns is how J ended up unlabelled.

### Step 2: Create the Apps Script project

1. Open the responses sheet → **Extensions → Apps Script**
2. Delete the placeholder `Code.gs` contents and paste in this repo's `Code.gs`
3. **Project Settings → Script Properties → Add script property**
   - Property: `ASANA_PAT`
   - Value: your personal access token

The token belongs in Script Properties and nowhere else — not in `Code.gs`, not
in this repo.

### Step 3: Verify the token

Run `testConnection()`. Approve the OAuth prompt on first run (it needs
spreadsheet access, outbound requests, and mail for error alerts).

Expected log:

```
Token OK. Authenticated as <name> <email>
```

A `401` here means the token was copied incompletely — they are long.

### Step 4: Create the Asana project

In Asana, make the project the tasks will land in — e.g. **Procurement**. A
board layout with sections matching your `Order Status` values works well:

```
Approved → Sourcing → Ordered → Handed Over
```

Custom fields are optional. Leave `CFG.customFieldGids` empty and every field
still appears in the task description; add GIDs later to make them filterable.
Worth confirming with Addrs Labs how many custom fields your Starter plan allows
before designing around them.

### Step 5: Discover your GIDs

Run `discover()` and read the execution log. It prints:

- **Workspaces** — copy the GID into `CFG.workspaceGid`
- **Projects** — copy the Procurement project's GID into `CFG.projectGid`
- **Users** — for reference; routing resolves emails to GIDs automatically

Fill the first two into the `CFG` block at the top of `Code.gs`, then run
`discover()` again to list the custom fields on the project you just named.

Then run **`verifyRouting()`**. It checks that all three procurement owners exist
as Asana users in the workspace, because an address that does not resolve
produces unassigned tasks:

```
OK    kiran@origin.tech  ->  1201234567890   (Item Type = Fabrication)
OK    syed@origin.tech   ->  1201234567891   (Product Main Category = General & Administrative)
OK    abish@origin.tech  ->  1201234567892   (default route)
```

### Step 6: Set the notification address

Set `CFG.errorNotifyEmail` to whoever should hear about failures. A silently
failing integration is worse than no integration — approvals would look pushed
when they were not.

### Step 7: Install the trigger

Run `setupTrigger()`. It refuses to run until `workspaceGid` and `projectGid`
are set, and it replaces any previous copy of itself rather than stacking
duplicates.

### Step 8: Test end to end

Pick a pending row, set column J to `Approved`, and within a few seconds the
`Asana Task` column should hold a link. Open it and check the description.

To re-test the same row, clear its `Asana Task` cell and re-enter the approval.

---

## Behaviour

| Situation | What happens |
|---|---|
| J set to `Approved` | Task created, URL written back to the row |
| J set to `Rejected` | Nothing — deliberate; 3 rows so far, not worth the noise |
| J edited to `Approved` twice | Second edit skipped; the existing URL is the guard |
| Several rows approved by fill-down or paste | Every touched row processed, not just the first |
| Two people approving at once | Serialised by `LockService`, so no double-creation |
| Asana call fails | `ERROR: …` written into the `Asana Task` cell, email sent, other rows unaffected |
| Requester has no Asana account | Task still created; the follower step fails quietly |
| Routed owner is not an Asana user | Task created unassigned, warning in the description, email sent |

### Task shape

```
Title     PR-2026-1515 · DC motor for Operation Station Turntable POC
Assignee  by routing rule -- see below
Follower  requester, if their email matches an Asana user
Due       approval date + urgency allowance
Notes:
  Requester:         harini@origin.tech
  Item:              DC motor for Operation Station Turntable POC
  Quantity:          1
  Part / model no.:  24V/12RPM
  Urgency:           High (Needed within 2-3 day)
  Preferred vendor:  -

  Justification
  -------------
  Need urgently for POC of turntable

  Link
  ----
  https://thinkrobotics.com/products/37mm-encoder-dc-metal-gearmotors...

  ---
  Routed to abish@origin.tech - default route (Electronics and everything else).
  Created automatically from the Purchase Request form on approval.
```

`Link` sits in its own block rather than the aligned column because some of
these URLs run to several hundred characters. `Justification` is included on top
of the seven requested fields -- it is filled on 78 of 78 rows and is the only
field that says *why* the item is needed. Drop the `justification` lines in
`buildNotes_` if you want strictly the seven.

The routing footer is there so a mis-assignment can be diagnosed from the ticket
itself rather than by re-reading the sheet.

### Routing

Rules are applied in order, first match wins, from `CFG.routingRules`:

| # | Condition | Owner |
|---|---|---|
| 1 | `Item Type` starts with `Fabrication` | kiran@origin.tech |
| 2 | `Product Main Category` starts with `General` | syed@origin.tech |
| 3 | everything else | abish@origin.tech |

Order is the precedence: a fabricated G&A item goes to Kiran, not Syed. Matching
is case-insensitive on the start of the value, so `Fabrication (sheet metal)`
matches rule 1 and both `General & Administrative` and `General & Admin` match
rule 2.

> **Rule 1 currently matches nothing.** `Item Type` is blank on 76 of the 78
> existing rows, and its only two values ever recorded are `TATA Brewer` and
> `Off the shelf (OTS)` — `Fabrication` has never appeared. Until the form
> captures it, Kiran receives no tickets and fabrication work routes to Abish by
> default. Fixing this means adding `Item Type` as a required question on the
> Google Form with a `Fabrication` option; no code change is needed once it is
> populated.

On the 78 existing rows the rules distribute as **Syed 12, Abish 66, Kiran 0**.

If a routing address does not match an Asana user, the task is still created but
left unassigned, with a warning in its description and an email to
`CFG.errorNotifyEmail`.

Due date allowances, from `CFG.dueDaysByUrgency`:

| Urgency | Due |
|---|---|
| `Critical (Required within 24 hours)` | +1 day |
| `High (Needed within 2–3 day)` | +3 days |
| `Normal ( Need within a week)` | +7 days |
| `Planned (Part of future project / inventory stock)` | +30 days |

Matching is on the leading word, so the exact parenthetical wording can change
without touching the code.

---

## Backfilling

57 rows are already approved. `backfillApproved()` is deliberately not wired to
any trigger — dropping the whole backlog onto a new board buries it. If you do
want some of it, run it in batches from the editor:

```js
backfillApproved(10)   // oldest 10 approved rows without a task
```

It sleeps between calls to stay inside Asana's rate limit, and skips anything
that already has a URL, so re-running is safe.

---

## Known data issues

Surfaced while analysing the 78 existing responses. None block the integration,
but they will show up in the tasks it creates:

- **`Price (INR)` is filled on 1 of 78 rows.** Tasks will mostly have no cost.
  This is the single highest-value form change — without it there is no tiered
  approval, no budget control and no spend reporting.
- **`Item Type` is filled on 2 of 78 rows.** This is the routing key for rule 1,
  so Kiran gets nothing until it is captured on the form. See
  [Routing](#routing).
- **`Team` contains `Brewer Enterprise`** on one row, which is a vendor name in
  the team field.
- **Three columns are named some case of `Lead Time`.** Header lookup takes the
  first match; the integration does not read them, but they should be deduped.
- **`Order ID`, `Delivery Date`, `ETA` are empty on all 78 rows.** Zoho owns
  these natively — populate them by integration rather than by hand.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `ASANA_PAT is not set in Script Properties` | Property missing or misspelled |
| `Asana 401` | Token truncated on copy, or revoked |
| `Asana 403` | Token's owner lacks access to that project |
| `Asana 404` on `/tasks` | `CFG.projectGid` wrong — re-run `discover()` |
| `Asana 400 … custom_fields` | A GID in `customFieldGids` is not on this project, or a dropdown has no matching option for the sheet's value |
| Nothing happens on approval | Trigger not installed (`setupTrigger()`), or the tab is not named `Form responses 1` |
| `Could not find the approval column` | J1 was renamed — add the new name to the front of `CFG.approvalHeaders`. The error message lists the current headers. |
| Works from the editor, not on edit | Simple instead of installable trigger — `setupTrigger()` creates the right kind |

Execution logs are under **Executions** in the Apps Script editor; failed
`onApprovalEdit` runs are listed there with the full error.
