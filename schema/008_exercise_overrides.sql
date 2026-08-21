-- ============================================================
-- User-added/edited exercises (movement pattern, muscles, athleticism).
-- Built-ins still live in docs/js/exerciseLibrary.js -- a row here with
-- the same name overrides one, a new name adds a custom exercise, same
-- "override vs custom" model FitLog already uses locally.
-- ============================================================
create table if not exists exercise_overrides (
  name text primary key,
  movement text not null,
  muscles jsonb not null default '{}',
  athleticism numeric not null default 0,
  updated_at timestamptz default now()
);

alter table exercise_overrides enable row level security;
create policy "authenticated read" on exercise_overrides for select to authenticated using (true);
create policy "authenticated write" on exercise_overrides for insert to authenticated with check (true);
create policy "authenticated update" on exercise_overrides for update to authenticated using (true) with check (true);
create policy "authenticated delete" on exercise_overrides for delete to authenticated using (true);
grant select, insert, update, delete on exercise_overrides to authenticated;
