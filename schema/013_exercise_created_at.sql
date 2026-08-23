-- ============================================================
-- A true creation timestamp for exercise_overrides, distinct from
-- updated_at (which already exists and changes on every edit). "Recently
-- Added" needs to sort by when an exercise was first created, not when it
-- was last touched -- editing an exercise shouldn't bump it back to the
-- top of that list.
-- ============================================================
alter table exercise_overrides add column if not exists created_at timestamptz default now();
