-- ============================================================
-- Fix: service_role bypasses RLS but still needs base table
-- privileges — Postgres GRANTs and RLS are separate systems.
-- Run this after 001_init.sql.
-- ============================================================

grant usage on schema public to service_role, authenticated;

grant select, insert, update, delete on
  garmin_daily_stats,
  garmin_activities,
  fitlog_workouts,
  fitlog_sets,
  fitlog_cardio_segments,
  sync_state
to service_role;

grant select on
  garmin_daily_stats,
  garmin_activities,
  fitlog_workouts,
  fitlog_sets,
  fitlog_cardio_segments
to authenticated;

-- bigserial id columns (fitlog_sets, fitlog_cardio_segments) need
-- sequence privileges too, or inserts without an explicit id will fail.
grant usage, select on all sequences in schema public to service_role;
