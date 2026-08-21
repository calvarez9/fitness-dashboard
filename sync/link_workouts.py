#!/usr/bin/env python3
"""
Link fitlog_workouts (FitLog / Boostcamp) to the garmin_activities recorded
during the same real-world session, so the dashboard can show one merged
workout instead of two separate entries.

Two matching modes, depending on what timing data the fitlog_workouts row
actually has:

  - "overlap": the workout has both started_at and a finish (date) --
    i.e. a real [start, finish] interval, currently only true for FitLog
    entries logged after js/app.js started recording start times.
    Confidence = fraction of the *logged session's* duration that falls
    inside the Garmin activity's interval. Threshold: 90% by default,
    matching how tight a real match should be.

  - "contained": only a single finish timestamp is available (every
    Boostcamp workout, and older FitLog entries from before started_at
    existed). There's no second point to compute a true overlap
    fraction from, so this just checks whether that timestamp falls
    inside the Garmin activity's interval, padded by a small grace
    window (people don't hit "finish" in two apps at the exact same
    second). Confidence is fixed at 1.0 for these.

Safe to re-run: existing links are left alone (upsert on the
(garmin_activity_id, fitlog_workout_id) primary key), and a workout that
no longer qualifies simply isn't re-inserted -- it doesn't delete prior
links, so run --reset first if you want a clean recompute.

Usage:
  export SUPABASE_URL=https://xxxx.supabase.co
  export SUPABASE_SERVICE_KEY=...
  python3 link_workouts.py [--overlap-threshold 0.9] [--grace-min 15] [--reset]
"""
import os
import sys
import argparse
import datetime as dt

import requests

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}


def get(path):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()


def parse_ts(s):
    if not s:
        return None
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def run_linking(overlap_threshold=0.9, grace_min=15, reset=False):
    """Callable version of the CLI below -- garmin_sync.py imports this to
    relink automatically after every real sync, instead of requiring a
    separate manual run."""
    grace = dt.timedelta(minutes=grace_min)

    if reset:
        r = requests.delete(
            f"{SUPABASE_URL}/rest/v1/workout_links?garmin_activity_id=gt.0",
            headers=HEADERS,
            timeout=30,
        )
        r.raise_for_status()
        print("Cleared existing links.")

    activities = get("garmin_activities?select=id,start_time,duration_seconds")
    workouts = get("fitlog_workouts?select=id,date,started_at,duration_min")
    existing = get("workout_links?select=garmin_activity_id,fitlog_workout_id")
    existing_pairs = {(l["garmin_activity_id"], l["fitlog_workout_id"]) for l in existing}

    ga_intervals = []
    for a in activities:
        start = parse_ts(a["start_time"])
        if not start:
            continue
        end = start + dt.timedelta(seconds=a["duration_seconds"] or 0)
        ga_intervals.append({"id": a["id"], "start": start, "end": end})

    new_links = []
    unmatched = []
    for w in workouts:
        finish = parse_ts(w["date"])
        if not finish:
            continue
        start = parse_ts(w["started_at"])

        best = None  # (confidence, match_type, garmin_activity_id)
        for a in ga_intervals:
            if start:
                # Real interval on both sides -- coverage-based overlap.
                fw_duration = (finish - start).total_seconds()
                if fw_duration <= 0:
                    continue
                overlap_start = max(start, a["start"])
                overlap_end = min(finish, a["end"])
                overlap = (overlap_end - overlap_start).total_seconds()
                if overlap <= 0:
                    continue
                confidence = min(1.0, overlap / fw_duration)
                if confidence >= overlap_threshold:
                    if not best or confidence > best[0]:
                        best = (confidence, "overlap", a["id"])
            else:
                # Point-in-time only -- containment against a grace-padded window.
                if a["start"] - grace <= finish <= a["end"] + grace:
                    if not best or best[1] != "overlap":
                        best = (1.0, "contained", a["id"])

        if best:
            confidence, match_type, ga_id = best
            pair = (ga_id, w["id"])
            if pair not in existing_pairs:
                new_links.append({
                    "garmin_activity_id": ga_id,
                    "fitlog_workout_id": w["id"],
                    "match_type": match_type,
                    "confidence": round(confidence, 3),
                })
        else:
            unmatched.append(w["id"])

    # A Garmin activity should represent at most one fitlog_workout -- if two
    # workouts both matched the same activity, keep only the higher-confidence one.
    best_per_activity = {}
    for link in new_links:
        ga_id = link["garmin_activity_id"]
        if ga_id not in best_per_activity or link["confidence"] > best_per_activity[ga_id]["confidence"]:
            best_per_activity[ga_id] = link
    deduped = list(best_per_activity.values())

    if deduped:
        r = requests.post(
            f"{SUPABASE_URL}/rest/v1/workout_links?on_conflict=garmin_activity_id,fitlog_workout_id",
            headers={**HEADERS, "Prefer": "resolution=merge-duplicates"},
            json=deduped,
            timeout=30,
        )
        if not r.ok:
            print(f"  ! insert failed: {r.status_code} {r.text[:300]}", file=sys.stderr)
        r.raise_for_status()

    print(f"Linked {len(deduped)} new pair(s) ({len(new_links) - len(deduped)} dropped as duplicate-activity conflicts).")
    print(f"{len(unmatched)} workout(s) had no matching Garmin activity.")
    return len(deduped), len(unmatched)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--overlap-threshold", type=float, default=0.9)
    parser.add_argument("--grace-min", type=float, default=15)
    parser.add_argument("--reset", action="store_true", help="Delete all existing links before recomputing")
    args = parser.parse_args()
    run_linking(overlap_threshold=args.overlap_threshold, grace_min=args.grace_min, reset=args.reset)


if __name__ == "__main__":
    main()
