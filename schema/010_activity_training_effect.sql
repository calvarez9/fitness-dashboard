-- ============================================================
-- Garmin's own aerobic/anaerobic training-effect scores and training-load
-- number per activity, so cardio can be weighted by effort/quality instead
-- of raw minutes. Field names on the sync side are a best guess (see
-- sync/garmin_sync.py) -- if they come back null after a real sync, check
-- the `raw` jsonb column on a recent row for the actual key names Garmin
-- returned and fix the mapping there, nothing here needs to change.
--
-- Also retroactively drops any already-synced dog-walk sessions ("Pauwi
-- Walk") -- sync/garmin_sync.py excludes them going forward, but this
-- clears out ones synced before that filter existed so historical cardio
-- stats aren't skewed by them either.
-- ============================================================
alter table garmin_activities add column if not exists aerobic_training_effect numeric;
alter table garmin_activities add column if not exists anaerobic_training_effect numeric;
alter table garmin_activities add column if not exists training_effect_label text;
alter table garmin_activities add column if not exists activity_training_load numeric;

delete from garmin_activities where activity_name ilike '%pauwi%';
