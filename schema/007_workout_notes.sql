-- ============================================================
-- Freeform notes per workout (how it felt, soreness, etc).
-- Written from FitLog's own Log view now, and editable from the
-- dashboard too.
-- ============================================================
alter table fitlog_workouts add column if not exists notes text;
