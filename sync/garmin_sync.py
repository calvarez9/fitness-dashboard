#!/usr/bin/env python3
"""
Garmin Connect -> Supabase sync job.

Reads Garmin Connect credentials from Supabase Vault (via the get_secret
RPC defined in schema/001_init.sql), logs in (reusing a cached session
token when possible so we don't hit the password login path every run),
pulls daily health metrics + recent activities, and upserts them into
Supabase. Every day's full raw API response is also stored in a `raw`
jsonb column, so if a flattened field mapping below turns out to be
wrong for your account, nothing is lost — it can be re-derived later.

Environment variables required:
  SUPABASE_URL          e.g. https://xxxx.supabase.co
  SUPABASE_SERVICE_KEY  the service_role key (server-side only, never expose)

Usage:
  python3 garmin_sync.py                 # incremental: today + last 3 days
  python3 garmin_sync.py --backfill 90   # backfill the last 90 days (paced, slower)
"""
import os
import sys
import time
import argparse
import datetime as dt
import requests
import garminconnect

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}


def rpc(name, payload):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/rpc/{name}", headers=HEADERS, json=payload, timeout=30)
    r.raise_for_status()
    if not r.content:
        return None  # e.g. set_secret returns void -> empty body
    return r.json()


def get_secret(name):
    return rpc("get_secret", {"secret_name": name}) or None


def set_secret(name, value):
    rpc("set_secret", {"secret_name": name, "secret_value": value})


def upsert(table, rows, on_conflict):
    if not rows:
        return
    url = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={on_conflict}"
    headers = {**HEADERS, "Prefer": "resolution=merge-duplicates"}
    r = requests.post(url, headers=headers, json=rows, timeout=30)
    if not r.ok:
        print(f"  ! upsert into {table} failed: {r.status_code} {r.text[:300]}", file=sys.stderr)
    r.raise_for_status()


def login():
    email = get_secret("GARMIN_USERNAME")
    password = get_secret("GARMIN_PASSWORD")
    if not email or not password:
        print(
            "Garmin credentials not found in Vault (GARMIN_USERNAME / GARMIN_PASSWORD missing). "
            "Add them via the SQL Editor first — see the walkthrough for the exact commands.",
            file=sys.stderr,
        )
        sys.exit(1)

    cached_token = get_secret("GARMIN_TOKENSTORE")

    garmin = garminconnect.Garmin(email=email, password=password)
    logged_in = False
    if cached_token:
        try:
            garmin.login(tokenstore=cached_token)
            logged_in = True
            print("  resumed cached session (no fresh password login needed)")
        except Exception as e:
            print(f"  cached session rejected ({e}); falling back to fresh login")

    if not logged_in:
        garmin.login()
        print("  fresh login succeeded")

    # Persist the (possibly refreshed) session so the next run can skip
    # the password login path — this is the main lever we have against
    # Garmin's anti-bot flagging on repeated logins.
    try:
        set_secret("GARMIN_TOKENSTORE", garmin.client.dumps())
    except Exception as e:
        print(f"  warning: could not cache session token for next run: {e}", file=sys.stderr)

    return garmin


def sync_day(garmin, date_str):
    """Pull every daily metric for one date and return a single merged row."""
    row = {"date": date_str}
    raw = {}

    def safe(label, fn):
        try:
            val = fn()
            raw[label] = val
            return val
        except Exception as e:
            print(f"  ! {label} failed for {date_str}: {e}", file=sys.stderr)
            return None

    stats = safe("stats", lambda: garmin.get_stats(date_str)) or {}
    rhr = safe("rhr", lambda: garmin.get_rhr_day(date_str)) or {}
    stress = safe("stress", lambda: garmin.get_stress_data(date_str)) or {}
    sleep = safe("sleep", lambda: garmin.get_sleep_data(date_str)) or {}
    hrv = safe("hrv", lambda: garmin.get_hrv_data(date_str)) or {}
    bb = safe("body_battery", lambda: garmin.get_body_battery(date_str, date_str)) or []

    # NOTE: Garmin's internal API field names are undocumented and can
    # differ slightly by account/device. These are best-effort mappings —
    # the full response is kept in `raw` below so nothing is lost if a
    # field name needs correcting once we see real output.
    row["steps"] = stats.get("totalSteps")
    row["steps_goal"] = stats.get("dailyStepGoal")
    row["floors_climbed"] = stats.get("floorsAscended")
    intensity = (stats.get("moderateIntensityMinutes") or 0) + 2 * (stats.get("vigorousIntensityMinutes") or 0)
    row["intensity_minutes"] = intensity or None
    row["calories_total"] = stats.get("totalKilocalories")
    row["resting_hr"] = stats.get("restingHeartRate") or rhr.get("restingHeartRate")

    row["avg_stress"] = stress.get("avgStressLevel")
    row["max_stress"] = stress.get("maxStressLevel")

    # Always set these keys (even when None) — PostgREST's bulk upsert
    # requires every object in a batch to have identical keys.
    row["body_battery_high"] = None
    row["body_battery_low"] = None
    if bb and isinstance(bb, list) and bb[0].get("bodyBatteryValuesArray"):
        values = [v[1] for v in bb[0]["bodyBatteryValuesArray"] if v and v[1] is not None]
        if values:
            row["body_battery_high"] = max(values)
            row["body_battery_low"] = min(values)

    daily_sleep = (sleep or {}).get("dailySleepDTO", {}) if isinstance(sleep, dict) else {}
    row["sleep_seconds"] = daily_sleep.get("sleepTimeSeconds")
    row["deep_sleep_seconds"] = daily_sleep.get("deepSleepSeconds")
    row["light_sleep_seconds"] = daily_sleep.get("lightSleepSeconds")
    row["rem_sleep_seconds"] = daily_sleep.get("remSleepSeconds")
    row["awake_seconds"] = daily_sleep.get("awakeSleepSeconds")
    scores = daily_sleep.get("sleepScores") or {}
    row["sleep_score"] = (scores.get("overall") or {}).get("value")

    row["avg_hrv"] = (hrv.get("hrvSummary") or {}).get("lastNightAvg") if isinstance(hrv, dict) else None

    row["respiration_avg"] = stats.get("avgWakingRespirationValue")
    row["raw"] = raw
    return row


