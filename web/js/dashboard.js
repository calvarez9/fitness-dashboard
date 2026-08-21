import { supabase } from "./supabaseClient.js";
import { renderTrendChart } from "./charts.js";

const $ = (sel) => document.querySelector(sel);
const MI_PER_METER = 0.000621371;

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  return x;
}
function weekKey(d) {
  return isoDate(startOfWeek(d));
}

function statTile(label, value, sub) {
  const el = document.createElement("div");
  el.className = "stat-tile";
  el.innerHTML = `<div class="stat-label">${label}</div><div class="stat-value">${value}</div>${
    sub ? `<div class="stat-sub">${sub}</div>` : ""
  }`;
  return el;
}

export async function loadDashboard(days) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const startISO = isoDate(start);
  const endISO = isoDate(end);

  const [dailyRes, activitiesRes, workoutsRes, syncRes] = await Promise.all([
    supabase
      .from("garmin_daily_stats")
      .select("date, resting_hr, body_battery_high, body_battery_low, avg_stress, steps, sleep_seconds")
      .gte("date", startISO)
      .lte("date", endISO)
      .order("date", { ascending: true }),
    supabase
      .from("garmin_activities")
      .select("start_time, distance_meters, duration_seconds")
      .gte("start_time", start.toISOString())
      .lte("start_time", end.toISOString()),
    supabase
      .from("fitlog_workouts")
      .select("id, date, type")
      .gte("date", start.toISOString())
      .lte("date", end.toISOString()),
    supabase.from("sync_state").select("value").eq("key", "last_sync_at").maybeSingle(),
  ]);

  for (const r of [dailyRes, activitiesRes, workoutsRes]) {
    if (r.error) throw r.error;
  }

  const daily = dailyRes.data || [];
  const activities = activitiesRes.data || [];
  const workouts = workoutsRes.data || [];

  const strengthWorkoutIds = workouts.filter((w) => w.type !== "cardio").map((w) => w.id);
  let sets = [];
  if (strengthWorkoutIds.length) {
    const { data, error } = await supabase
      .from("fitlog_sets")
      .select("workout_id, is_warmup")
      .in("workout_id", strengthWorkoutIds);
    if (error) throw error;
    sets = data || [];
  }
  const workoutDateById = Object.fromEntries(workouts.map((w) => [w.id, w.date]));

  renderStats({ daily, activities, workouts });
  renderHeatmap({ start, end, workouts, activities });

  renderTrendChart(
    $("#chartRhr"),
    daily.map((d) => ({ x: new Date(d.date), y: d.resting_hr })),
    { emptyMessage: "No resting HR data yet — run the sync job." }
  );

  renderTrendChart(
    $("#chartBattery"),
    [],
    {
      band: daily.map((d) => ({ x: new Date(d.date), yHigh: d.body_battery_high, yLow: d.body_battery_low })),
      emptyMessage: "No Body Battery data yet.",
    }
  );

  renderTrendChart(
    $("#chartStress"),
    daily.map((d) => ({ x: new Date(d.date), y: d.avg_stress })),
    { emptyMessage: "No stress data yet." }
  );

  renderTrendChart(
    $("#chartSteps"),
    daily.map((d) => ({ x: new Date(d.date), y: d.steps })),
    { emptyMessage: "No steps data yet." }
  );

  renderTrendChart(
    $("#chartSleep"),
    daily.map((d) => ({ x: new Date(d.date), y: d.sleep_seconds != null ? +(d.sleep_seconds / 3600).toFixed(1) : null })),
    { emptyMessage: "No sleep data yet." }
  );

  // Strength volume: working sets per week
  const weeklySets = {};
  sets
    .filter((s) => !s.is_warmup)
    .forEach((s) => {
      const wk = weekKey(new Date(workoutDateById[s.workout_id]));
      weeklySets[wk] = (weeklySets[wk] || 0) + 1;
    });
  renderTrendChart(
    $("#chartStrength"),
    Object.entries(weeklySets)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([wk, count]) => ({ x: new Date(wk), y: count })),
    { emptyMessage: "No strength data in range — import a FitLog backup." }
  );

  // Cardio distance per week, from Garmin activities
  const weeklyDistance = {};
  activities.forEach((a) => {
    if (!a.distance_meters) return;
    const wk = weekKey(new Date(a.start_time));
    weeklyDistance[wk] = (weeklyDistance[wk] || 0) + a.distance_meters * MI_PER_METER;
  });
  renderTrendChart(
    $("#chartCardio"),
    Object.entries(weeklyDistance)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([wk, mi]) => ({ x: new Date(wk), y: +mi.toFixed(1) })),
    { emptyMessage: "No cardio distance in range yet." }
  );

  $("#lastSynced").textContent = syncRes.data?.value ? new Date(syncRes.data.value).toLocaleString() : "never";
}

function renderStats({ daily, activities, workouts }) {
  const row = $("#statRow");
  row.innerHTML = "";

  const latestRhr = [...daily].reverse().find((d) => d.resting_hr != null);
  const stressVals = daily.map((d) => d.avg_stress).filter((v) => v != null);
  const avgStress = stressVals.length ? Math.round(stressVals.reduce((a, b) => a + b, 0) / stressVals.length) : null;
  const totalDistanceMi = activities.reduce((sum, a) => sum + (a.distance_meters || 0), 0) * MI_PER_METER;

  row.appendChild(statTile("Resting HR", latestRhr ? `${latestRhr.resting_hr}` : "—", "bpm, latest"));
  row.appendChild(statTile("Avg Stress", avgStress != null ? avgStress : "—", "period avg"));
  row.appendChild(statTile("Strength Workouts", workouts.filter((w) => w.type !== "cardio").length, "in range"));
  row.appendChild(statTile("Cardio Sessions", activities.length, "in range"));
  row.appendChild(statTile("Cardio Distance", totalDistanceMi.toFixed(1), "mi, in range"));
}

function renderHeatmap({ start, end, workouts, activities }) {
  const el = $("#heatmap");
  el.innerHTML = "";

  const countByDay = {};
  const bump = (dateStr) => {
    const key = dateStr.slice(0, 10);
    countByDay[key] = (countByDay[key] || 0) + 1;
  };
  workouts.forEach((w) => bump(w.date));
  activities.forEach((a) => bump(a.start_time));

  const weekStart = startOfWeek(start);
  const totalDays = Math.ceil((end - weekStart) / (24 * 60 * 60 * 1000)) + 1;
  const totalWeeks = Math.ceil(totalDays / 7);

  for (let w = 0; w < totalWeeks; w++) {
    const col = document.createElement("div");
    col.className = "heatmap-week";
    for (let d = 0; d < 7; d++) {
      const date = new Date(weekStart.getTime() + (w * 7 + d) * 24 * 60 * 60 * 1000);
      const key = isoDate(date);
      const count = countByDay[key] || 0;
      const level = count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : 3;
      const cell = document.createElement("div");
      cell.className = "heatmap-day";
      cell.dataset.level = level;
      cell.title = `${date.toLocaleDateString()}: ${count} session${count === 1 ? "" : "s"}`;
      col.appendChild(cell);
    }
    el.appendChild(col);
  }
}
