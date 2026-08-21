import { supabase } from "./supabaseClient.js";

// Imports a FitLog backup export (Settings -> Export backup in the FitLog app)
// into the fitlog_workouts / fitlog_sets / fitlog_cardio_segments tables,
// and syncs FitLog's own custom/edited exercises (movement, muscles,
// athleticism) into exercise_overrides -- one-way, FitLog -> dashboard,
// same direction workouts already flow in. Re-importing is safe: each
// workout's child rows are replaced, not duplicated, and exercise rows
// are just upserted by name.
export async function importFitLogBackup(data, onProgress) {
  if (!data || !Array.isArray(data.workouts)) {
    throw new Error("That doesn't look like a FitLog backup file (missing 'workouts' array).");
  }

  let workoutCount = 0;
  let setCount = 0;
  let segmentCount = 0;
  let exerciseCount = 0;

  if (Array.isArray(data.exercises) && data.exercises.length) {
    const rows = data.exercises
      .filter((e) => e && e.name)
      .map((e) => ({
        name: e.name,
        movement: e.movement || "isolation",
        muscles: e.muscles || {},
        athleticism: e.athleticism || 0,
      }));
    if (rows.length) {
      const { error } = await supabase.from("exercise_overrides").upsert(rows, { onConflict: "name" });
      if (error) throw new Error(`Exercise library: ${error.message}`);
      exerciseCount = rows.length;
    }
  }

  for (const w of data.workouts) {
    const type = w.type === "cardio" ? "cardio" : "strength";

    const { error: workoutErr } = await supabase.from("fitlog_workouts").upsert(
      {
        id: w.id,
        date: w.date,
        started_at: w.startedAt || null,
        duration_min: w.durationMin ?? null,
        name: w.name || (type === "cardio" ? "Cardio" : "Workout"),
        notes: w.notes || null,
        type,
        raw: w,
      },
      { onConflict: "id" }
    );
    if (workoutErr) throw new Error(`Workout ${w.id}: ${workoutErr.message}`);

    // Clear old child rows so re-imports don't duplicate.
    await supabase.from("fitlog_sets").delete().eq("workout_id", w.id);
    await supabase.from("fitlog_cardio_segments").delete().eq("workout_id", w.id);

    if (type === "cardio" && Array.isArray(w.segments)) {
      const rows = w.segments.map((s) => ({
        workout_id: w.id,
        activity_type: s.activityType,
        duration_min: s.durationMin,
        distance: s.distance,
        calories: s.calories,
        avg_hr: s.avgHr,
        max_hr: s.maxHr,
      }));
      if (rows.length) {
        const { error } = await supabase.from("fitlog_cardio_segments").insert(rows);
        if (error) throw new Error(`Cardio segments for ${w.id}: ${error.message}`);
        segmentCount += rows.length;
      }
    } else if (Array.isArray(w.exercises)) {
      const rows = [];
      w.exercises.forEach((ex) => {
        (ex.sets || []).forEach((s, i) => {
          rows.push({
            workout_id: w.id,
            exercise_name: ex.exerciseName,
            set_index: i,
            reps: s.reps,
            weight: s.weight,
            rpe: s.rpe,
            is_warmup: !!s.isWarmup,
            done: !!s.done,
          });
        });
      });
      if (rows.length) {
        const { error } = await supabase.from("fitlog_sets").insert(rows);
        if (error) throw new Error(`Sets for ${w.id}: ${error.message}`);
        setCount += rows.length;
      }
    }

    workoutCount++;
    if (onProgress) onProgress(workoutCount, data.workouts.length);
  }

  return { workoutCount, setCount, segmentCount, exerciseCount };
}
