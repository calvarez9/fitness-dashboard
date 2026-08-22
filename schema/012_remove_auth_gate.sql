-- ============================================================
-- Remove the PIN login gate -- explicit, informed choice: this makes
-- every table below readable (and, where a write policy already existed,
-- writable) by anyone with the dashboard's URL, no sign-in of any kind.
-- The dashboard stops calling supabase.auth.signInWithPassword() entirely
-- (see docs/js/app.js) and just queries as the `anon` role from here on --
-- these grants/policy changes are what make that role's requests actually
-- succeed instead of hitting RLS/permission denials everywhere.
--
-- `authenticated` is left in place alongside `anon` on every policy below
-- (not removed) purely so a login could be reintroduced later without
-- re-deriving this file -- it has no effect while nothing ever signs in.
-- ============================================================

-- ---- Base table privileges (mirrors 002/004/005/006/008's `authenticated`
-- grants, added for `anon` too) ----
grant usage on schema public to anon;

grant select on
  garmin_daily_stats,
  garmin_activities,
  fitlog_workouts,
  fitlog_sets,
  fitlog_cardio_segments,
  workout_links,
  sync_state
to anon;

grant insert, update, delete on fitlog_workouts, fitlog_sets, fitlog_cardio_segments to anon;
grant select, insert, update, delete on exercise_overrides to anon;
grant usage, select on all sequences in schema public to anon;

-- ---- Policy roles: add `anon` alongside the existing `authenticated` ----
alter policy "authenticated read" on garmin_daily_stats to anon, authenticated;
alter policy "authenticated read" on garmin_activities to anon, authenticated;
alter policy "authenticated read" on fitlog_workouts to anon, authenticated;
alter policy "authenticated read" on fitlog_sets to anon, authenticated;
alter policy "authenticated read" on fitlog_cardio_segments to anon, authenticated;

alter policy "authenticated write" on fitlog_workouts to anon, authenticated;
alter policy "authenticated update" on fitlog_workouts to anon, authenticated;
alter policy "authenticated delete" on fitlog_workouts to anon, authenticated;
alter policy "authenticated write" on fitlog_sets to anon, authenticated;
alter policy "authenticated delete" on fitlog_sets to anon, authenticated;
alter policy "authenticated write" on fitlog_cardio_segments to anon, authenticated;
alter policy "authenticated delete" on fitlog_cardio_segments to anon, authenticated;

alter policy "authenticated read" on workout_links to anon, authenticated;
alter policy "authenticated read" on sync_state to anon, authenticated;

alter policy "authenticated read" on exercise_overrides to anon, authenticated;
alter policy "authenticated write" on exercise_overrides to anon, authenticated;
alter policy "authenticated update" on exercise_overrides to anon, authenticated;
alter policy "authenticated delete" on exercise_overrides to anon, authenticated;
