-- ============================================================
-- Let a logged-in user write their own FitLog import data
-- (Garmin tables stay sync-job-only via service_role — no policy needed there).
-- Run after 001-003.
-- ============================================================

create policy "authenticated write" on fitlog_workouts
  for insert to authenticated with check (true);
create policy "authenticated update" on fitlog_workouts
  for update to authenticated using (true) with check (true);
create policy "authenticated delete" on fitlog_workouts
  for delete to authenticated using (true);

create policy "authenticated write" on fitlog_sets
  for insert to authenticated with check (true);
create policy "authenticated delete" on fitlog_sets
  for delete to authenticated using (true);

create policy "authenticated write" on fitlog_cardio_segments
  for insert to authenticated with check (true);
create policy "authenticated delete" on fitlog_cardio_segments
  for delete to authenticated using (true);

grant insert, update, delete on fitlog_workouts, fitlog_sets, fitlog_cardio_segments to authenticated;
grant usage, select on all sequences in schema public to authenticated;
