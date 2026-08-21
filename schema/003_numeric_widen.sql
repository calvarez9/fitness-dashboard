-- ============================================================
-- Garmin's API returns some daily/activity metrics as floats
-- (e.g. "170.0") where these were typed as int. Widen to numeric
-- so nothing gets rejected on insert. Run after 001 + 002.
-- ============================================================

alter table garmin_daily_stats
  alter column resting_hr type numeric,
  alter column avg_stress type numeric,
  alter column max_stress type numeric,
  alter column body_battery_high type numeric,
  alter column body_battery_low type numeric,
  alter column steps type numeric,
  alter column steps_goal type numeric,
  alter column floors_climbed type numeric,
  alter column intensity_minutes type numeric,
  alter column sleep_seconds type numeric,
  alter column deep_sleep_seconds type numeric,
  alter column light_sleep_seconds type numeric,
  alter column rem_sleep_seconds type numeric,
  alter column awake_seconds type numeric,
  alter column sleep_score type numeric,
  alter column calories_total type numeric;

alter table garmin_activities
  alter column avg_hr type numeric,
  alter column max_hr type numeric;
