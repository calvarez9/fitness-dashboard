// ---------- Individual workouts + exercise/movement/muscle stats ----------
import { supabase } from "./supabaseClient.js";
import { resolveExerciseMeta, MUSCLES, MUSCLE_LABEL, MUSCLE_GROUPS, MOVEMENTS_IN_VOLUME, MOVEMENT_LABEL, MOVEMENT_GROUPS, JOINTS, JOINT_LABEL } from "./exerciseLibrary.js";
import { renderBarList, renderProgressChart } from "./charts.js";
import { renderBodyMaps, applyVolumeColors } from "./bodyMap.js";

// Standard Epley estimated-1RM formula, matching FitLog's own progress view.
function epley1RM(weight, reps) {
  if (!weight || !reps) return 0;
  return weight * (1 + reps / 30);
}

let cache = { workouts: [], setsByWorkout: new Map(), segmentsByWorkout: new Map(), linkedActivityByWorkout: new Map(), garminOnly: [] };

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
        .select(
          "fitlog_workout_id, garmin_activities(id, activity_name, activity_type, duration_seconds, avg_hr, max_hr, calories, hr_zone_1_seconds, hr_zone_2_seconds, hr_zone_3_seconds, hr_zone_4_seconds, hr_zone_5_seconds)"
        )
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

  // Garmin-tracked cardio (runs, rows, walks, etc.) that was never logged
  // in FitLog at all -- these have no fitlog_workouts row and so were
  // previously invisible outside the aggregate charts. Anything already
  // linked to a FitLog workout above is excluded here so it isn't shown
  // twice (once as the logged workout, once as its own entry).
  const garminOnly = await loadUnlinkedGarminActivities(start, end);

  cache = { workouts: workouts || [], setsByWorkout, segmentsByWorkout, linkedActivityByWorkout, garminOnly };
  return cache;
}

async function loadUnlinkedGarminActivities(start, end) {
  const { data: activities, error } = await supabase
    .from("garmin_activities")
    .select(
      "id, activity_name, activity_type, start_time, duration_seconds, distance_meters, avg_hr, max_hr, calories, activity_training_load, aerobic_training_effect, anaerobic_training_effect, training_effect_label"
    )
    .neq("activity_type", "strength_training")
    .gte("start_time", start.toISOString())
    .lte("start_time", end.toISOString())
    .order("start_time", { ascending: false });
  if (error || !activities?.length) return [];

  const { data: linkRows } = await supabase
    .from("workout_links")
    .select("garmin_activity_id")
    .in(
      "garmin_activity_id",
      activities.map((a) => a.id)
    )
    .then(
      (r) => r,
      () => ({ data: [] })
    );
  const linkedIds = new Set((linkRows || []).map((l) => l.garmin_activity_id));
  return activities.filter((a) => !linkedIds.has(a.id));
}

// A FitLog workout "trains" a muscle/movement if any of its non-warmup
// sets' resolved exercise meta says so -- Garmin-only rows have no
// exercise data at all, so they never match either filter and are
// dropped from the list whenever one is active (nothing to filter them
// by otherwise).
function workoutMatchesFilter(workoutId, { muscle, movement }) {
  if (!muscle && !movement) return true;
  const sets = cache.setsByWorkout.get(workoutId) || [];
  return sets.some((s) => {
    if (s.is_warmup) return false;
    const meta = resolveExerciseMeta(s.exercise_name);
    if (muscle && !(meta.muscles || {})[muscle]) return false;
    if (movement && meta.movement !== movement) return false;
    return true;
  });
}

// ---------- Workout list + detail ----------
// onOpen(id): a logged FitLog workout was clicked.
// onOpenGarmin(id): a Garmin-only activity (no FitLog entry at all) was
// clicked -- kept as a separate callback since it opens a different,
// read-only detail view rather than the editable workout one.
// filter: { muscle?: muscleKey, movement?: movementKey } -- both optional,
// AND'd together when both are set.
export function renderWorkoutsList(container, onOpen, onOpenGarmin, filter = {}) {
  container.innerHTML = "";
  const hasFilter = !!(filter.muscle || filter.movement);
  const fitlogRows = cache.workouts
    .filter((w) => workoutMatchesFilter(w.id, filter))
    .map((w) => ({ kind: "fitlog", date: new Date(w.date), workout: w }));
  const garminRows = hasFilter
    ? []
    : cache.garminOnly.map((a) => ({ kind: "garmin", date: new Date(a.start_time), activity: a }));
  const combined = [...fitlogRows, ...garminRows].sort((a, b) => b.date - a.date);

  if (!combined.length) {
    container.appendChild(emptyNote(hasFilter ? "No workouts match that filter in range." : "No workouts in range yet."));
    return;
  }

  combined.forEach((entry) => {
    if (entry.kind === "fitlog") {
      container.appendChild(renderFitlogRow(entry.workout, onOpen));
    } else {
      container.appendChild(renderGarminRow(entry.activity, onOpenGarmin));
    }
  });
}

