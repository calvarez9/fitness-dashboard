// ---------- Individual workouts + exercise/movement/muscle stats ----------
import { supabase } from "./supabaseClient.js";
import { resolveExerciseMeta, MUSCLES, MUSCLE_LABEL, MOVEMENTS, MOVEMENT_LABEL } from "./exerciseLibrary.js";
import { renderBarList } from "./charts.js";

let cache = { workouts: [], setsByWorkout: new Map(), segmentsByWorkout: new Map(), linkedActivityByWorkout: new Map() };

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export async function loadWorkouts(start, end) {
  const { data: workouts, error: wErr } = await supabase
    .from("fitlog_workouts")
    .select("id, date, name, type")
    .gte("date", start.toISOString())
    .lte("date", end.toISOString())
    .order("date", { ascending: false });
  if (wErr) throw wErr;

  const ids = (workouts || []).map((w) => w.id);
  let sets = [];
  let segments = [];
  let links = [];
  if (ids.length) {
    const [setsRes, segRes, linksRes] = await Promise.all([
      supabase
        .from("fitlog_sets")
        .select("workout_id, exercise_name, set_index, reps, weight, rpe, is_warmup, done")
        .in("workout_id", ids)
        .order("set_index", { ascending: true }),
      supabase
        .from("fitlog_cardio_segments")
        .select("workout_id, activity_type, duration_min, distance, calories, avg_hr, max_hr")
        .in("workout_id", ids),
      // workout_links may not exist yet (schema/005 not run) -- treat that
      // as "no links" rather than breaking the whole workouts list.
      supabase
        .from("workout_links")
        .select("fitlog_workout_id, garmin_activities(id, activity_name, activity_type, duration_seconds, avg_hr, max_hr, calories)")
        .in("fitlog_workout_id", ids)
        .then(
          (r) => r,
          () => ({ data: [], error: null })
        ),
    ]);
    if (setsRes.error) throw setsRes.error;
    if (segRes.error) throw segRes.error;
    sets = setsRes.data || [];
    segments = segRes.data || [];
    links = linksRes.error ? [] : linksRes.data || [];
  }

  const setsByWorkout = new Map();
  sets.forEach((s) => {
    if (!setsByWorkout.has(s.workout_id)) setsByWorkout.set(s.workout_id, []);
    setsByWorkout.get(s.workout_id).push(s);
  });
  const segmentsByWorkout = new Map();
  segments.forEach((s) => {
    if (!segmentsByWorkout.has(s.workout_id)) segmentsByWorkout.set(s.workout_id, []);
    segmentsByWorkout.get(s.workout_id).push(s);
  });
  const linkedActivityByWorkout = new Map();
  links.forEach((l) => {
    if (l.garmin_activities) linkedActivityByWorkout.set(l.fitlog_workout_id, l.garmin_activities);
  });

  cache = { workouts: workouts || [], setsByWorkout, segmentsByWorkout, linkedActivityByWorkout };
  return cache;
}

