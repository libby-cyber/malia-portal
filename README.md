# Malia Mills — Production Planning Portal

Standalone, Vercel-deployable planning portal for the Malia Mills swim team.
Plain HTML/CSS/JS, no build step, no framework. Data is baked in as JSON.

## What's inside

- **Seasonal plan** — 3-drop color rotation calendar (Dec / Spring / Summer), editable
  assumptions, line sheet allocator with affinity-based style recommendations,
  recut hole analysis, and a schedule tracker (planned vs. actual receipts).
- **Black replenishment** — separate lean track, size-level OH / velocity / reorder.
- **Fix inventory now** — high velocity w/ cover, projected sell-outs, broken-affinity
  transfers, hidden winners (censored demand).
- **Calendar** — 12-month view of fabric orders, sewing launches, in-store, handoff, sell-out.

Key business rules baked in: sample-sale colors/locations excluded everywhere,
Web/Trunk = demand only (no inventory), Bridgehampton closed, black on its own
track, 70% default sell-through, year-over-year seasonal velocity, ~1,000 u/mo
factory capacity, manual unit entries always win over recalculations.

## Data

`data/*.json` — pre-aggregated from Drive sources on 2026-10-05
(inventory snapshot 10:41 AM ET). To refresh: re-run the aggregation against
fresh exports and replace the JSON files, then redeploy.

User inputs (assumption edits, unit overrides, assigned colorways, tracker
actuals) persist in `localStorage` per browser. See `js/store.js` for the
documented swap-in points to move team-shared state to Supabase.

## Deploy to Vercel (2 minutes)

**Option A — GitHub import (recommended)**
1. Push this folder to a GitHub repo:
   ```bash
   cd portal-deploy
   git init && git add . && git commit -m "portal v1"
   git branch -M main && git remote add origin https://github.com/YOURNAME/malia-portal.git
   git push -u origin main
   ```
2. Go to vercel.com → Add New → Project → Import the repo.
3. Framework preset: **Other**. No build command, no output directory (defaults work).
4. Deploy. You get a `https://malia-portal.vercel.app` URL for the team.

**Option B — Vercel CLI**
```bash
npm i -g vercel
cd portal-deploy && vercel deploy --prod
```

## Local preview

```bash
cd portal-deploy
python3 -m http.server 8080
# open http://localhost:8080
```
(Browsers block `fetch()` on `file://`, so serve over http.)

## Updating data later

1. Export fresh CSVs from Drive (inventory snapshot, sales).
2. Re-run aggregation (script used: kept with the parent agent's notes).
3. Replace `data/*.json`, commit, push — Vercel redeploys automatically.
