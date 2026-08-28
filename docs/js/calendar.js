// ---------- Calendar: browse by day, see + open what happened ----------
import { supabase } from "./supabaseClient.js?v=20260826l";
import { renderWorkoutDetailData, renderCardioZones } from "./workouts.js?v=20260826l";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

let linksCache = null;

// Call after an edit/delete that could change what's linked (or just to
// pick up a fresh auto-relink run) so the next loadMonth() re-fetches.
export function resetLinksCache() {
  linksCache = null;
}

// workout_links may not exist yet (schema/005 not run) -- treat that as
// "no links" rather than breaking the calendar.
async function loadLinks() {
  if (linksCache) return linksCache;
  try {
    const { data, error } = await supabase.from("workout_links").select("garmin_activity_id, fitlog_workout_id");
    if (error) throw error;
    linksCache = data || [];
  } catch (e) {
    console.warn("workout_links unavailable (has schema/005_workout_links.sql been run?):", e.message);
    linksCache = [];
  }
  return linksCache;
}

/**
 * Loads every fitlog_workout + garmin_activity + garmin_daily_stats in the
 * given month and groups them by day. Garmin activities linked to a
 * fitlog_workout are folded into that workout's entry instead of
 * appearing separately.
 */
export async function loadMonth(monthDate) {
  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);
  const startISO = isoDate(start);
  const endISO = isoDate(end);

  const [workoutsRes, activitiesRes, dailyRes, links] = await Promise.all([
    supabase
      .from("fitlog_workouts")
      .select("id, date, name, type, notes")
      .gte("date", start.toISOString())
      .lte("date", end.toISOString()),
    supabase
      .from("garmin_activities")
      .select(
        "id, activity_name, activity_type, start_time, duration_seconds, distance_meters, avg_hr, max_hr, calories, hr_zone_1_seconds, hr_zone_2_seconds, hr_zone_3_seconds, hr_zone_4_seconds, hr_zone_5_seconds"
      )
      .gte("start_time", start.toISOString())
      .lte("start_time", end.toISOString()),
    supabase
      .from("garmin_daily_stats")
      .select("date, resting_hr, avg_stress, body_battery_high, body_battery_low, sleep_seconds, steps")
      .gte("date", startISO)
      .lte("date", endISO),
    loadLinks(),
  ]);
  if (workoutsRes.error) throw workoutsRes.error;
  if (activitiesRes.error) throw activitiesRes.error;
  if (dailyRes.error) throw dailyRes.error;

  const workouts = workoutsRes.data || [];
  const activities = activitiesRes.data || [];
  const dailyByDate = new Map((dailyRes.data || []).map((d) => [d.date, d]));

  const activityById = new Map(activities.map((a) => [a.id, a]));
  const linkedGarminIds = new Set(links.map((l) => l.garmin_activity_id));
  const linkedActivityByWorkoutId = new Map(
    links.filter((l) => activityById.has(l.garmin_activity_id)).map((l) => [l.fitlog_workout_id, activityById.get(l.garmin_activity_id)])
  );

  const byDay = new Map();
  const bump = (dateStr, entry) => {
    const key = dateStr.slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(entry);
  };

  workouts.forEach((w) => {
    bump(w.date, { kind: "workout", workout: w, linkedActivity: linkedActivityByWorkoutId.get(w.id) || null });
  });
  activities.forEach((a) => {
    if (linkedGarminIds.has(a.id)) return; // shown merged into its workout instead
    bump(a.start_time, { kind: "activity", activity: a });
  });

  return { start, end, byDay, dailyByDate };
}

export function renderCalendarGrid(container, monthDate, byDay, onDayClick) {
  container.innerHTML = "";

  const first = startOfMonth(monthDate);
  const leadingBlanks = (first.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = endOfMonth(monthDate).getDate();
  const todayKey = isoDate(new Date());

  ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].forEach((d) => {
    const h = document.createElement("div");
    h.className = "cal-weekday";
    h.textContent = d;
    container.appendChild(h);
  });

  for (let i = 0; i < leadingBlanks; i++) {
    const blank = document.createElement("div");
    blank.className = "cal-day empty";
    container.appendChild(blank);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), d);
    const key = isoDate(date);
    const events = byDay.get(key) || [];
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cal-day" + (events.length ? " has-events" : "") + (key === todayKey ? " today" : "");
    cell.dataset.date = key;
    cell.innerHTML = `<span class="cal-day-num">${d}</span>${events.length ? `<span class="cal-day-dot"></span>` : ""}`;
    cell.addEventListener("click", () => onDayClick(key, events));
    container.appendChild(cell);
  }
}

