-- ============================================================
-- One row per calendar day, independent of whether you worked out --
-- back_morning (0-10 self-rating), sitting_hours, long_sitting (a
-- gaming/study marathon flag), and a free-text note. Written directly by
-- the FitLog client (same as fitlog_workouts), not a service-role sync
-- job, so it needs real read+write policies, not just select.
--
-- Deliberately no steps/sleep/weight columns -- those already exist on
-- garmin_daily_stats and stay sourced from there, not duplicated here.
--
-- Since the PIN login gate was removed in 012_remove_auth_gate.sql and
-- the app has operated as `anon` ever since, this table gets both `anon`
-- and `authenticated` grants/policies from the start, matching every
-- other client-written table's CURRENT state (fitlog_workouts,
-- fitlog_sets, exercise_overrides) rather than the pre-012 pattern.
-- ============================================================
create table if not exists daily_log (
  date date primary key,
  back_morning numeric,
  sitting_hours numeric,
  long_sitting boolean,
  note text,
  updated_at timestamptz default now()
);

alter table daily_log enable row level security;

create policy "authenticated read" on daily_log for select to anon, authenticated using (true);
create policy "authenticated write" on daily_log for insert to anon, authenticated with check (true);
create policy "authenticated update" on daily_log for update to anon, authenticated using (true) with check (true);
create policy "authenticated delete" on daily_log for delete to anon, authenticated using (true);

grant select, insert, update, delete on daily_log to anon, authenticated;
grant select, insert, update, delete on daily_log to service_role;
