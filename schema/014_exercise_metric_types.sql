-- ============================================================
-- Exercise logging types (Weighted / Bodyweight / Isometric / Loaded
-- Carry) -- see FitLog's exerciseLibrary.js for the concept. Two things
-- needed on this side:
--
-- 1. fitlog_sets.duration -- Isometric holds and Loaded Carries log a
--    time instead of (or alongside) weight/reps; the column didn't
--    exist, so those sets were syncing with it silently dropped.
-- 2. exercise_overrides.metric_type -- so a custom/edited exercise here
--    can declare its own log type too, same as FitLog's Library editor.
-- ============================================================
alter table fitlog_sets add column if not exists duration numeric;
alter table exercise_overrides add column if not exists metric_type text;