function eventSummary(ev) {
  if (ev.kind === "activity") {
    const a = ev.activity;
    const bits = [];
    if (a.duration_seconds != null) bits.push(`${Math.round(a.duration_seconds / 60)} min`);
    if (a.distance_meters != null) bits.push(`${(a.distance_meters * 0.000621371).toFixed(1)} mi`);
    return { title: a.activity_name || a.activity_type || "Activity", sub: bits.join(" · ") };
  }
  const w = ev.workout;
  return { title: w.name || (w.type === "cardio" ? "Cardio" : "Workout"), sub: w.type === "cardio" ? "cardio" : "strength" };
}

/**
 * Renders full detail for every event on a day directly inline (no further
 * click needed) -- a day usually has at most a workout and maybe its
 * linked Garmin corroboration, so there's rarely anything to drill into.
 * dailyStats: this day's garmin_daily_stats row, or null/undefined.
 * onSaved(): called after an edit/delete inside this view is saved, so the
 * caller can reload the month (invalidates linksCache too, in case a
 * linked activity's workout was deleted or its date changed).
 */
export async function renderDayDetail(container, dateKey, events, dailyStats, onSaved) {
  container.innerHTML = "";

  const label = new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const header = document.createElement("div");
  header.className = "workout-detail-header";
  header.innerHTML = `<h4>${esc(label)}</h4>`;
  container.appendChild(header);

  if (dailyStats) {
    const bits = [];
    if (dailyStats.resting_hr != null) bits.push(`${dailyStats.resting_hr} bpm resting`);
    if (dailyStats.sleep_seconds != null) bits.push(`${(dailyStats.sleep_seconds / 3600).toFixed(1)}h sleep`);
    if (dailyStats.avg_stress != null) bits.push(`${dailyStats.avg_stress} avg stress`);
    if (dailyStats.body_battery_high != null || dailyStats.body_battery_low != null) {
      bits.push(`${dailyStats.body_battery_low ?? "?"}–${dailyStats.body_battery_high ?? "?"} battery`);
    }
    if (dailyStats.steps != null) bits.push(`${dailyStats.steps.toLocaleString()} steps`);
    if (bits.length) {
      const healthCard = document.createElement("div");
      healthCard.className = "exercise-block day-health-summary";
      healthCard.innerHTML = `<div class="exercise-name">Health</div><div class="muted small">${esc(bits.join(" · "))}</div>`;
      container.appendChild(healthCard);
    }
  }

  if (!events.length) {
    const p = document.createElement("p");
    p.className = "chart-empty";
    p.textContent = "Nothing logged this day.";
    container.appendChild(p);
    return;
  }

  for (const ev of events) {
    if (ev.kind === "activity") {
      const a = ev.activity;
      const { title, sub } = eventSummary(ev);
      const bits = [sub];
      if (a.avg_hr != null) bits.push(`${a.avg_hr} avg hr`);
      if (a.calories != null) bits.push(`${a.calories} cal`);
      const card = document.createElement("div");
      card.className = "exercise-block";
      card.innerHTML = `<div class="exercise-name">⌚ ${esc(title)}</div><div class="muted small">${esc(bits.filter(Boolean).join(" · "))}</div>`;
      container.appendChild(card);

      // This card is otherwise a much shorter summary than the modal's
      // (renderGarminActivityDetail/renderWorkoutDetailData both already
      // show this) -- it was just never given the same zone breakdown,
      // not a data gap, so a click-through wasn't the only way to see it.
      const zones = [1, 2, 3, 4, 5].map((n) => ({ n, seconds: a[`hr_zone_${n}_seconds`] || 0 }));
      if (zones.some((z) => z.seconds > 0)) {
        const zoneWrap = document.createElement("div");
        zoneWrap.className = "sleep-stages";
        zoneWrap.style.marginTop = "6px";
        container.appendChild(zoneWrap);
        renderCardioZones(zoneWrap, zones);
      }
      continue;
    }

    const w = ev.workout;
    const wrap = document.createElement("div");
    container.appendChild(wrap);

    const [setsRes, segRes] = await Promise.all([
      supabase.from("fitlog_sets").select("workout_id, exercise_name, set_index, reps, weight, rpe, is_warmup, done").eq("workout_id", w.id).order("set_index"),
      supabase.from("fitlog_cardio_segments").select("workout_id, activity_type, duration_min, distance, calories, avg_hr, max_hr").eq("workout_id", w.id),
    ]);
    renderWorkoutDetailData(wrap, w, setsRes.data || [], segRes.data || [], ev.linkedActivity, { onSaved });
  }
}

export function monthLabel(monthDate) {
  return monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
