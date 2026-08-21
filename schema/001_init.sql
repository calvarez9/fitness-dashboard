-- ============================================================
-- Fitness Dashboard — initial schema
-- Run this once in Supabase SQL Editor (Project → SQL Editor → New query)
-- ============================================================

-- ---- Garmin daily health metrics (one row per calendar day) ----
create table if not exists garmin_daily_stats (
  date date primary key,
  resting_hr int,
  avg_stress int,
  max_stress int,
  body_battery_high int,
  body_battery_low int,
  steps int,
  steps_goal int,
  floors_climbed int,
  intensity_minutes int,
  sleep_seconds int,
  deep_sleep_seconds int,
  light_sleep_seconds int,
  rem_sleep_seconds int,
  awake_seconds int,
  sleep_score int,
  avg_hrv numeric,
  respiration_avg numeric,
  calories_total int,
  raw jsonb,
  synced_at timestamptz default now()
);

-- ---- Garmin activities (workouts recorded on the watch) ----
create table if not exists garmin_activities (
  id bigint primary key,
  activity_name text,
  activity_type text,
  start_time timestamptz,
  duration_seconds numeric,
  distance_meters numeric,
  avg_hr int,
  max_hr int,
  calories numeric,
  elevation_gain_meters numeric,
  raw jsonb,
  synced_at timestamptz default now()
);

-- ---- FitLog imports: one row per workout you export from FitLog ----
create table if not exists fitlog_workouts (
  id text primary key,              -- FitLog's own workout id
  date timestamptz not null,
  name text,
  type text not null check (type in ('strength','cardio')),
  raw jsonb not null,                -- full workout object, kept for anything not normalized below
  imported_at timestamptz default now()
);

create table if not exists fitlog_sets (
  id bigserial primary key,
  workout_id text references fitlog_workouts(id) on delete cascade,
  exercise_name text not null,
  set_index int not null,
  reps int,
  weight numeric,
  rpe numeric,
  is_warmup boolean default false,
  done boolean default false
);

create table if not exists fitlog_cardio_segments (
  id bigserial primary key,
  workout_id text references fitlog_workouts(id) on delete cascade,
  activity_type text not null,
  duration_min numeric,
  distance numeric,
  calories numeric,
  avg_hr numeric,
  max_hr numeric
);

-- ---- Sync job bookkeeping (last synced date, etc.) ----
create table if not exists sync_state (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

-- ============================================================
-- Row Level Security
-- Dashboard reads require a logged-in user (the one password-gated
-- account you'll create). Writes are done only by the sync job using
-- the service_role key, which bypasses RLS entirely, so no write
-- policies are needed here.
-- ============================================================
alter table garmin_daily_stats enable row level security;
alter table garmin_activities enable row level security;
alter table fitlog_workouts enable row level security;
alter table fitlog_sets enable row level security;
alter table fitlog_cardio_segments enable row level security;
alter table sync_state enable row level security;

create policy "authenticated read" on garmin_daily_stats for select to authenticated using (true);
create policy "authenticated read" on garmin_activities for select to authenticated using (true);
create policy "authenticated read" on fitlog_workouts for select to authenticated using (true);
create policy "authenticated read" on fitlog_sets for select to authenticated using (true);
create policy "authenticated read" on fitlog_cardio_segments for select to authenticated using (true);
-- sync_state has no policy at all: invisible to anon/authenticated, only
-- readable/writable by service_role (used solely by the sync job).

-- ============================================================
-- Secret access functions — let the sync job read/write Vault
-- secrets (Garmin credentials, cached session token) over the API
-- using the service_role key, without ever needing your raw
-- database password.
-- ============================================================
create or replace function get_secret(secret_name text)
returns text
language sql
security definer
set search_path = vault, public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = secret_name limit 1;
$$;

create or replace function set_secret(secret_name text, secret_value text)
returns void
language plpgsql
security definer
set search_path = vault, public
as $$
begin
  if exists (select 1 from vault.secrets where name = secret_name) then
    perform vault.update_secret(
      (select id from vault.secrets where name = secret_name),
      secret_value
    );
  else
    perform vault.create_secret(secret_value, secret_name);
  end if;
end;
$$;

revoke all on function get_secret(text) from public, anon, authenticated;
revoke all on function set_secret(text, text) from public, anon, authenticated;
grant execute on function get_secret(text) to service_role;
grant execute on function set_secret(text, text) to service_role;
