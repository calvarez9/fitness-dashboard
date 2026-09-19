-- ============================================================
-- RIR (reps in reserve) alongside the existing per-set RPE column.
-- The two are always mutually exclusive per set -- FitLog's own UI never
-- writes both at once and never converts between them -- so this is a
-- second nullable column, not a replacement for rpe.
-- ============================================================
alter table fitlog_sets add column if not exists rir numeric;
