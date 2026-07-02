# IT Assets — One-Page Cheat Sheet

Everything you need to run IT assets day to day. Full detail is in the [SOP](./IT-Asset-Management-SOP.md); you rarely need it.

> **The only rule:** every asset always has a **Status**. If Status = `In Use`, it has exactly **one named Holder**. Update the sheet *the moment* an asset changes hands.

---

## The 3 daily moves

**① New asset arrives → INTAKE**
- Add one row. Fill: Asset Tag (next `IT-####`), Item, Category, Serial, Model, cost from invoice.
- **Date Received** = today · **Status** = `In Storage` or `Available`.
- Stick the Asset Tag on the device.

**② Give it to someone → ASSIGN**
- **Status** → `In Use` · **Assigned To** → their full name · **Date Assigned** → today · **Team/Location** → their desk.
- (Going on a robot/rig instead of a person? Status → `Deployed`, Holder → the system name.)

**③ Person leaves / hands it back → RETURN**
- **Status** → `Available` / `In Storage` / `In Repair` / `Damaged`.
- **Clear** Assigned To · **Date Returned** → today · note any damage.

That's the whole job. Reassigning A→B = do ③ for A, then ② for B.

---

## Offboarding checklist (when someone leaves) ⭐

1. Filter the register by **Assigned To = their name** → that list is everything to collect.
2. Collect each item; check the tag matches.
3. For each: clear Holder, set **Date Returned**, set new Status.
4. **HR does not close the exit until that person's list shows zero `In Use` rows.** ← this is what stops assets walking out.

```
Employee: __________  Last day: ______  Collected by: __________

Asset Tag | Item        | Serial   | Back? | Condition
IT-____   | ___________ | _______  |  Y/N  | _________
(one line per row from the filter)

All returned? ☐ Yes  ☐ No → flag outstanding to HR
```

---

## Status meanings

`In Use` held by a person · `Available` spare, ready to give · `In Storage` boxed · `Deployed` on a robot/rig · `In Repair` at service · `Damaged` broken · `Retired` end of life (keep the row) · `Lost` missing.

## Once a month (15 min)
Spot-check ~10 devices against the sheet · chase any `In Use` held by someone who left · fill blank serials/values the sheet highlights.