function renderFitlogRow(w, onOpen) {
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
  return row;
}

// A Garmin activity with no FitLog entry at all -- not editable here (there's
// no fitlog_workouts row to edit), just a read-only view of what Garmin
// recorded. Log it in FitLog instead if you want to add notes/edit it.
function renderGarminRow(a, onOpenGarmin) {
  const dateLabel = new Date(a.start_time).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const bits = [];
  if (a.duration_seconds != null) bits.push(`${Math.round(a.duration_seconds / 60)} min`);
  if (a.distance_meters) bits.push(`${(a.distance_meters * 0.000621371).toFixed(1)} mi`);
  if (a.avg_hr != null) bits.push(`${a.avg_hr} avg hr`);

  const row = document.createElement("button");
  row.type = "button";
  row.className = "workout-row";
  row.innerHTML = `
    <span class="workout-row-date">${dateLabel}</span>
    <span class="workout-row-main">
      <span class="workout-row-name">${esc(a.activity_name || a.activity_type)} <span class="linked-badge" title="Garmin-tracked, not logged in FitLog">⌚</span></span>
      <span class="workout-row-sub">${esc(bits.join(" · "))}</span>
    </span>
    <span class="workout-type-badge cardio">cardio</span>
  `;
  row.addEventListener("click", () => onOpenGarmin(a.id));
  return row;
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

// Read-only detail for a Garmin activity that has no FitLog workout behind
// it at all -- no edit/delete, since there's nothing here to edit; log it
// in FitLog if you want notes or the ability to change it.
export async function renderGarminActivityDetail(container, activityId) {
  container.innerHTML = "";
  let a = cache.garminOnly.find((x) => x.id === activityId);
  if (!a) {
    const { data } = await supabase.from("garmin_activities").select("*").eq("id", activityId).maybeSingle();
    a = data;
  }
  if (!a) {
    container.appendChild(emptyNote("Activity not found."));
    return;
  }

  const dateLabel = new Date(a.start_time).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const header = document.createElement("div");
  header.className = "workout-detail-header";
  header.innerHTML = `<h4>${esc(a.activity_name || a.activity_type)}</h4><p class="muted small">${esc(dateLabel)} · ⌚ Garmin-tracked, not logged in FitLog</p>`;
  container.appendChild(header);

  const bits = [];
  if (a.duration_seconds != null) bits.push(`${Math.round(a.duration_seconds / 60)} min`);
  if (a.distance_meters) bits.push(`${(a.distance_meters * 0.000621371).toFixed(2)} mi`);
  if (a.calories != null) bits.push(`${a.calories} cal`);
  if (a.avg_hr != null) bits.push(`${a.avg_hr} avg hr`);
  if (a.max_hr != null) bits.push(`${a.max_hr} max hr`);
  if (a.activity_training_load != null) bits.push(`${Math.round(a.activity_training_load)} training load`);
  if (bits.length) {
    const statsEl = document.createElement("p");
    statsEl.className = "muted small";
    statsEl.textContent = bits.join(" · ");
    container.appendChild(statsEl);
  }

  if (a.training_effect_label) {
    const effect = document.createElement("p");
    effect.className = "muted small";
    const aerobic = a.aerobic_training_effect != null ? `aerobic ${a.aerobic_training_effect.toFixed(1)}` : null;
    const anaerobic = a.anaerobic_training_effect != null ? `anaerobic ${a.anaerobic_training_effect.toFixed(1)}` : null;
    effect.textContent = `${a.training_effect_label.replaceAll("_", " ")}${aerobic || anaerobic ? ` (${[aerobic, anaerobic].filter(Boolean).join(", ")})` : ""}`;
    container.appendChild(effect);
  }

  const zones = [1, 2, 3, 4, 5].map((n) => ({ n, seconds: a[`hr_zone_${n}_seconds`] || 0 }));
  if (zones.some((z) => z.seconds > 0)) {
    const zoneWrap = document.createElement("div");
    zoneWrap.className = "sleep-stages";
    zoneWrap.style.marginTop = "10px";
    container.appendChild(zoneWrap);
    renderCardioZones(zoneWrap, zones);
  }
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

    const zones = [1, 2, 3, 4, 5].map((n) => ({ n, seconds: linkedActivity[`hr_zone_${n}_seconds`] || 0 }));
    if (zones.some((z) => z.seconds > 0)) {
      const zoneWrap = document.createElement("div");
      zoneWrap.className = "sleep-stages";
      zoneWrap.style.marginTop = "6px";
      container.appendChild(zoneWrap);
      renderCardioZones(zoneWrap, zones);
    }
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

  // Where this one session's work went -- same figure/coloring as the
  // aggregate Muscle Volume view, just scoped to this workout's own sets
  // instead of the whole selected range.
  const muscleTotals = Object.fromEntries(MUSCLES.map((m) => [m.key, 0]));
  sets.forEach((s) => {
    if (s.is_warmup) return;
    Object.entries(resolveExerciseMeta(s.exercise_name).muscles || {}).forEach(([muscle, frac]) => {
      muscleTotals[muscle] = (muscleTotals[muscle] || 0) + frac;
    });
  });
  if (Object.values(muscleTotals).some((v) => v > 0)) {
    const bodyMapWrap = document.createElement("div");
    bodyMapWrap.className = "bodymap-row workout-detail-bodymap";
    bodyMapWrap.innerHTML = `
      <figure class="bodymap-figure"><svg viewBox="0 0 724 1448"></svg><figcaption>Front</figcaption></figure>
      <figure class="bodymap-figure"><svg viewBox="724 0 724 1448"></svg><figcaption>Back</figcaption></figure>
    `;
    container.appendChild(bodyMapWrap);
    const [frontSvg, backSvg] = bodyMapWrap.querySelectorAll("svg");
    renderBodyMaps(frontSvg, backSvg);
    applyVolumeColors(frontSvg, backSvg, muscleTotals);
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
    const metricType = resolveExerciseMeta(name).metricType || "weighted";
    const rowsHtml = exSets
      .map((s) => {
        const parts = [];
        // Isometric/Loaded Carry sets carry a duration instead of (or
        // alongside) weight/reps -- shown by whichever fields are actually
        // present rather than assuming weight x reps for every type.
        if (metricType === "isometric") {
          if (s.duration != null) parts.push(`${s.duration}s`);
        } else {
          if (s.weight != null) parts.push(`${s.weight} lb`);
          if (s.reps != null) parts.push(`${s.reps} reps`);
          if (s.duration != null) parts.push(`${s.duration}s`);
        }
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
  MOVEMENTS_IN_VOLUME.forEach((m) => {
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

// Sub-muscles in a MUSCLE_GROUPS entry (e.g. upper/middle/lower traps) roll
// up into one parent row here -- the split itself is only shown in the
// click-through detail (renderMuscleDetail), not the main list.
function buildMuscleRows(muscleTotals) {
  const groupedKeys = new Set(MUSCLE_GROUPS.flatMap((g) => g.members));
  const rows = [];
  MUSCLE_GROUPS.forEach((g) => {
    const total = g.members.reduce((sum, k) => sum + (muscleTotals[k] || 0), 0);
    if (total > 0) rows.push({ key: g.key, label: g.label, value: round(total) });
  });
  MUSCLES.forEach((m) => {
    if (groupedKeys.has(m.key)) return;
    if (muscleTotals[m.key] > 0) rows.push({ key: m.key, label: m.label, value: round(muscleTotals[m.key]) });
  });
  return rows.sort((a, b) => b.value - a.value);
}

export function computeMovementMuscleStats() {
  const movementTotals = Object.fromEntries(MOVEMENTS_IN_VOLUME.map((m) => [m.key, 0]));
  const muscleTotals = Object.fromEntries(MUSCLES.map((m) => [m.key, 0]));
  const unmatched = new Set();

  for (const sets of cache.setsByWorkout.values()) {
    sets.forEach((s) => {
      if (s.is_warmup) return;
      const meta = resolveExerciseMeta(s.exercise_name);
      if (!meta.matched) unmatched.add(s.exercise_name);
      // Isolation is a valid tag but deliberately excluded from Movement
      // Pattern Volume -- see MOVEMENTS_IN_VOLUME in exerciseLibrary.js.
      if (meta.movement !== "isolation") {
        movementTotals[meta.movement] = (movementTotals[meta.movement] || 0) + 1;
      }
      Object.entries(meta.muscles || {}).forEach(([muscle, frac]) => {
        muscleTotals[muscle] = (muscleTotals[muscle] || 0) + frac;
      });
    });
  }

  const movementRows = buildMovementRows(movementTotals);

  const muscleRows = buildMuscleRows(muscleTotals);

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

  const metricType = resolveExerciseMeta(exerciseName).metricType || "weighted";
  sessions.forEach(({ workout, sets }) => {
    const dateLabel = new Date(workout.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const setSummary = sets
      .map((s) => {
        if (metricType === "isometric") return s.duration != null ? `${s.duration}s` : "—";
        const parts = [];
        if (s.weight != null) parts.push(`${s.weight}`);
        if (s.reps != null) parts.push(`×${s.reps}`);
        if (s.duration != null) parts.push(`${s.duration}s`);
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

// muscleKey may be a real muscle (e.g. "biceps") or a MUSCLE_GROUPS parent
// key (e.g. "traps") -- for a group, this is the "on demand" reveal the
// main list deliberately doesn't show by default: a small upper/middle/
// lower breakdown first, then the usual exercise-contribution list below
// it (credited against whichever sub-muscle each exercise actually hits).
export function renderMuscleDetail(container, muscleKey, onOpenExercise) {
  container.innerHTML = "";
  const group = MUSCLE_GROUPS.find((g) => g.key === muscleKey);
  const memberKeys = group ? group.members : [muscleKey];

  const header = document.createElement("div");
  header.className = "workout-detail-header";
  header.innerHTML = `<h4>${esc(group ? group.label : MUSCLE_LABEL[muscleKey] || muscleKey)}</h4>`;
  container.appendChild(header);

  if (group) {
    const subTotals = Object.fromEntries(memberKeys.map((k) => [k, 0]));
    for (const sets of cache.setsByWorkout.values()) {
      sets.forEach((s) => {
        if (s.is_warmup) return;
        const meta = resolveExerciseMeta(s.exercise_name);
        memberKeys.forEach((k) => {
          const frac = (meta.muscles || {})[k];
          if (frac) subTotals[k] += frac;
        });
      });
    }
    const subRows = memberKeys
      .map((k) => ({ label: MUSCLE_LABEL[k] || k, value: round(subTotals[k]) }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);
    if (subRows.length) {
      const subList = document.createElement("div");
      subList.className = "bar-list";
      container.appendChild(subList);
      renderBarList(subList, subRows);
    }
  }

  const totals = new Map(); // exercise_name -> fraction-weighted credited sets
  for (const sets of cache.setsByWorkout.values()) {
    sets.forEach((s) => {
      if (s.is_warmup) return;
      const meta = resolveExerciseMeta(s.exercise_name);
      const frac = Math.max(0, ...memberKeys.map((k) => (meta.muscles || {})[k] || 0));
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

// A Garmin-auto-detected "Strength" activity duplicates what's already
// counted via logged sets above -- excluded here (and from the cardio zone
// breakdown below) so it doesn't also inflate cardio numbers.
const NON_CARDIO_ACTIVITY_TYPES = new Set(["strength_training"]);

// Per-activity hr_zone_1..5_seconds turned out to be populated on maybe 1
// in 10 real activities -- Garmin just doesn't return that granular
// breakdown for most sessions, regardless of type. avg_hr/max_hr, by
// contrast, are on essentially every activity, so effort is classified
// from those instead: each activity's avg_hr is compared against an
// estimated personal max HR (the highest max_hr Garmin has ever recorded
// for this account, across all activities -- self-calibrating, no age or
// manual config needed) using the standard %HRmax zone bands, and the
// activity's *entire* duration is credited to whichever single zone its
// average effort falls into. Coarser than true continuous zone tracking,
// but it actually has data for every session instead of being right on
// one activity in ten and silently wrong (reading as zero effort) on the
// rest.
let cachedEstimatedMaxHR = null;
async function getEstimatedMaxHR() {
  if (cachedEstimatedMaxHR) return cachedEstimatedMaxHR;
  const { data, error } = await supabase.from("garmin_activities").select("max_hr").not("max_hr", "is", null).order("max_hr", { ascending: false }).limit(1);
  cachedEstimatedMaxHR = !error && data?.length ? data[0].max_hr : 190; // generic fallback if this account somehow has no HR data at all yet
  return cachedEstimatedMaxHR;
}

// Standard 5-zone %HRmax bands. Returns 0 (no credit) below zone 1.
function classifyZone(avgHr, maxHR) {
  if (!avgHr || !maxHR) return 0;
  const pct = avgHr / maxHR;
  if (pct >= 0.9) return 5;
  if (pct >= 0.8) return 4;
  if (pct >= 0.7) return 3;
  if (pct >= 0.6) return 2;
  if (pct >= 0.5) return 1;
  return 0;
}

// Garmin's own moderate/vigorous formula (zone 3 = moderate = 1x, zones
// 4-5 = vigorous = 2x), applied to whichever data is actually available:
// real per-second zone data when present (accurate), or the activity's
// avg_hr classified as a single zone for its whole duration when it's
// not (coarser, but real for every activity instead of only some).
function activityIntensityMinutes(activity, durationMin, estimatedMaxHR) {
  // Presence, not magnitude -- a real fetch can legitimately come back all
  // zeros (an activity spent entirely in zones 1-2), which must still be
  // read as "real data, zero moderate/vigorous time," not as "missing."
  const hasRealZoneData = activity.hr_zone_3_seconds != null;
  if (hasRealZoneData) {
    const moderateMin = (activity.hr_zone_3_seconds || 0) / 60;
    const vigorousMin = ((activity.hr_zone_4_seconds || 0) + (activity.hr_zone_5_seconds || 0)) / 60;
    return moderateMin + 2 * vigorousMin;
  }
  const zone = classifyZone(activity.avg_hr, estimatedMaxHR);
  return zone >= 4 ? durationMin * 2 : zone === 3 ? durationMin : 0;
}

// ---------- Training Emphasis: Strength / Athleticism / Cardio ----------
// Deliberately three numbers in their own native units rather than one
// normalized chart -- see the reasoning discussed with the user: forcing
// cardio onto a "sets" scale (or vice versa) would be more misleading than
// honest. Athleticism is credited sets, not a free-floating score: an
// isolation set counts 0, a compound lift counts as a fraction of a set
// (0.2-0.5, see exerciseLibrary.js), a genuinely explosive/power movement
// counts as a full set -- the same "credited sets" model Muscle Volume
// already uses (primary muscle = 1, secondary = 0.5), just applied to
// athletic quality instead of muscle engagement, and folded into one
// number rather than split into a separate Explosive count next to it.
// Cardio Intensity Minutes is Garmin's own published metric (moderate
// minutes + 2x vigorous minutes) -- a real, externally-defined unit
// (WHO's guidance is framed in these same minutes), not something we
// invented.
export async function loadTrainingEmphasis(start, end) {
  let strengthSets = 0;
  let athleticismSets = 0;
  let cardioMinutes = 0;

  for (const sets of cache.setsByWorkout.values()) {
    sets.forEach((s) => {
      if (s.is_warmup) return;
      strengthSets += 1;
      athleticismSets += resolveExerciseMeta(s.exercise_name).athleticism || 0;
    });
  }
  for (const segments of cache.segmentsByWorkout.values()) {
    segments.forEach((seg) => {
      if (seg.duration_min != null) cardioMinutes += seg.duration_min;
    });
  }

  // Garmin's own garmin_daily_stats.intensity_minutes is a *whole-day*
  // total that can't be filtered by activity type. Real per-activity
  // hr_zone_*_seconds is now fetched properly at sync time (see
  // sync/garmin_sync.py's fetch_hr_zones) and is used here when present;
  // avg_hr-based classification (see classifyZone above) is only a
  // fallback for activities synced before that fix, or on the rare fetch
  // failure -- avg_hr is reliably present on nearly everything, real zone
  // seconds are not (yet).
  const [estimatedMaxHR, activitiesRes] = await Promise.all([
    getEstimatedMaxHR(),
    supabase
      .from("garmin_activities")
      .select("activity_name, activity_type, duration_seconds, avg_hr, hr_zone_3_seconds, hr_zone_4_seconds, hr_zone_5_seconds")
      .gte("start_time", start.toISOString())
      .lte("start_time", end.toISOString()),
  ]);
  const { data: activities, error: activitiesErr } = activitiesRes;

  // Every non-strength activity, with both its raw duration and its
  // classified intensity contribution -- kept for the click-through
  // detail even at 0 intensity minutes, so an easy walk shows up
  // *explaining* why it added lots of duration but no intensity, instead
  // of just disappearing and leaving the gap between the two numbers
  // looking unexplained.
  const cardioActivityBreakdown = [];
  if (!activitiesErr) {
    (activities || [])
      .filter((a) => !NON_CARDIO_ACTIVITY_TYPES.has(a.activity_type))
      .forEach((a) => {
        const durationMin = (a.duration_seconds || 0) / 60;
        cardioMinutes += durationMin;
        const intensityMin = activityIntensityMinutes(a, durationMin, estimatedMaxHR);
        cardioActivityBreakdown.push({ label: a.activity_name || a.activity_type, durationMin, intensityMin });
      });
  }
  cache.cardioActivityBreakdown = cardioActivityBreakdown; // for the click-through detail, avoids a second fetch
  const cardioIntensityMinutes = cardioActivityBreakdown.reduce((sum, a) => sum + a.intensityMin, 0);

  return {
    strengthSets: Math.round(strengthSets),
    athleticismSets: Math.round(athleticismSets * 10) / 10,
    cardioMinutes: Math.round(cardioMinutes),
    cardioIntensityMinutes: Math.round(cardioIntensityMinutes),
  };
}

export function renderTrainingEmphasis(container, { strengthSets, athleticismSets, cardioIntensityMinutes }, onOpen) {
  container.innerHTML = `
    <div class="stat-row emphasis-row">
      <button type="button" class="stat-tile stat-tile-clickable" data-emphasis="strength">
        <div class="stat-label">Strength</div>
        <div class="stat-value">${strengthSets}</div>
        <div class="stat-sub">working sets</div>
      </button>
      <button type="button" class="stat-tile stat-tile-clickable" data-emphasis="athleticism">
        <div class="stat-label">Athleticism</div>
        <div class="stat-value">${athleticismSets}</div>
        <div class="stat-sub">credited sets</div>
      </button>
      <button type="button" class="stat-tile stat-tile-clickable" data-emphasis="cardio">
        <div class="stat-label">Cardio</div>
        <div class="stat-value">${cardioIntensityMinutes}</div>
        <div class="stat-sub">intensity min</div>
      </button>
    </div>
    <p class="muted small">Athleticism credits each set like a working set, just scaled: isolation work 0, compound lifts 0.2–0.5 of a set, explosive/power movements a full set. Cardio Intensity Minutes is Garmin's own metric (moderate + 2× vigorous minutes) -- the same framing WHO's guidelines use. Tap any of these to see what's contributing.</p>
  `;
  if (onOpen) {
    container.querySelectorAll("[data-emphasis]").forEach((btn) => {
      btn.addEventListener("click", () => onOpen(btn.dataset.emphasis));
    });
  }
}

// Shared by the Strength/Explosive drill-downs -- same "which exercises are
// contributing, and how much" breakdown as Movement/Muscle/Joint Load.
function renderSetCountDetail(container, title, subtitle, creditFn, onOpenExercise) {
  container.innerHTML = "";
  const header = document.createElement("div");
  header.className = "workout-detail-header";
  header.innerHTML = `<h4>${esc(title)}</h4>${subtitle ? `<p class="muted small">${esc(subtitle)}</p>` : ""}`;
  container.appendChild(header);

  // creditFn returns a number per set (0/falsy = excluded) -- 1 for a
  // plain count (Strength, Explosive), the actual tagged value for a
  // weighted sum (Athleticism).
  const totals = new Map(); // exercise_name -> summed credit
  for (const sets of cache.setsByWorkout.values()) {
    sets.forEach((s) => {
      if (s.is_warmup) return;
      const credit = creditFn(resolveExerciseMeta(s.exercise_name));
      if (!credit) return;
      totals.set(s.exercise_name, (totals.get(s.exercise_name) || 0) + credit);
    });
  }

  const rows = [...totals.entries()].map(([name, val]) => ({ label: name, value: Math.round(val * 10) / 10 })).sort((a, b) => b.value - a.value);
  if (!rows.length) {
    container.appendChild(emptyNote("No sets in range."));
    return;
  }

  const list = document.createElement("div");
  list.className = "bar-list";
  container.appendChild(list);
  renderBarList(list, rows, { onClick: (r) => onOpenExercise(r.label) });
}

export function renderStrengthEmphasisDetail(container, onOpenExercise) {
  renderSetCountDetail(container, "Strength — Working Sets", null, () => 1, onOpenExercise);
}

export function renderAthleticismDetail(container, onOpenExercise) {
  renderSetCountDetail(
    container,
    "Athleticism — Credited Sets",
    "Each set counted like a working set, just scaled: isolation 0, compound lifts 0.2–0.5 of a set, explosive/power movements a full set.",
    (meta) => meta.athleticism || 0,
    onOpenExercise
  );
}

// Breakdown by activity (not exercise -- there's no FitLog exercise to
// click into here) -- reads straight from the cache loadTrainingEmphasis
// already populated, same "reuse what's already loaded" approach as the
// other detail views. Lists *every* cardio activity, not just the ones
// that contributed intensity minutes -- an easy zone-1/2 walk shows here
// too, at 0 intensity, so the gap between "1885 min total" and a much
// smaller intensity-minutes number is visible and explained instead of
// looking like a bug (a light walk genuinely doesn't count as WHO's
// "moderate" or "vigorous" activity, only the harder sessions do).
export function renderCardioIntensityDetail(container) {
  container.innerHTML = "";
  const header = document.createElement("div");
  header.className = "workout-detail-header";
  header.innerHTML = `<h4>Cardio — Intensity Minutes</h4><p class="muted small">Every cardio activity in range: duration vs. its intensity contribution (moderate-effort minutes + 2× vigorous-effort minutes, from real HR-zone data when Garmin has it, estimated from average heart rate otherwise). Low-effort time (an easy walk, say) adds duration but little or no intensity -- that's expected, not a bug.</p>`;
  container.appendChild(header);

  const activities = cache.cardioActivityBreakdown || [];
  if (!activities.length) {
    container.appendChild(emptyNote("No cardio activity in range."));
    return;
  }

  const sorted = [...activities].sort((a, b) => b.durationMin - a.durationMin);
  const list = document.createElement("div");
  list.className = "workout-list";
  container.appendChild(list);
  sorted.forEach((a) => {
    const row = document.createElement("div");
    row.className = "workout-row";
    row.innerHTML = `
      <span class="workout-row-main">
        <span class="workout-row-name">${esc(a.label)}</span>
        <span class="workout-row-sub">${Math.round(a.durationMin)} min · ${Math.round(a.intensityMin * 10) / 10} intensity min</span>
      </span>
    `;
    list.appendChild(row);
  });
}

// ---------- Cardio intensity: time in each HR zone ----------
// A period-average distribution across zones 1 (easiest) to 5 (max
// effort) -- same stacked-bar pattern as the Sleep Duration card's stage
// breakdown, answering the same "not all cardio is equal" question but
// for exertion instead of sleep depth. Real per-second zone data is used
// when Garmin has it; for activities that don't (older ones synced before
// sync/garmin_sync.py started fetching it properly, or a rare fetch
// failure), the whole activity's duration is credited to a single zone
// classified from its avg_hr instead -- see activityIntensityMinutes.
async function loadZonesWhere(start, end, includeActivity) {
  const [estimatedMaxHR, activitiesRes] = await Promise.all([
    getEstimatedMaxHR(),
    supabase
      .from("garmin_activities")
      .select("activity_name, activity_type, duration_seconds, avg_hr, hr_zone_1_seconds, hr_zone_2_seconds, hr_zone_3_seconds, hr_zone_4_seconds, hr_zone_5_seconds")
      .gte("start_time", start.toISOString())
      .lte("start_time", end.toISOString()),
  ]);
  const { data, error } = activitiesRes;
  const zones = [1, 2, 3, 4, 5].map((n) => ({ n, seconds: 0 }));
  // Which activities contributed to each zone, and how much -- for the
  // click-through detail. A real-zone-data activity can land in several
  // zones at once (its time genuinely split across them); an avg_hr-
  // classified fallback activity's whole duration goes to the one zone
  // its average lands in.
  const contributions = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  if (!error) {
    (data || [])
      .filter(includeActivity)
      .forEach((a) => {
        const label = a.activity_name || a.activity_type;
        if (a.hr_zone_3_seconds != null) {
          zones.forEach((z) => {
            const secs = a[`hr_zone_${z.n}_seconds`] || 0;
            if (secs > 0) {
              z.seconds += secs;
              contributions[z.n].push({ label, seconds: secs });
            }
          });
        } else {
          const zone = classifyZone(a.avg_hr, estimatedMaxHR);
          if (zone >= 1) {
            const secs = a.duration_seconds || 0;
            zones[zone - 1].seconds += secs;
            contributions[zone].push({ label, seconds: secs });
          }
        }
      });
  }
  return { zones, contributions };
}

export async function loadCardioZones(start, end) {
  return loadZonesWhere(start, end, (a) => !NON_CARDIO_ACTIVITY_TYPES.has(a.activity_type));
}

// Everything Cardio Intensity excludes -- currently just strength_training
// (Pauwi Walk never reaches this table at all, filtered at sync time), but
// written as "not cardio" rather than hardcoding the one type so it stays
// correct if another non-cardio activity type shows up later.
export async function loadOtherTrainingZones(start, end) {
  return loadZonesWhere(start, end, (a) => NON_CARDIO_ACTIVITY_TYPES.has(a.activity_type));
}

const ZONE_LABEL = { 1: "Zone 1 · Easy", 2: "Zone 2 · Base", 3: "Zone 3 · Tempo", 4: "Zone 4 · Threshold", 5: "Zone 5 · Max" };
const ZONE_CLASS = { 1: "hr-zone-1", 2: "hr-zone-2", 3: "hr-zone-3", 4: "hr-zone-4", 5: "hr-zone-5" };

// zonesInput: either a plain [{n, seconds}] array (the per-workout/per-
// activity detail views, which only ever describe one already-specific
// activity -- nothing to drill into further) or the {zones, contributions}
// shape from loadCardioZones/loadOtherTrainingZones above. onZoneClick is
// only wired when contributions are actually available.
export function renderCardioZones(container, zonesInput, emptyMessage = "No activity in range yet.", onZoneClick) {
  const zones = Array.isArray(zonesInput) ? zonesInput : zonesInput.zones;
  const contributions = Array.isArray(zonesInput) ? null : zonesInput.contributions;
  const total = zones.reduce((sum, z) => sum + z.seconds, 0);
  if (!total) {
    container.innerHTML = `<p class="chart-empty">${esc(emptyMessage)}</p>`;
    return;
  }
  const clickable = contributions && onZoneClick;
  const bar = zones
    .filter((z) => z.seconds > 0)
    .map(
      (z) =>
        `<div class="sleep-stage-seg ${ZONE_CLASS[z.n]}${clickable ? " clickable" : ""}" data-zone="${z.n}" style="width:${(z.seconds / total) * 100}%"></div>`
    )
    .join("");
  const legend = zones
    .map(
      (z) =>
        `<span class="sleep-stage-legend-item${clickable ? " clickable" : ""}" data-zone="${z.n}"><span class="sleep-stage-dot ${ZONE_CLASS[z.n]}"></span>${ZONE_LABEL[z.n]} ${Math.round(z.seconds / 60)}m</span>`
    )
    .join("");
  container.innerHTML = `
    <div class="sleep-stage-bar">${bar}</div>
    <div class="sleep-stage-legend">${legend}</div>
  `;
  if (clickable) {
    container.querySelectorAll("[data-zone]").forEach((el) => {
      el.addEventListener("click", () => onZoneClick(Number(el.dataset.zone), contributions[Number(el.dataset.zone)]));
    });
  }
}

// What's contributing to one HR zone -- which activities, and how much of
// that zone's total time came from each. contributions: [{label, seconds}]
// for just this zone, already scoped by the caller (loadCardioZones/
// loadOtherTrainingZones's contributions map).
export function renderZoneContributionDetail(container, zoneNumber, contributions) {
  container.innerHTML = "";
  const header = document.createElement("div");
  header.className = "workout-detail-header";
  header.innerHTML = `<h4>${esc(ZONE_LABEL[zoneNumber] || `Zone ${zoneNumber}`)}</h4>`;
  container.appendChild(header);

  if (!contributions || !contributions.length) {
    container.appendChild(emptyNote("No activity in this zone."));
    return;
  }

  // Same activity name can appear more than once (e.g. two separate
  // Indoor Rowing sessions) -- combine them into one row rather than
  // showing duplicate labels.
  const totals = new Map();
  contributions.forEach((c) => {
    totals.set(c.label, (totals.get(c.label) || 0) + c.seconds);
  });
  const rows = [...totals.entries()]
    .map(([label, seconds]) => ({ label, value: Math.round(seconds / 60), sub: "min" }))
    .sort((a, b) => b.value - a.value);

  const list = document.createElement("div");
  list.className = "bar-list";
  container.appendChild(list);
  renderBarList(list, rows);
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

export function renderJointLoad(container, { current, prev }, onOpenJoint) {
  container.innerHTML = `
    <div class="stat-row emphasis-row">
      ${JOINTS.map((j) => {
        const val = Math.round(current[j.key] * 10) / 10;
        return `<button type="button" class="stat-tile stat-tile-clickable" data-joint="${j.key}">
          <div class="stat-label">${esc(j.label)}</div>
          <div class="stat-value">${val}</div>
          <div class="stat-sub">${jointDeltaText(current[j.key], prev[j.key])}</div>
        </button>`;
      }).join("")}
    </div>
    <p class="muted small">Sets in the selected range weighted by how much each exercise loads that joint, compared to the same-length period right before it -- a fatigue signal, not a score to chase. Tap a joint to see what's contributing.</p>
  `;
  if (onOpenJoint) {
    container.querySelectorAll("[data-joint]").forEach((btn) => {
      btn.addEventListener("click", () => onOpenJoint(btn.dataset.joint));
    });
  }
}

// Which exercises (in the currently-loaded range) are contributing to one
// joint's load, and how much -- same "contribution breakdown" pattern as
// renderMovementDetail/renderMuscleDetail above.
export function renderJointDetail(container, jointKey, onOpenExercise) {
  container.innerHTML = "";
  const header = document.createElement("div");
  header.className = "workout-detail-header";
  header.innerHTML = `<h4>${esc(JOINT_LABEL[jointKey] || jointKey)}</h4>`;
  container.appendChild(header);

  const totals = new Map(); // exercise_name -> joint-load-weighted credited sets
  for (const sets of cache.setsByWorkout.values()) {
    sets.forEach((s) => {
      if (s.is_warmup) return;
      const load = resolveExerciseMeta(s.exercise_name).jointLoad?.[jointKey];
      if (!load) return;
      totals.set(s.exercise_name, (totals.get(s.exercise_name) || 0) + load);
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
