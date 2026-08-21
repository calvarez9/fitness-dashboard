#!/usr/bin/env python3
"""
One-time Boostcamp history import -> Supabase.

Boostcamp has no official export/API. You get the data by copying the
`history` request's JSON response out of Chrome DevTools (Network tab)
into a local file — see the walkthrough. This script reads that file and
maps it onto the same fitlog_workouts / fitlog_sets tables the FitLog
importer uses, so it shows up in the dashboard exactly the same way.

Mapping notes (see the data exploration that produced these rules):
  - Each Boostcamp workout -> one fitlog_workouts row (id prefixed
    "bc_" so it can never collide with a FitLog id). type is hardcoded
    'strength' since every workout in this export is strength-focused.
  - Each exercise's sets -> fitlog_sets rows. "amount" = reps,
    "value" = weight (all confirmed lbs in this export).
  - A set is skipped (not imported) if it's an unfilled template
    placeholder (value AND amount both "") or if Boostcamp's own
    "skipped": true flag is set — neither was actually performed.
  - 5 sets are time-based (e.g. planks) rather than reps+weight;
    fitlog_sets has no duration column, so those import with
    reps/weight left blank. Nothing is discarded — the full raw
    workout JSON (including these sets) is kept in fitlog_workouts.raw.

Usage:
  export SUPABASE_URL=https://xxxx.supabase.co
  export SUPABASE_SERVICE_KEY=...   # service_role key, same one garmin_sync.py uses
  python3 import_boostcamp.py [path/to/boostcamp_export.json]
"""
import os
import sys
import json
import datetime as dt
from zoneinfo import ZoneInfo

import requests

# Boostcamp's `finished_at` is a naive local timestamp with no timezone
# marker (e.g. "2026-08-20 19:17:28") -- confirmed by cross-referencing
# against real Garmin activity times, which land squarely inside a
# matching Garmin session once this offset is applied. Storing it as-is
# into a timestamptz column silently mis-tags it as UTC, off by several
# hours. Convert it to real UTC before it goes anywhere near the database.
LOCAL_TZ = ZoneInfo("America/Puerto_Rico")


def local_to_utc_iso(naive_str):
    if not naive_str:
        return naive_str
    naive = dt.datetime.strptime(naive_str, "%Y-%m-%d %H:%M:%S")
    local = naive.replace(tzinfo=LOCAL_TZ)
    return local.astimezone(dt.UTC).isoformat()

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}


def upsert(table, rows, on_conflict):
    if not rows:
        return
    url = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={on_conflict}"
    headers = {**HEADERS, "Prefer": "resolution=merge-duplicates"}
    r = requests.post(url, headers=headers, json=rows, timeout=30)
    if not r.ok:
        print(f"  ! upsert into {table} failed: {r.status_code} {r.text[:300]}", file=sys.stderr)
    r.raise_for_status()


def delete_sets_for(workout_ids):
    """Delete any existing fitlog_sets for these workout ids first, so
    re-running this script doesn't pile up duplicate sets (fitlog_sets
    has no natural unique key to upsert on)."""
    if not workout_ids:
        return
    ids_csv = ",".join(workout_ids)
    url = f"{SUPABASE_URL}/rest/v1/fitlog_sets?workout_id=in.({ids_csv})"
    r = requests.delete(url, headers=HEADERS, timeout=30)
    r.raise_for_status()


def is_real_set(s):
    if s.get("skipped"):
        return False
    if (s.get("value", "") == "") and (s.get("amount", "") == ""):
        return False
    return True


def to_number(x):
    if x is None or x == "":
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "boostcamp_export.json"
    with open(path) as f:
        payload = json.load(f)

    by_date = payload.get("data", {})

    workout_rows = []
    set_rows_by_workout = {}
    skipped_time_based = 0

    for _date_key, workouts in by_date.items():
        for w in workouts:
            wid = f"bc_{w['id']}"
            workout_rows.append(
                {
                    "id": wid,
                    "date": local_to_utc_iso(w.get("finished_at")),
                    "name": w.get("title") or w.get("name"),
                    "type": "strength",
                    "raw": w,
                }
            )

            sets_for_this = []
            for rec in w.get("records", []):
                exercise_name = rec.get("name")
                idx = 0
                for s in rec.get("sets", []):
                    if not is_real_set(s):
                        continue
                    idx += 1
                    target_type = s.get("target_type")
                    if target_type == "time":
                        reps = None
                        weight = None
                        skipped_time_based += 1
                    else:
                        reps = to_number(s.get("amount"))
                        weight = to_number(s.get("value"))
                        if reps is not None:
                            reps = int(reps)
                    sets_for_this.append(
                        {
                            "workout_id": wid,
                            "exercise_name": exercise_name,
                            "set_index": idx,
                            "reps": reps,
                            "weight": weight,
                            "rpe": None,
                            "is_warmup": False,
                            "done": True,
                        }
                    )
            set_rows_by_workout[wid] = sets_for_this

    print(f"Parsed {len(workout_rows)} workouts, "
          f"{sum(len(v) for v in set_rows_by_workout.values())} sets "
          f"({skipped_time_based} time-based sets imported without reps/weight).")

    workout_ids = [w["id"] for w in workout_rows]
    print("Clearing any previously-imported sets for these workouts (safe to re-run)...")
    delete_sets_for(workout_ids)

    print("Upserting workouts...")
    upsert("fitlog_workouts", workout_rows, on_conflict="id")

    all_sets = [s for rows in set_rows_by_workout.values() for s in rows]
    print("Inserting sets...")
    # fitlog_sets.id is a bigserial (no natural conflict key), so this is
    # a plain insert -- the delete step above is what makes re-runs safe.
    url = f"{SUPABASE_URL}/rest/v1/fitlog_sets"
    r = requests.post(url, headers=HEADERS, json=all_sets, timeout=30)
    if not r.ok:
        print(f"  ! insert into fitlog_sets failed: {r.status_code} {r.text[:300]}", file=sys.stderr)
    r.raise_for_status()

    print(f"Done. Imported {len(workout_rows)} workouts / {len(all_sets)} sets.")


if __name__ == "__main__":
    main()
