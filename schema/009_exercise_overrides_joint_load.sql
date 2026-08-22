-- ============================================================
-- Joint load (Low Back / Knees / Shoulders) per exercise, alongside the
-- existing movement/muscles/athleticism fields on exercise_overrides.
-- ============================================================
alter table exercise_overrides add column if not exists joint_load jsonb not null default '{}';
