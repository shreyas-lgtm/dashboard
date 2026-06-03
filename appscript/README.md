# Listings Agent — Google Apps Script edition

The always-on version: it lives inside your Google account, reads Gmail on a
schedule (no servers, no OAuth keys to store), scrutinises + ranks each
listing, and writes a colour-coded **Google Sheet** — with a three-way verdict:

- ✅ **Shortlist** — meets every must and scores well
- 🟡 **Worth a look / Weak fit** — meets musts, middling
- ⚠️ **Great, needs a compromise** — fails ONE must but is otherwise excellent
  (e.g. *"Strong otherwise — compromise: 1 bath, under your 2-bath minimum"*)
- 🚫 **Doesn't fit** — fails a must and isn't compelling (the "negate" case)

Tune everything in **`Preferences.gs`**.

## Setup (~3 minutes, once)

### A. Create the project
**Option 1 — paste (simplest):**
1. Go to **script.google.com → New project**.
2. Create files matching this folder and paste each in: `Preferences.gs`,
   `Parser.gs`, `Scoring.gs`, `Code.gs`. Then **Project Settings → check
   "Show appsscript.json"** and paste `appsscript.json`.

**Option 2 — push with [clasp](https://github.com/google/clasp) (keeps it in this git repo):**
```bash
npm i -g @google/clasp
clasp login
cd appscript
clasp create --type standalone --title "Listings Agent"
clasp push
```

### B. Run it
1. In the editor, select **`setup`** → **Run**. Approve the permissions prompt
   (Gmail read-only, Sheets). It creates the spreadsheet — open the URL from
   the execution log (**View → Logs**).
2. Select **`runListingsAgent`** → **Run**. Your inbox listings populate the Sheet.
3. Select **`createTrigger`** → **Run**. It now runs **every 15 minutes**,
   automatically, forever.

### C. (Optional) Slack
Create an [Incoming Webhook](https://api.slack.com/messaging/webhooks), then in
the editor run `setSlackWebhook('https://hooks.slack.com/services/…')` once.
New listings get posted as a ranked digest each run.

## How it behaves
- **Dedupe:** processed message ids are remembered (Script Properties) and the
  Sheet's `Key` column is checked, so re-runs only append genuinely new listings.
- **Your decisions stick:** the `Status` column (New / Shortlist / Pass /
  Contacted) is a dropdown you edit; the agent never overwrites existing rows.
- **No Gmail modification:** scope is read-only; nothing is labelled, moved, or
  deleted.

## Files
| File | Role |
|------|------|
| `Preferences.gs` | Your criteria — budget, beds/baths, area, amenities, weights. |
| `Parser.gs`      | Gmail message → structured listing. |
| `Scoring.gs`     | Scrutinise → flags (must/warn/info), rank, three-way verdict. |
| `Code.gs`        | Gmail fetch, Sheet writing, Slack, triggers, setup. |
| `appsscript.json`| Manifest + OAuth scopes. |

> The logic mirrors the Node agent in `../agent/` (same parsing/scoring), so the
> two stay conceptually in sync — this edition just trades the React UI for a
> Sheet and gains a real, built-in scheduler.
