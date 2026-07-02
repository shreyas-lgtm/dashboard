# IT Asset Management — Standard Operating Procedure

**Owner:** Shreyas (IT Assets) · **Applies to:** end-user computing equipment only — laptops/CPUs, monitors, keyboards, mice, GPUs. (Cameras, compute modules, R&D dev hardware and tools are tracked in their own inventories, not here.)

The goal of this SOP is that **anyone** can run IT asset tracking by following it — no tribal knowledge required. There is exactly **one source of truth: the IT Asset Register** (`clean-register.csv`, maintained as a Google Sheet). If it isn't in the register, it doesn't exist.

---

## 0. The one rule

> **Every asset always has a `Status` and, if `In Use`, exactly one named `Assigned To (Holder)`.**
> Update the register *at the moment* an asset changes hands or state — not "later".

That single habit is what keeps the sheet trustworthy. Everything below is just the detail.

---

## 1. Roles

| Role | Who | Responsibility |
|------|-----|----------------|
| **Asset Owner** | Shreyas | Owns the register, runs the monthly audit, approves write-offs. |
| **Asset Custodian** | Whoever is handed this SOP | Day-to-day: logs intake, assigns, collects on exit, updates the sheet. |
| **Employee** | Anyone issued an asset | Responsible for the asset while assigned; returns it on exit or role change. |
| **Manager / HR** | Reporting + HR | Triggers the offboarding handshake (see §5). |

If one person does all of Owner + Custodian, that's fine — the roles just name the hats.

---

## 2. Asset lifecycle at a glance

```
   INTAKE            ASSIGNMENT           IN SERVICE            RETURN            END OF LIFE
  ─────────         ────────────         ────────────         ────────         ─────────────
  New asset   →     Give to a      →     Person uses it  →    Person leaves →   Retire / write-off
  arrives           person or                                 or swaps
  Log it            keep as spare        (repairs, moves)     Collect it back   Remove from active
                                                                                use
  Status:           Status:              Status:              Status:           Status:
  In Storage        In Use               In Use / Deployed    Available or      Retired
  or Available                                                In Storage
```

Every asset is always in exactly one **Status**:

| Status | Meaning |
|--------|---------|
| `In Storage` | Boxed/stored, not allocated to anyone. |
| `Available` | Spare, ready to hand out immediately. |
| `In Use` | Held by a named person (`Assigned To` filled). |
| `Deployed` | Installed on a robot/system/setup, not a person. |
| `In Repair` | Out for service. |
| `Damaged` | Broken, awaiting decision. |
| `Retired` | End of life — kept for history, not in active use. |
| `Lost` | Unaccounted for after investigation. |

---

## 3. Intake — an asset comes in

When a new device arrives (purchase, replacement, return-to-stock):

1. **Add one row** to the register. One physical item = one row.
2. Fill in:
   - **Asset Tag** — next number in the `IT-####` series (e.g. `IT-0097`). Never reuse a tag.
   - **Item**, **Category** (pick from the dropdown), **Serial No.**, **Model No.**
   - **Unit Value / Tax / Total** — from the invoice. Don't leave cost blank; put `0` only if genuinely free.
   - **Date Received** — today.
   - **Status** — `In Storage` (if boxed) or `Available` (if ready to hand out).
   - **Condition** — usually `New`.
3. **Physically label** the device with its Asset Tag (sticker/tape). The tag on the device must match the sheet.

> Rule of thumb: an asset is not "received" until it has a row **and** a physical label.

---

## 4. Assignment — an asset is given to someone

1. Find the asset's row (search by Asset Tag or Serial No.).
2. Set:
   - **Status** → `In Use`
   - **Assigned To (Holder)** → the person's full name (as in HR). One name only.
   - **Team / Location** → their team/desk (from the dropdown).
   - **Date Assigned** → today.
   - Clear **Date Returned** if it was set from a previous holder.
3. If it's going onto a robot/rig instead of a person, set **Status** → `Deployed` and put the system name in **Assigned To (Holder)** (e.g. "Robot", "Simulation").

**Bundles (laptop + charger + mouse):** each item keeps its own row and its own Asset Tag. To keep a person's kit together, assign them all to the same **Holder** — filtering the sheet by name then shows everything they hold. (This is what makes offboarding a one-filter operation.)

