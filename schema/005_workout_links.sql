-- ============================================================
-- Link fitlog_workouts (FitLog / Boostcamp) to the garmin_activities
-- recorded during the same real-world session, so the dashboard can show
-- them as one workout instead of two separate entries.
-- ============================================================

-- FitLog now records a start time alongside the existing finish time
-- (see js/app.js's markWorkoutStarted()), so a real [start, finish]
-- interval is available for overlap matching. Boostcamp only ever gives
-- a single finish timestamp -- both columns are nullable so older
-- FitLog entries and all Boostcamp entries fall back to point-in-time
-- matching (see sync/link_workouts.py).
alter table fitlog_workouts add column if not exists started_at timestamptz;
alter table fitlog_workouts add column if not exists duration_min numeric;

create table if not exists workout_links (
  garmin_activity_id bigint references garmin_activities(id) on delete cascade,
  fitlog_workout_id text references fitlog_workouts(id) on delete cascade,
  -- 'overlap': both sides had a real interval, confidence = fraction of the
  --   logged session's duration covered by the Garmin activity.
  -- 'contained': the fitlog side was a single point in time (no start_at)
  --   that fell inside the Garmin activity's interval (+ grace window).
  match_type text not null check (match_type in ('overlap', 'contained')),
  confidence numeric,
  linked_at timestamptz default now(),
  primary key (garmin_activity_id, fitlog_workout_id)
);

alter table workout_links enable row level security;
create policy "authenticated read" on workout_links for select to authenticated using (true);
grant select on workout_links to authenticated;
grant select, insert, update, delete on workout_links to service_role;
