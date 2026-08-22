// ---------- Individual workouts + exercise/movement/muscle stats ----------
import { supabase } from "./supabaseClient.js";
import { resolveExerciseMeta, MUSCLES, MUSCLE_LABEL, MOVEMENTS, MOVEMENT_LABEL, MOVEMENT_GROUPS, JOINTS } from "./exerciseLibrary.js";
import { renderBarList, renderProgressChart } from "./charts.js";

// Standard Epley estimated-1RM formula, matching FitLog's own progress view.
function epley1RM(weight, reps) {
  if (!weight || !reps) return 0;
  return weight * (1 + reps / 30);
}

let cache = { workouts: [], setsByWorkout: new Map(), segmentsByWorkout: new Map(), linkedActivityByWorkout: new Map() };

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export async function loadWorkouts(start, end) {
  const { data: workouts, error: wErr } = await supabase
    .from("fitlog_workouts")
    .select("id, date, name, type, notes")
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

// onSaved(): called after a successful edit save or delete, so the caller
// can refresh whatever list/stats/calendar is showing this workout.
export function renderWorkoutDetail(container, id, onSaved) {
  const workout = cache.workouts.find((w) => w.id === id);
  if (!workout) return;
  const sets = cache.setsByWorkout.get(id) || [];
  const segments = cache.segmentsByWorkout.get(id) || [];
  const linkedActivity = cache.linkedActivityByWorkout.get(id) || null;
  renderWorkoutDetailData(container, workout, sets, segments, linkedActivity, { onSaved });
}

// Pure version of the above -- takes the workout + its children directly
// instead of looking them up in this module's own range-scoped cache, so
// other views (e.g. the calendar, which browses by month rather than the
// dashboard's date-range selector) can reuse the exact same rendering.
// linkedActivity (optional): a garmin_activities row matched to this
// workout via workout_links, shown as a corroborating metrics line.
export function renderWorkoutDetailData(container, workout, sets, segments, linkedActivity = null, opts = {}) {
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

  const actions = document.createElement("div");
  actions.className = "workout-detail-actions";
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "btn secondary small";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => renderWorkoutEditForm(container, workout, sets, segments, linkedActivity, opts.onSaved));
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn ghost small";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", async () => {
    if (!confirm("Delete this workout? This can't be undone.")) return;
    try {
      await deleteWorkoutRow(workout.id);
      if (opts.onSaved) opts.onSaved();
    } catch (e) {
      alert(`Couldn't delete: ${e.message}`);
    }
  });
  actions.append(editBtn, deleteBtn);
  container.appendChild(actions);

  if (workout.notes) {
    const notesEl = document.createElement("p");
    notesEl.className = "workout-notes-display";
    notesEl.textContent = `"${workout.notes}"`;
    container.appendChild(notesEl);
  }

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

// ---------- Editing ----------
async function saveWorkoutEdits(workout, state) {
  const { error: wErr } = await supabase
    .from("fitlog_workouts")
    .update({ name: state.name, date: state.date, notes: state.notes || null })
    .eq("id", workout.id);
  if (wErr) throw wErr;

  if (workout.type === "cardio") {
    const { error: delErr } = await supabase.from("fitlog_cardio_segments").delete().eq("workout_id", workout.id);
    if (delErr) throw delErr;
    const rows = state.segments.map((seg) => ({
      workout_id: workout.id,
      activity_type: seg.activityType,
      duration_min: seg.durationMin,
      distance: seg.distance,
      calories: seg.calories,
      avg_hr: seg.avgHr,
      max_hr: seg.maxHr,
    }));
    if (rows.length) {
      const { error } = await supabase.from("fitlog_cardio_segments").insert(rows);
      if (error) throw error;
    }
  } else {
    const { error: delErr } = await supabase.from("fitlog_sets").delete().eq("workout_id", workout.id);
    if (delErr) throw delErr;
    const rows = [];
    state.exercises.forEach((ex) => {
      ex.sets.forEach((s, i) => {
        rows.push({
          workout_id: workout.id,
          exercise_name: ex.name,
          set_index: i,
          reps: s.reps,
          weight: s.weight,
          rpe: s.rpe,
          is_warmup: !!s.isWarmup,
          done: true,
        });
      });
    });
    if (rows.length) {
      const { error } = await supabase.from("fitlog_sets").insert(rows);
      if (error) throw error;
    }
  }
}

