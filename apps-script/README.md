# Purchase Request Apps Script

`Code.gs` is the container-bound Apps Script for the **Purchase Request form
(Responses)** spreadsheet. It is kept here so changes are reviewable as diffs;
the Apps Script editor remains the deployed copy, so paste changes back after
review.

## Header resolution

The form has been reconfigured more than once and the responses sheet has been
renamed, so nothing in this script matches header text literally. `HEADER_ALIASES`
maps each logical field to the names it has gone by, and `resolveCol_()` resolves
a field to a column — falling back to a punctuation-insensitive comparison so a
header note like `Urgency Level (Standard timeline is 3 weeks)` still matches
`Urgency Level`.

Known renames already covered:

| Logical field | Current header | Previously |
|---|---|---|
| `PR_ID` | `UID` | `PR_ID` |
| `FINAL_APPROVAL` | `Lead Approval` | `Final Approval` |
| `PART_NUMBER` | `Part Number/ Model Number` | `Part Number/Link` |
| sheet tab | `Form_Responses` | `Form responses 1` |

When the form is changed again, **add the new header to the alias list** rather
than editing the literal in `CONFIG.HEADERS` — the aliases are what keep older
copies of the sheet working.

### One thing to confirm

`FINAL_APPROVAL` is the founder decision. Its alias list prefers an explicit
`Founder Approval` / `Final Approval` column and only falls back to
`Lead Approval`, and the Founder Payment report states which column it read at
the end of its alert. If `Lead Approval` is a team-lead sign-off rather than the
founder's, move it to `MANAGER_APPROVAL` and add the real founder column to
`FINAL_APPROVAL`.

## Founder Payment report

`💰 Founder Payment` menu → adds rows to the **Founder Payment Report** sheet,
pulling Sub Category and Amount from **Expense Tracker** when that sheet already
has the PR. A missing Expense Tracker is not an error; those two cells are just
left blank to fill in by hand.
