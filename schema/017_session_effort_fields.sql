-- ============================================================
-- Session-level effort/back tracking, plus a real gym_location column.
--
-- back_pre / back_post: 0-10 self-rated back symptom, before and after a
-- session. session_rpe: 0-10 overall session effort (distinct from a
-- per-set RPE). session_load = session_rpe * duration_min is deliberately
-- NOT a column here -- it's derived at display time everywhere it's
-- shown, since session_rpe stays editable after the fact and a stored
-- product would go stale the moment it's edited.
--
-- gym_location: there's already a "location" concept in FitLog (see
-- js/db.js's getLocations()/saveLocations(), used today to disambiguate
-- cable-machine PRs) that has never been synced as a real column -- only
-- ever captured inside fitlog_workouts.raw. This gives it one, so
-- equipment-driven jumps (different gym, different cable stack) can be
-- told apart from real progress in the dashboard.
--
-- No range check constraints, matching every other 0-10-ish numeric
-- column in this schema (resting_hr, avg_stress, etc.) -- validation
-- stays UI-level.
-- ============================================================
alter table fitlog_workouts add column if not exists back_pre numeric;
alter table fitlog_workouts add column if not exists back_post numeric;
alter table fitlog_workouts add column if not exists session_rpe numeric;
alter table fitlog_workouts add column if not exists gym_location text;
