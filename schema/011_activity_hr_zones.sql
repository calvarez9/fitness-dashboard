-- ============================================================
-- Per-activity time-in-HR-zone (seconds), confirmed present on this
-- account's real Garmin activity payload as hrTimeInZone_1..5 (see
-- sync/garmin_sync.py). Zone 1 = easiest/recovery, Zone 5 = max effort --
-- lets cardio be shown as an intensity distribution instead of one
-- undifferentiated minutes total.
-- ============================================================
alter table garmin_activities add column if not exists hr_zone_1_seconds numeric;
alter table garmin_activities add column if not exists hr_zone_2_seconds numeric;
alter table garmin_activities add column if not exists hr_zone_3_seconds numeric;
alter table garmin_activities add column if not exists hr_zone_4_seconds numeric;
alter table garmin_activities add column if not exists hr_zone_5_seconds numeric;