async function deleteWorkoutRow(workoutId) {
  // fitlog_sets / fitlog_cardio_segments cascade-delete via their FK (see schema/001_init.sql).
  const { error } = await supabase.from("fitlog_workouts").delete().eq("id", workoutId);
  if (error) throw error;
}

function toDatetimeLocal(isoString) {
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function renderWorkoutEditForm(container, workout, sets, segments, linkedActivity, onSaved) {
  container.innerHTML = "";

  const state = { name: workout.name || "", date: workout.date, notes: workout.notes || "", exercises: [], segments: [] };

  if (workout.type === "cardio") {
    state.segments = segments.map((seg) => ({
      activityType: seg.activity_type || "",
      durationMin: seg.duration_min,
      distance: seg.distance,
      calories: seg.calories,
      avgHr: seg.avg_hr,
      maxHr: seg.max_hr,
    }));
  } else {
    const order = [];
    const byExercise = new Map();
    sets.forEach((s) => {
      if (!byExercise.has(s.exercise_name)) {
        byExercise.set(s.exercise_name, []);
        order.push(s.exercise_name);
      }
      byExercise.get(s.exercise_name).push(s);
    });
    state.exercises = order.map((name) => ({
      name,
      sets: [...byExercise.get(name)]
        .sort((a, b) => a.set_index - b.set_index)
        .map((s) => ({ reps: s.reps, weight: s.weight, rpe: s.rpe, isWarmup: !!s.is_warmup })),
    }));
  }

  const header = document.createElement("div");
  header.className = "workout-detail-header";
  header.innerHTML = `<h4>Edit workout</h4>`;
  container.appendChild(header);

  const nameField = document.createElement("div");
  nameField.className = "edit-field";
  nameField.innerHTML = `<label>Name</label><input type="text" value="${esc(state.name)}" />`;
  nameField.querySelector("input").addEventListener("input", (e) => (state.name = e.target.value));
  container.appendChild(nameField);

  const dateField = document.createElement("div");
  dateField.className = "edit-field";
  dateField.innerHTML = `<label>Date &amp; time</label><input type="datetime-local" value="${toDatetimeLocal(state.date)}" />`;
  dateField.querySelector("input").addEventListener("input", (e) => {
    if (e.target.value) state.date = new Date(e.target.value).toISOString();
  });
  container.appendChild(dateField);

  const notesField = document.createElement("div");
  notesField.className = "edit-field";
  notesField.innerHTML = `<label>Notes</label><textarea rows="2" placeholder="How it felt, soreness, anything worth remembering…">${esc(state.notes)}</textarea>`;
  notesField.querySelector("textarea").addEventListener("input", (e) => (state.notes = e.target.value));
  container.appendChild(notesField);

  const body = document.createElement("div");
  body.className = "workout-detail-body";
  container.appendChild(body);

  function renderBody() {
    body.innerHTML = "";
    if (workout.type === "cardio") renderSegments();
    else renderExercises();
  }

  function renderExercises() {
    state.exercises.forEach((ex, exIdx) => {
      const block = document.createElement("div");
      block.className = "exercise-block";

      const exHeader = document.createElement("div");
      exHeader.className = "edit-exercise-header";
      exHeader.innerHTML = `<span class="exercise-name">${esc(ex.name)}</span>`;
      const removeExBtn = document.createElement("button");
      removeExBtn.type = "button";
      removeExBtn.className = "icon-btn small";
      removeExBtn.setAttribute("aria-label", "Remove exercise");
      removeExBtn.textContent = "✕";
      removeExBtn.addEventListener("click", () => {
        state.exercises.splice(exIdx, 1);
        renderBody();
      });
      exHeader.appendChild(removeExBtn);
      block.appendChild(exHeader);

      ex.sets.forEach((s, setIdx) => {
        const row = document.createElement("div");
        row.className = "edit-set-row";
        row.innerHTML = `
          <span class="set-marker">${setIdx + 1}</span>
          <input type="number" step="any" placeholder="lb" value="${s.weight ?? ""}" />
          <input type="number" step="any" placeholder="reps" value="${s.reps ?? ""}" />
          <input type="number" step="any" placeholder="RPE" value="${s.rpe ?? ""}" />
          <label class="warmup-toggle"><input type="checkbox" ${s.isWarmup ? "checked" : ""} /> W</label>
        `;
        const [weightInput, repsInput, rpeInput] = row.querySelectorAll('input[type="number"]');
        weightInput.addEventListener("input", (e) => (s.weight = numOrNull(e.target.value)));
        repsInput.addEventListener("input", (e) => (s.reps = numOrNull(e.target.value)));
        rpeInput.addEventListener("input", (e) => (s.rpe = numOrNull(e.target.value)));
        row.querySelector('input[type="checkbox"]').addEventListener("change", (e) => (s.isWarmup = e.target.checked));

        const removeSetBtn = document.createElement("button");
        removeSetBtn.type = "button";
        removeSetBtn.className = "icon-btn small";
        removeSetBtn.setAttribute("aria-label", "Remove set");
        removeSetBtn.textContent = "✕";
        removeSetBtn.addEventListener("click", () => {
          ex.sets.splice(setIdx, 1);
          renderBody();
        });
        row.appendChild(removeSetBtn);
        block.appendChild(row);
      });

      const addSetBtn = document.createElement("button");
      addSetBtn.type = "button";
      addSetBtn.className = "btn ghost small";
      addSetBtn.textContent = "+ Add set";
      addSetBtn.addEventListener("click", () => {
        const last = ex.sets[ex.sets.length - 1];
        ex.sets.push({ reps: last?.reps ?? null, weight: last?.weight ?? null, rpe: null, isWarmup: false });
        renderBody();
      });
      block.appendChild(addSetBtn);

      body.appendChild(block);
    });

    const addExRow = document.createElement("div");
    addExRow.className = "edit-field";
    addExRow.innerHTML = `<label>Add exercise (press Enter)</label><input type="text" placeholder="Exercise name…" />`;
    const input = addExRow.querySelector("input");
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      state.exercises.push({ name, sets: [{ reps: null, weight: null, rpe: null, isWarmup: false }] });
      renderBody();
    });
    body.appendChild(addExRow);
  }

  function renderSegments() {
    state.segments.forEach((seg, idx) => {
      const block = document.createElement("div");
      block.className = "exercise-block";
      block.innerHTML = `
        <div class="edit-exercise-header"><span class="exercise-name">Segment ${idx + 1}</span></div>
        <div class="edit-segment-grid">
          <div class="edit-field wide"><label>Activity</label><input type="text" value="${esc(seg.activityType)}" /></div>
          <div class="edit-field"><label>Duration (min)</label><input type="number" step="any" value="${seg.durationMin ?? ""}" /></div>
          <div class="edit-field"><label>Distance (mi)</label><input type="number" step="any" value="${seg.distance ?? ""}" /></div>
          <div class="edit-field"><label>Calories</label><input type="number" step="any" value="${seg.calories ?? ""}" /></div>
          <div class="edit-field"><label>Avg HR</label><input type="number" step="any" value="${seg.avgHr ?? ""}" /></div>
          <div class="edit-field"><label>Max HR</label><input type="number" step="any" value="${seg.maxHr ?? ""}" /></div>
        </div>
      `;
      const [activityInput, durInput, distInput, calInput, avgInput, maxInput] = block.querySelectorAll("input");
      activityInput.addEventListener("input", (e) => (seg.activityType = e.target.value));
      durInput.addEventListener("input", (e) => (seg.durationMin = numOrNull(e.target.value)));
      distInput.addEventListener("input", (e) => (seg.distance = numOrNull(e.target.value)));
      calInput.addEventListener("input", (e) => (seg.calories = numOrNull(e.target.value)));
      avgInput.addEventListener("input", (e) => (seg.avgHr = numOrNull(e.target.value)));
      maxInput.addEventListener("input", (e) => (seg.maxHr = numOrNull(e.target.value)));

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "icon-btn small";
      removeBtn.setAttribute("aria-label", "Remove segment");
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => {
        state.segments.splice(idx, 1);
        renderBody();
      });
      block.querySelector(".edit-exercise-header").appendChild(removeBtn);

      body.appendChild(block);
    });

    const addSegBtn = document.createElement("button");
    addSegBtn.type = "button";
    addSegBtn.className = "btn ghost small";
    addSegBtn.textContent = "+ Add segment";
    addSegBtn.addEventListener("click", () => {
      state.segments.push({ activityType: "", durationMin: null, distance: null, calories: null, avgHr: null, maxHr: null });
      renderBody();
    });
    body.appendChild(addSegBtn);
  }

  renderBody();

  const footer = document.createElement("div");
  footer.className = "workout-detail-actions";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn primary small";
  saveBtn.textContent = "Save";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn ghost small";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    renderWorkoutDetailData(container, workout, sets, segments, linkedActivity, { onSaved });
  });
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      await saveWorkoutEdits(workout, state);
      if (onSaved) onSaved();
    } catch (e) {
      alert(`Couldn't save: ${e.message}`);
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  });
  footer.append(saveBtn, cancelBtn);
  container.appendChild(footer);
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

