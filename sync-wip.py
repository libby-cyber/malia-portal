#!/usr/bin/env python3
"""
WIP sync for Malia Mills portal.
Pulls live WIP sheets from Google, rebuilds data/wip.json, commits + pushes.
Vercel redeploys automatically on push.
Run via cron. Exits quietly if nothing changed.
"""
import json, subprocess, csv, os, sys
from collections import defaultdict
from datetime import datetime, timezone

REPO = os.path.dirname(os.path.abspath(__file__))
DATA_OUT = os.path.join(REPO, "data", "wip.json")

WIP_SHEETS = [
    ("1RCF4kti3VzU4dTTJfJPvb_XWKrkBALNFca7h6yYCf6s", "WIP Swim 2026.csv"),
    ("17phsWftgyGC_WwoBB4CH9dqS4Xg3xD6QbmGe33nEzFg", "WIP Swim 2025.csv"),
]

def sheets_get(sid, rng):
    cmd = ["hatch_gws_cli", "sheets", "spreadsheets", "values", "get",
           "--params", json.dumps({"spreadsheetId": sid, "range": rng})]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return json.loads(r.stdout).get("values", [])
    except Exception:
        return []

def main():
    # Dedupe by (PO, PLU) across sheets
    seen = {}
    for sid, tab in WIP_SHEETS:
        vals = sheets_get(sid, f"'{tab}'!A2:Q8000")
        for r in vals:
            if len(r) < 11 or not r[1]:
                continue
            key = (r[2], r[4])  # PO + PLU
            def num(x):
                try: return int((x or "0").replace(",", "").strip())
                except: return 0
            row = {
                "order_date": r[1], "po": r[2], "status": r[3], "plu": r[4],
                "style": r[5], "color": r[6], "size": r[7],
                "oh": num(r[8]), "received": num(r[9]), "on_order": num(r[10]),
            }
            if key not in seen:
                seen[key] = row

    # Monthly received totals (for capacity tracking)
    by_month = defaultdict(int)
    for row in seen.values():
        if row["order_date"]:
            by_month[row["order_date"][:7]] += row["received"]

    payload = {
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "row_count": len(seen),
        "rows": list(seen.values()),
        "received_by_month": dict(sorted(by_month.items())),
    }

    os.makedirs(os.path.dirname(DATA_OUT), exist_ok=True)
    new_json = json.dumps(payload, separators=(",", ":"))

    old_json = None
    if os.path.exists(DATA_OUT):
        with open(DATA_OUT) as f:
            old_json = f.read()

    # Compare ignoring synced_at
    def strip_ts(j):
        d = json.loads(j); d.pop("synced_at", None); return json.dumps(d, separators=(",", ":"))
    if old_json and strip_ts(old_json) == strip_ts(new_json):
        print("No WIP changes.")
        return

    with open(DATA_OUT, "w") as f:
        f.write(new_json)

    # Commit + push
    subprocess.run(["git", "add", "data/wip.json"], cwd=REPO, check=True)
    r = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=REPO)
    if r.returncode != 0:
        subprocess.run(["git", "commit", "-m", f"WIP sync {datetime.now(timezone.utc):%Y-%m-%d %H:%M}Z"],
                       cwd=REPO, check=True)
        pr = subprocess.run(["git", "push"], cwd=REPO, capture_output=True, text=True)
        if pr.returncode != 0:
            print("Push failed (remote may not exist yet):", pr.stderr[:300], file=sys.stderr)
            # Roll back the commit so we don't stack up unpushed commits
            subprocess.run(["git", "reset", "--soft", "HEAD~1"], cwd=REPO)
        else:
            print(f"Pushed WIP sync: {len(seen)} rows.")
    else:
        print("No changes to commit.")

if __name__ == "__main__":
    main()