# Activity names to drop entirely rather than count as cardio -- currently
# just the dog-walk sessions, which aren't meant to represent training
# load. Matched case-insensitively, substring, so "Pauwi Walk", "pauwi
# walk 🐕", etc. all get caught. Add more names here if other low-effort
# GPS-tracked sessions (that Garmin still logs as "activities") show up.
EXCLUDED_ACTIVITY_NAMES = ["pauwi"]


def sync_activities(garmin, limit=20):
    activities = garmin.get_activities(0, limit) or []
    rows = []
    for a in activities:
        name = a.get("activityName") or ""
        if any(x in name.lower() for x in EXCLUDED_ACTIVITY_NAMES):
            continue
        rows.append(
            {
                "id": a.get("activityId"),
                "activity_name": name,
                "activity_type": (a.get("activityType") or {}).get("typeKey"),
                "start_time": a.get("startTimeGMT"),
                "duration_seconds": a.get("duration"),
                "distance_meters": a.get("distance"),
                "avg_hr": a.get("averageHR"),
                "max_hr": a.get("maxHR"),
                "calories": a.get("calories"),
                "elevation_gain_meters": a.get("elevationGain"),
                # Garmin's own aerobic/anaerobic classification (Firstbeat-
                # modeled, 0-5 each) plus its training-load number and the
                # human-readable label ("TEMPO", "BASE", etc) it derives
                # from them -- exact field names are a best guess same as
                # everywhere else in this file; `raw` below is the fallback
                # if any of these turn out to be named differently on a
                # real account.
                "aerobic_training_effect": a.get("aerobicTrainingEffect"),
                "anaerobic_training_effect": a.get("anaerobicTrainingEffect"),
                "training_effect_label": a.get("trainingEffectLabel"),
                "activity_training_load": a.get("activityTrainingLoad"),
                "raw": a,
            }
        )
    return rows


MIN_HOURS_BETWEEN_SYNCS = 11  # launchd checks in every 30 min; this makes it converge on ~2x/day


def hours_since_last_sync():
    """None if we've never synced (or the state row is missing) -> always due."""
    url = f"{SUPABASE_URL}/rest/v1/sync_state?key=eq.last_sync_at&select=value"
    r = requests.get(url, headers=HEADERS, timeout=15)
    r.raise_for_status()
    rows = r.json()
    if not rows:
        return None
    last = dt.datetime.fromisoformat(rows[0]["value"])
    if last.tzinfo is None:
        last = last.replace(tzinfo=dt.UTC)
    return (dt.datetime.now(dt.UTC) - last).total_seconds() / 3600


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--backfill", type=int, default=0, help="Backfill N days of history instead of the usual incremental sync"
    )
    parser.add_argument("--activities-limit", type=int, default=20)
    parser.add_argument("--force", action="store_true", help="Skip the 'not due yet' check (backfill always skips it too)")
    args = parser.parse_args()

    if not args.backfill and not args.force:
        hours = hours_since_last_sync()
        if hours is not None and hours < MIN_HOURS_BETWEEN_SYNCS:
            print(f"Last sync was {hours:.1f}h ago (< {MIN_HOURS_BETWEEN_SYNCS}h) — not due yet, skipping.")
            return

    print("Logging in to Garmin Connect...")
    garmin = login()

    days = args.backfill if args.backfill else 4  # incremental: today + a few days back, in case data lagged
    if args.backfill:
        print(f"Backfilling {days} days (paced ~1 req/sec to stay easy on Garmin's API)...")

    today = dt.date.today()
    batch = []
    total_synced = 0
    BATCH_SIZE = 10  # upsert incrementally so a rate-limit/crash mid-backfill doesn't lose earlier days
    for i in range(days):
        date_str = (today - dt.timedelta(days=i)).isoformat()
        print(f"  syncing {date_str}...")
        batch.append(sync_day(garmin, date_str))
        if len(batch) >= BATCH_SIZE:
            upsert("garmin_daily_stats", batch, on_conflict="date")
            total_synced += len(batch)
            print(f"  (saved {total_synced}/{days} so far)")
            batch = []
        if args.backfill:
            time.sleep(1)

    if batch:
        upsert("garmin_daily_stats", batch, on_conflict="date")
        total_synced += len(batch)

    print(f"Upserted {total_synced} day(s) of health stats.")

    activity_rows = sync_activities(garmin, args.activities_limit)
    upsert("garmin_activities", activity_rows, on_conflict="id")
    print(f"Upserted {len(activity_rows)} activities.")

    upsert("sync_state", [{"key": "last_sync_at", "value": dt.datetime.now(dt.UTC).isoformat()}], on_conflict="key")
    print("Done.")

    print("Linking new activities to logged workouts...")
    try:
        import link_workouts

        link_workouts.run_linking()
    except Exception as e:
        # Never let a linking hiccup fail the sync itself -- the health/
        # activity data above is already safely saved at this point.
        print(f"  ! linking step failed (sync itself still succeeded): {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