// ---------- Workout list + detail ----------
export function renderWorkoutsList(container, onOpen) {
  container.innerHTML = "";
  if (!cache.workouts.length) {
    container.appendChild(emptyNote("No workouts in range yet."));
    return;
  }
  cache.workouts.forEach((w) => {
    const sets = cache.setsByWorkout.get(w.id) || [];
    const segs = cache.segmentsByWorkout.get(w.id) || [];
    const dateLabel = new Date(w.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

    let sub;
    if (w.type === "cardio") {
      sub = `${segs.length} segment${segs.length === 1 ? "" : "s"}`;
    } else {
      const exerciseCount = new Set(sets.map((s) => s.exercise_name)).size;
      const workingSets = sets.filter((s) => !s.is_warmup).length;
      sub = `${exerciseCount} exercise${exerciseCount === 1 ? "" : "s"} · ${workingSets} set${workingSets === 1 ? "" : "s"}`;
    }

    const linked = cache.linkedActivityByWorkout.get(w.id);
    if (linked?.avg_hr != null) sub += ` · ${linked.avg_hr} avg hr`;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "workout-row";
    row.innerHTML = `
      <span class="workout-row-date">${dateLabel}</span>
      <span class="workout-row-main">
        <span class="workout-row-name">${esc(w.name || (w.type === "cardio" ? "Cardio" : "Workout"))}${linked ? ' <span class="linked-badge" title="Also recorded on Garmin">⌚</span>' : ""}</span>
        <span class="workout-row-sub">${esc(sub)}</span>
      </span>
      <span class="workout-type-badge ${w.type === "cardio" ? "cardio" : "strength"}">${w.type === "cardio" ? "cardio" : "strength"}</span>
    `;
    row.addEventListener("click", () => onOpen(w.id));
    container.appendChild(row);
  });
}

export function renderWorkoutDetail(container, id) {
  const workout = cache.workouts.find((w) => w.id === id);
  if (!workout) return;
  const sets = cache.setsByWorkout.get(id) || [];
  const segments = cache.segmentsByWorkout.get(id) || [];
  const linkedActivity = cache.linkedActivityByWorkout.get(id) || null;
  renderWorkoutDetailData(container, workout, sets, segments, linkedActivity);
}

// Pure version of the above -- takes the workout + its children directly
// instead of looking them up in this module's own range-scoped cache, so
// other views (e.g. the calendar, which browses by month rather than the
// dashboard's date-range selector) can reuse the exact same rendering.
// linkedActivity (optional): a garmin_activities row matched to this
// workout via workout_links, shown as a corroborating metrics line.
export function renderWorkoutDetailData(container, workout, sets, segments, linkedActivity = null) {
  container.innerHTML = "";

  const dateLabel = new Date(workout.date).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const header = document.createElement("div");
  header.className = "workout-detail-header";
  header.innerHTML = `<h4>${esc(workout.name || "Workout")}</h4><p class="muted small">${esc(dateLabel)}</p>`;
  container.appendChild(header);

  if (linkedActivity) {
    const bits = [];
    if (linkedActivity.duration_seconds != null) bits.push(`${Math.round(linkedActivity.duration_seconds / 60)} min`);
    if (linkedActivity.avg_hr != null) bits.push(`${linkedActivity.avg_hr} avg hr`);
    if (linkedActivity.max_hr != null) bits.push(`${linkedActivity.max_hr} max hr`);
    if (linkedActivity.calories != null) bits.push(`${linkedActivity.calories} cal`);
    const garminNote = document.createElement("p");
    garminNote.className = "muted small";
    garminNote.textContent = `⌚ Recorded on Garmin (${linkedActivity.activity_name || linkedActivity.activity_type}): ${bits.join(" · ")}`;
    container.appendChild(garminNote);
  }

  if (workout.type === "cardio") {
    if (!segments.length) {
      container.appendChild(emptyNote("No segments recorded."));
      return;
    }
    segments.forEach((seg) => {
      const bits = [];
      if (seg.duration_min != null) bits.push(`${seg.duration_min} min`);
      if (seg.distance != null) bits.push(`${seg.distance} mi`);
      if (seg.calories != null) bits.push(`${seg.calories} cal`);
      if (seg.avg_hr != null) bits.push(`${seg.avg_hr} avg hr`);
      if (seg.max_hr != null) bits.push(`${seg.max_hr} max hr`);
      const card = document.createElement("div");
      card.className = "exercise-block";
      card.innerHTML = `<div class="exercise-name">${esc(seg.activity_type || "Cardio")}</div><div class="muted small">${esc(bits.join(" · "))}</div>`;
      container.appendChild(card);
    });
    return;
  }

  if (!sets.length) {
    container.appendChild(emptyNote("No sets recorded."));
    return;
  }

  const order = [];
  const byExercise = new Map();
  sets.forEach((s) => {
    if (!byExercise.has(s.exercise_name)) {
      byExercise.set(s.exercise_name, []);
      order.push(s.exercise_name);
    }
    byExercise.get(s.exercise_name).push(s);
  });

  order.forEach((name) => {
    const exSets = [...byExercise.get(name)].sort((a, b) => a.set_index - b.set_index);
    const rowsHtml = exSets
      .map((s) => {
        const parts = [];
        if (s.weight != null) parts.push(`${s.weight} lb`);
        if (s.reps != null) parts.push(`${s.reps} reps`);
        if (s.rpe != null) parts.push(`RPE ${s.rpe}`);
        const label = parts.length ? parts.join(" × ") : "—";
        return `<div class="set-row${s.is_warmup ? " warmup" : ""}"><span class="set-marker">${s.is_warmup ? "W" : "·"}</span><span>${esc(label)}</span></div>`;
      })
      .join("");
    const block = document.createElement("div");
    block.className = "exercise-block";
    block.innerHTML = `<div class="exercise-name">${esc(name)}</div>${rowsHtml}`;
    container.appendChild(block);
  });
}

function emptyNote(text) {
  const p = document.createElement("p");
  p.className = "chart-empty";
  p.textContent = text;
  return p;
}

// ---------- Stats: top exercises, movement pattern, muscle volume ----------
export function computeExerciseStats(limit = 10) {
  const totals = new Map(); // name -> { sets, volume }
  for (const sets of cache.setsByWorkout.values()) {
    sets.forEach((s) => {
      if (s.is_warmup) return;
      const cur = totals.get(s.exercise_name) || { sets: 0, volume: 0 };
      cur.sets += 1;
      if (s.weight != null && s.reps != null) cur.volume += s.weight * s.reps;
      totals.set(s.exercise_name, cur);
    });
  }
  return [...totals.entries()]
    .map(([name, v]) => ({
      label: name,
      value: v.sets,
      sub: v.volume ? `· ${Math.round(v.volume).toLocaleString()} lb` : "",
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export function computeMovementMuscleStats() {
  const movementTotals = Object.fromEntries(MOVEMENTS.map((m) => [m.key, 0]));
  const muscleTotals = Object.fromEntries(MUSCLES.map((m) => [m.key, 0]));
  const unmatched = new Set();

  for (const sets of cache.setsByWorkout.values()) {
    sets.forEach((s) => {
      if (s.is_warmup) return;
      const meta = resolveExerciseMeta(s.exercise_name);
      if (!meta.matched) unmatched.add(s.exercise_name);
      movementTotals[meta.movement] = (movementTotals[meta.movement] || 0) + 1;
      Object.entries(meta.muscles || {}).forEach(([muscle, frac]) => {
        muscleTotals[muscle] = (muscleTotals[muscle] || 0) + frac;
      });
    });
  }

  const movementRows = MOVEMENTS.map((m) => ({ key: m.key, label: MOVEMENT_LABEL[m.key], value: round(movementTotals[m.key]) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  const muscleRows = MUSCLES.map((m) => ({ key: m.key, label: m.label, value: round(muscleTotals[m.key]) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  return { movementRows, muscleRows, muscleTotals, unmatched: [...unmatched] };
}

// ---------- Drill-down: exercise -> sessions, movement -> exercises ----------

// All sessions (workouts) in the currently loaded range that include a
// given exercise, most recent first, with just that exercise's sets.
function sessionsForExercise(exerciseName) {
  const out = [];
  for (const [workoutId, sets] of cache.setsByWorkout.entries()) {
    const relevant = sets.filter((s) => s.exercise_name === exerciseName && !s.is_warmup);
    if (!relevant.length) continue;
    const workout = cache.workouts.find((w) => w.id === workoutId);
    if (workout) out.push({ workout, sets: relevant.sort((a, b) => a.set_index - b.set_index) });
  }
  return out.sort((a, b) => new Date(b.workout.date) - new Date(a.workout.date));
}

export function renderExerciseDetail(container, exerciseName, onOpenWorkout) {
  container.innerHTML = "";
  const header = document.createElement("div");
  header.className = "workout-detail-header";
  header.innerHTML = `<h4>${esc(exerciseName)}</h4>`;
  container.appendChild(header);

  const sessions = sessionsForExercise(exerciseName);
  if (!sessions.length) {
    container.appendChild(emptyNote("No sessions in range."));
    return;
  }

  sessions.forEach(({ workout, sets }) => {
    const dateLabel = new Date(workout.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const setSummary = sets
      .map((s) => {
        const parts = [];
        if (s.weight != null) parts.push(`${s.weight}`);
        if (s.reps != null) parts.push(`×${s.reps}`);
        return parts.length ? parts.join(" ") : "—";
      })
      .join(", ");

    const row = document.createElement("button");
    row.type = "button";
    row.className = "workout-row";
    row.innerHTML = `
      <span class="workout-row-date">${esc(dateLabel)}</span>
      <span class="workout-row-main">
        <span class="workout-row-name">${esc(workout.name || "Workout")}</span>
        <span class="workout-row-sub">${esc(setSummary)}</span>
      </span>
    `;
    row.addEventListener("click", () => onOpenWorkout(workout.id));
    container.appendChild(row);
  });
}

export function renderMovementDetail(container, movementKey, onOpenExercise) {
  container.innerHTML = "";
  const header = document.createElement("div");
  header.className = "workout-detail-header";
  header.innerHTML = `<h4>${esc(MOVEMENT_LABEL[movementKey] || movementKey)}</h4>`;
  container.appendChild(header);

  const totals = new Map(); // exercise_name -> sets
  for (const sets of cache.setsByWorkout.values()) {
    sets.forEach((s) => {
      if (s.is_warmup) return;
      if (resolveExerciseMeta(s.exercise_name).movement !== movementKey) return;
      totals.set(s.exercise_name, (totals.get(s.exercise_name) || 0) + 1);
    });
  }

  const rows = [...totals.entries()].map(([name, sets]) => ({ label: name, value: sets })).sort((a, b) => b.value - a.value);
  if (!rows.length) {
    container.appendChild(emptyNote("No exercises in range."));
    return;
  }

  const list = document.createElement("div");
  list.className = "bar-list";
  container.appendChild(list);
  renderBarList(list, rows, { onClick: (r) => onOpenExercise(r.label) });
}

export function renderMuscleDetail(container, muscleKey, onOpenExercise) {
  container.innerHTML = "";
  const header = document.createElement("div");
  header.className = "workout-detail-header";
  header.innerHTML = `<h4>${esc(MUSCLE_LABEL[muscleKey] || muscleKey)}</h4>`;
  container.appendChild(header);

  const totals = new Map(); // exercise_name -> fraction-weighted credited sets
  for (const sets of cache.setsByWorkout.values()) {
    sets.forEach((s) => {
      if (s.is_warmup) return;
      const frac = resolveExerciseMeta(s.exercise_name).muscles?.[muscleKey];
      if (!frac) return;
      totals.set(s.exercise_name, (totals.get(s.exercise_name) || 0) + frac);
    });
  }

  const rows = [...totals.entries()]
    .map(([name, credit]) => ({ label: name, value: round(credit) }))
    .sort((a, b) => b.value - a.value);
  if (!rows.length) {
    container.appendChild(emptyNote("No exercises in range."));
    return;
  }

  const list = document.createElement("div");
  list.className = "bar-list";
  container.appendChild(list);
  renderBarList(list, rows, { onClick: (r) => onOpenExercise(r.label) });
}

function round(n) {
  return Math.round(n * 2) / 2;
}