---

## 5. Return / Offboarding — an employee leaves or swaps roles ⭐

This is the process that most often breaks. Keep it a **hard handshake between HR and the Custodian.**

**Trigger:** HR/Manager notifies the Custodian of a departure (ideally ≥ 2 days before last working day).

**Step-by-step:**

1. **Generate the person's asset list.** In the register, filter **Assigned To (Holder) = <name>**. Every row that appears must be physically collected. Copy this list into an *Asset Return Form* (template in §8) — this becomes the checklist.
2. **Collect each item.** For every row:
   - Confirm the physical Asset Tag matches the sheet.
   - Inspect condition. Note any damage.
3. **Update the register** for each returned item:
   - **Status** → `Available` (reusable) / `In Storage` (boxed) / `In Repair` / `Damaged`.
   - **Assigned To (Holder)** → **clear it** (blank).
   - **Date Returned** → today.
   - **Condition** → update if changed; add a **Note** if damaged.
4. **Anything not returned** stays `In Use` under that person and is flagged to Manager/HR. **HR does not release final settlement until the person's asset list is empty** (Status ≠ In Use for every row). This single gate is what stops assets walking out the door.
5. **Sign-off.** Employee and Custodian both sign the Asset Return Form; file it (Drive folder / attach to the row's Notes).

> The reverse of §4: assignment fills Holder + Date Assigned; return clears Holder + sets Date Returned. Symmetry makes it easy to remember.

---

## 6. In-service changes

- **Repair:** Status → `In Repair`, add a Note with the date/vendor. On return, Status → back to `In Use`/`Available`.
- **Reassign (person A → person B):** run the §5 return for A, then the §4 assignment for B. Don't just overwrite the name — that loses history.
- **Move location only:** update **Team / Location**; leave Holder/Status.
- **Damage:** Status → `Damaged`, Condition → `Damaged`, Note what happened and who.

---

## 7. Retire / write-off

1. Asset Owner approves.
2. Status → `Retired` (or `Lost` after investigation). **Keep the row** — never delete history.
3. Add a Note: date, reason, disposal method.

---

## 8. Templates

### Asset Return Form (offboarding checklist)

```
Employee: ____________________   Team: __________   Last working day: __________
Custodian: ___________________   Date of collection: __________

| Asset Tag | Item            | Serial No. | Returned? (Y/N) | Condition on return | Notes        |
|-----------|-----------------|------------|-----------------|---------------------|--------------|
| IT-0021   | Lenovo LOQ      | MP2RTXLT   |                 |                     |              |
| ...       | (from filter)   |            |                 |                     |              |

All items returned:  ☐ Yes   ☐ No (list outstanding + flag to HR)

Employee signature: ______________    Custodian signature: ______________
```

### Intake row checklist

```
☐ Asset Tag assigned (next in series, not reused)
☐ Item / Category / Serial / Model filled
☐ Unit Value + Tax + Total from invoice
☐ Date Received = today
☐ Status = In Storage or Available
☐ Physical label matches the tag
```

---

## 9. Monthly audit (30 minutes, keeps the sheet honest)

Once a month the Asset Owner:

1. **Spot-check** ~10 rows: does the physical device (tag, location, holder) match the sheet?
2. **Review exceptions** using the register's dashboard/filters:
   - `In Use` rows where the holder no longer works here → should have been returned.
   - Blank `Serial No.` on laptops/monitors → fill in.
   - Blank `Unit Value` → backfill from invoice.
   - `In Repair` older than 30 days → chase.
3. **Reconcile** the total asset value against finance if required.
4. Note the audit date in the register's header.

---

## 10. Quick reference

| Situation | Do this |
|-----------|---------|
| New device arrives | §3 Intake — add row, label it |
| Give to a person | §4 — Status `In Use`, set Holder + Date Assigned |
| Person leaving | §5 — filter by name, collect all, clear Holder, set Date Returned; HR gate on empty list |
| Reassign A→B | Return from A, then assign to B |
| Sent for repair | Status `In Repair` + Note |
| Broken | Status `Damaged` + Note |
| End of life | Owner approves → Status `Retired`, keep the row |
| Monthly | 30-min audit (§9) |