// Push/Pull get a combined total row plus their vertical/horizontal
// children right underneath; Squat/Hinge/Lunge stay as plain standalone
// rows. Top-level items (groups + standalone) are ranked together by
// volume; each group's children are ranked among themselves.
function buildMovementRows(movementTotals) {
  const groupedKeys = new Set(MOVEMENT_GROUPS.flatMap((g) => g.members));
  const topLevel = [];

  MOVEMENT_GROUPS.forEach((g) => {
    const total = g.members.reduce((sum, k) => sum + (movementTotals[k] || 0), 0);
    if (total > 0) topLevel.push({ type: "group", key: g.key, label: g.label, value: round(total), members: g.members });
  });
  MOVEMENTS.forEach((m) => {
    if (groupedKeys.has(m.key)) return;
    if (movementTotals[m.key] > 0) topLevel.push({ type: "single", key: m.key, label: MOVEMENT_LABEL[m.key], value: round(movementTotals[m.key]) });
  });
  topLevel.sort((a, b) => b.value - a.value);

  const rows = [];
  topLevel.forEach((item) => {
    rows.push({ key: item.key, label: item.label, value: item.value, isGroup: item.type === "group" });
    if (item.type === "group") {
      item.members
        .filter((k) => movementTotals[k] > 0)
        .sort((a, b) => movementTotals[b] - movementTotals[a])
        .forEach((k) => rows.push({ key: k, label: MOVEMENT_LABEL[k], value: round(movementTotals[k]), isChild: true }));
    }
  });
  return rows;
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

  const movementRows = buildMovementRows(movementTotals);

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

// One point per session, using that session's best set by estimated 1RM
// (matches FitLog's own progress view). Skips sessions with no weight data
// at all (bodyweight/time-based exercises), and renders nothing if none of
// the sessions have weight data.
function renderProgressSection(container, sessions) {
  const points = [];
  [...sessions]
    .sort((a, b) => new Date(a.workout.date) - new Date(b.workout.date))
    .forEach(({ workout, sets }) => {
      let best = null;
      sets.forEach((s) => {
        if (s.weight == null) return;
        const oneRM = epley1RM(s.weight, s.reps || 1);
        if (!best || oneRM > best.oneRM) best = { oneRM, weight: s.weight, reps: s.reps };
      });
      if (best) {
        points.push({
          date: new Date(workout.date),
          value: Math.round(best.oneRM),
          topWeight: best.weight,
          label: new Date(workout.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        });
      }
    });

  if (!points.length) return; // bodyweight/time-based exercise -- no weight to chart

  let runningMax = -Infinity;
  points.forEach((p) => {
    p.isPR = p.value > runningMax;
    if (p.isPR) runningMax = p.value;
  });

  const maxWeight = Math.max(...points.map((p) => p.topWeight));
  const best1RM = Math.max(...points.map((p) => p.value));

  const cards = document.createElement("div");
  cards.className = "pr-cards";
  cards.innerHTML = `
    <div class="pr-card"><div class="pr-label">Max Weight</div><div class="pr-value">${maxWeight} lb</div></div>
    <div class="pr-card"><div class="pr-label">Best Est. 1RM</div><div class="pr-value">${best1RM} lb</div></div>
    <div class="pr-card"><div class="pr-label">Sessions</div><div class="pr-value">${points.length}</div></div>
  `;
  container.appendChild(cards);

  const chartCard = document.createElement("div");
  chartCard.className = "chart-card";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "progress-svg");
  svg.setAttribute("viewBox", "0 0 600 220");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  chartCard.appendChild(svg);
  container.appendChild(chartCard);
  renderProgressChart(svg, points, { yLabel: "lb (est. 1RM)" });
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

  renderProgressSection(container, sessions);

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

// Accepts either a single movement key ("verticalPush") or one of
// MOVEMENT_GROUPS's pseudo-keys ("push"), in which case it aggregates
// across that group's members (vertical + horizontal push).
export function renderMovementDetail(container, movementKeyOrGroup, onOpenExercise) {
  const group = MOVEMENT_GROUPS.find((g) => g.key === movementKeyOrGroup);
  const keys = group ? group.members : [movementKeyOrGroup];
  const label = group ? group.label : MOVEMENT_LABEL[movementKeyOrGroup] || movementKeyOrGroup;

  container.innerHTML = "";
  const header = document.createElement("div");
  header.className = "workout-detail-header";
  header.innerHTML = `<h4>${esc(label)}</h4>`;
  container.appendChild(header);

  const totals = new Map(); // exercise_name -> sets
  for (const sets of cache.setsByWorkout.values()) {
    sets.forEach((s) => {
      if (s.is_warmup) return;
      if (!keys.includes(resolveExerciseMeta(s.exercise_name).movement)) return;
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

// ---------- All-time PRs (independent of the dashboard's date-range selector) ----------
let allTimeCache = null; // Map<exerciseName, {oneRM, weight, reps, date}>

export async function loadAllTimePRs() {
  const { data: workouts, error: wErr } = await supabase.from("fitlog_workouts").select("id, date").eq("type", "strength");
  if (wErr) throw wErr;

  const dateByWorkout = new Map((workouts || []).map((w) => [w.id, w.date]));
  const ids = [...dateByWorkout.keys()];
  const best = new Map();

  if (ids.length) {
    const { data: sets, error: sErr } = await supabase
      .from("fitlog_sets")
      .select("workout_id, exercise_name, reps, weight, is_warmup")
      .in("workout_id", ids);
    if (sErr) throw sErr;

    (sets || []).forEach((s) => {
      if (s.is_warmup || s.weight == null) return;
      const oneRM = epley1RM(s.weight, s.reps || 1);
      const cur = best.get(s.exercise_name);
      if (!cur || oneRM > cur.oneRM) {
        best.set(s.exercise_name, { oneRM, weight: s.weight, reps: s.reps, date: dateByWorkout.get(s.workout_id) });
      }
    });
  }

  allTimeCache = best;
  return best;
}

export function getAllExerciseNames() {
  return allTimeCache ? [...allTimeCache.keys()].sort((a, b) => a.localeCompare(b)) : [];
}

export function renderPRBoard(container, onOpenExercise) {
  container.innerHTML = "";
  if (!allTimeCache || !allTimeCache.size) {
    container.appendChild(emptyNote("No strength data yet."));
    return;
  }
  const rows = [...allTimeCache.entries()].sort((a, b) => b[1].oneRM - a[1].oneRM);
  rows.forEach(([name, pr]) => {
    const dateLabel = pr.date ? new Date(pr.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
    const row = document.createElement("button");
    row.type = "button";
    row.className = "workout-row";
    row.innerHTML = `
      <span class="workout-row-date">${esc(dateLabel)}</span>
      <span class="workout-row-main">
        <span class="workout-row-name">${esc(name)}</span>
        <span class="workout-row-sub">${pr.weight} lb × ${pr.reps} · est. 1RM ${Math.round(pr.oneRM)} lb</span>
      </span>
    `;
    row.addEventListener("click", () => onOpenExercise(name));
    container.appendChild(row);
  });
}

// ---------- Training Emphasis: Strength / Athleticism / Cardio ----------
// Deliberately three numbers in their own native units (sets / weighted
// score / minutes) rather than one normalized chart -- see the reasoning
// discussed with the user: forcing cardio minutes onto a "sets" scale (or
// vice versa) would be more misleading than honest.
export async function loadTrainingEmphasis(start, end) {
  let strengthSets = 0;
  let athleticismScore = 0;
  let cardioMinutes = 0;

  for (const sets of cache.setsByWorkout.values()) {
    sets.forEach((s) => {
      if (s.is_warmup) return;
      strengthSets += 1;
      athleticismScore += resolveExerciseMeta(s.exercise_name).athleticism || 0;
    });
  }
  for (const segments of cache.segmentsByWorkout.values()) {
    segments.forEach((seg) => {
      if (seg.duration_min != null) cardioMinutes += seg.duration_min;
    });
  }

  const { data, error } = await supabase
    .from("garmin_activities")
    .select("duration_seconds")
    .gte("start_time", start.toISOString())
    .lte("start_time", end.toISOString());
  if (!error) {
    cardioMinutes += (data || []).reduce((sum, a) => sum + (a.duration_seconds || 0) / 60, 0);
  }

  return {
    strengthSets: Math.round(strengthSets),
    athleticismScore: Math.round(athleticismScore * 10) / 10,
    cardioMinutes: Math.round(cardioMinutes),
  };
}

export function renderTrainingEmphasis(container, { strengthSets, athleticismScore, cardioMinutes }) {
  container.innerHTML = `
    <div class="stat-row emphasis-row">
      <div class="stat-tile">
        <div class="stat-label">Strength</div>
        <div class="stat-value">${strengthSets}</div>
        <div class="stat-sub">working sets</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Athleticism</div>
        <div class="stat-value">${athleticismScore}</div>
        <div class="stat-sub">weighted score</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Cardio</div>
        <div class="stat-value">${cardioMinutes}</div>
        <div class="stat-sub">minutes</div>
      </div>
    </div>
    <p class="muted small">Athleticism weights each set by movement: isolation work counts 0, compound lifts ~0.2–0.4/set, explosive or power work (jumps, throws, Olympic lifts) 1.0–2.0/set.</p>
  `;
}

// ---------- Joint Load: Low Back / Knees / Shoulders ----------
// A fatigue-management signal, not a volume metric -- each set contributes
// (set count x that exercise's jointLoad weight for the joint), same
// modeling approach as muscle/movement volume. Shown as selected-range vs
// the immediately preceding period of equal length, same "current vs
// prior" comparison already used for the health metrics.
function tallyJointLoad(setsByWorkout) {
  const totals = Object.fromEntries(JOINTS.map((j) => [j.key, 0]));
  for (const sets of setsByWorkout.values()) {
    sets.forEach((s) => {
      if (s.is_warmup) return;
      Object.entries(resolveExerciseMeta(s.exercise_name).jointLoad || {}).forEach(([joint, load]) => {
        totals[joint] = (totals[joint] || 0) + load;
      });
    });
  }
  return totals;
}

export async function loadJointLoad(start, end) {
  const current = tallyJointLoad(cache.setsByWorkout);

  const rangeMs = end.getTime() - start.getTime();
  const prevStart = new Date(start.getTime() - rangeMs);
  const prevEnd = new Date(start.getTime());
  const prev = Object.fromEntries(JOINTS.map((j) => [j.key, 0]));

  const { data: prevWorkouts, error: wErr } = await supabase
    .from("fitlog_workouts")
    .select("id")
    .gte("date", prevStart.toISOString())
    .lt("date", prevEnd.toISOString());
  if (!wErr && prevWorkouts?.length) {
    const { data: prevSets, error: sErr } = await supabase
      .from("fitlog_sets")
      .select("exercise_name, is_warmup")
      .in(
        "workout_id",
        prevWorkouts.map((w) => w.id)
      );
    if (!sErr) {
      (prevSets || []).forEach((s) => {
        if (s.is_warmup) return;
        Object.entries(resolveExerciseMeta(s.exercise_name).jointLoad || {}).forEach(([joint, load]) => {
          prev[joint] = (prev[joint] || 0) + load;
        });
      });
    }
  }

  return { current, prev };
}

function jointDeltaText(current, prev) {
  if (!current && !prev) return "no load logged";
  if (!prev) return "new this period";
  const pct = Math.round(((current - prev) / prev) * 100);
  if (pct === 0) return "same as prior period";
  return `${pct > 0 ? "+" : ""}${pct}% vs prior period`;
}

export function renderJointLoad(container, { current, prev }) {
  container.innerHTML = `
    <div class="stat-row emphasis-row">
      ${JOINTS.map((j) => {
        const val = Math.round(current[j.key] * 10) / 10;
        return `<div class="stat-tile">
          <div class="stat-label">${esc(j.label)}</div>
          <div class="stat-value">${val}</div>
          <div class="stat-sub">${jointDeltaText(current[j.key], prev[j.key])}</div>
        </div>`;
      }).join("")}
    </div>
    <p class="muted small">Sets in the selected range weighted by how much each exercise loads that joint, compared to the same-length period right before it -- a fatigue signal, not a score to chase.</p>
  `;
}
