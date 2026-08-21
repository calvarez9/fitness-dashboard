// ---------- Individual workouts + exercise/movement/muscle stats ----------
import { supabase } from "./supabaseClient.js";
import { resolveExerciseMeta, MUSCLES, MOVEMENTS, MOVEMENT_LABEL } from "./exerciseLibrary.js";

let cache = { workouts: [], setsByWorkout: new Map(), segmentsByWorkout: new Map() };

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
  if (ids.length) {
    const [setsRes, segRes] = await Promise.all([
      supabase
        .from("fitlog_sets")
        .select("workout_id, exercise_name, set_index, reps, weight, rpe, is_warmup, done")
        .in("workout_id", ids)
        .order("set_index", { ascending: true }),
      supabase
        .from("fitlog_cardio_segments")
        .select("workout_id, activity_type, duration_min, distance, calories, avg_hr, max_hr")
        .in("workout_id", ids),
    ]);
    if (setsRes.error) throw setsRes.error;
    if (segRes.error) throw segRes.error;
    sets = setsRes.data || [];
    segments = segRes.data || [];
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

  cache = { workouts: workouts || [], setsByWorkout, segmentsByWorkout };
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

    const row = document.createElement("button");
    row.type = "button";
    row.className = "workout-row";
    row.innerHTML = `
      <span class="workout-row-date">${dateLabel}</span>
      <span class="workout-row-main">
        <span class="workout-row-name">${esc(w.name || (w.type === "cardio" ? "Cardio" : "Workout"))}</span>
        <span class="workout-row-sub">${esc(sub)}</span>
      </span>
      <span class="workout-type-badge ${w.type === "cardio" ? "cardio" : "strength"}">${w.type === "cardio" ? "cardio" : "strength"}</span>
    `;
    row.addEventListener("click", () => onOpen(w.id));
    container.appendChild(row);
  });
}

export function renderWorkoutDetail(container, id) {
  container.innerHTML = "";
  const workout = cache.workouts.find((w) => w.id === id);
  if (!workout) return;
  const sets = cache.setsByWorkout.get(id) || [];
  const segments = cache.segmentsByWorkout.get(id) || [];

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

  const movementRows = MOVEMENTS.map((m) => ({ label: MOVEMENT_LABEL[m.key], value: round(movementTotals[m.key]) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  const muscleRows = MUSCLES.map((m) => ({ label: m.label, value: round(muscleTotals[m.key]) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  return { movementRows, muscleRows, unmatched: [...unmatched] };
}

function round(n) {
  return Math.round(n * 2) / 2;
}
