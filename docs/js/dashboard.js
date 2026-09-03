import { supabase } from "./supabaseClient.js?v=20260903a";
import { renderTrendChart } from "./charts.js?v=20260903a";

const $ = (sel) => document.querySelector(sel);
const MI_PER_METER = 0.000621371;
const LB_PER_KG = 2.20462;

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

function statTile(label, value, sub, delta) {
  const el = document.createElement("div");
  el.className = "stat-tile";
  el.innerHTML = `<div class="stat-label">${label}</div><div class="stat-value">${value}</div>${
    sub ? `<div class="stat-sub">${sub}</div>` : ""
  }${delta ? `<div class="stat-delta">${delta}</div>` : ""}`;
  return el;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDayLabel(dateStr) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Same tile look as statTile() above, but a real button when onClick is
// given -- "click through everything" applies to these quick-glance tiles
// too, not just the charts underneath them.
function healthTile({ label, value, sub, onClick }) {
  const el = document.createElement(onClick ? "button" : "div");
  if (onClick) {
    el.type = "button";
    el.className = "stat-tile stat-tile-clickable";
    el.addEventListener("click", onClick);
  } else {
    el.className = "stat-tile";
  }
  el.innerHTML = `<div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div>${
    sub ? `<div class="stat-sub">${esc(sub)}</div>` : ""
  }`;
  return el;
}

// Recovery is reported per-activity ("recovered as of [time]"), not as a
// daily trend -- this is a live "right now" status off the single most
// recent activity that has it, recomputed fresh on every load rather than
// stored as a point-in-time value that would go stale.
function computeRecoveryHoursRemaining(activity) {
  if (!activity) return null;
  const endMs = new Date(activity.start_time).getTime() + (activity.duration_seconds || 0) * 1000;
  const readyMs = endMs + (activity.recovery_time_minutes || 0) * 60 * 1000;
  return Math.max(0, (readyMs - Date.now()) / (60 * 60 * 1000));
}

function renderHealthTiles({ daily, weightByDate, latestRecovery, onOpenDay }) {
  const row = $("#healthStatRow");
  if (row) {
    row.innerHTML = "";
    const latestIntensity = [...daily].reverse().find((d) => d.intensity_minutes != null);
    const latestSleep = [...daily].reverse().find((d) => d.sleep_seconds != null);
    const latestSteps = [...daily].reverse().find((d) => d.steps != null);
    const recoveryHours = computeRecoveryHoursRemaining(latestRecovery);

    row.appendChild(
      healthTile({
        label: "Intensity Min",
        value: latestIntensity ? latestIntensity.intensity_minutes : "—",
        sub: latestIntensity ? fmtDayLabel(latestIntensity.date) : "no data yet",
        onClick: latestIntensity && onOpenDay ? () => onOpenDay(latestIntensity.date) : null,
      })
    );
    row.appendChild(
      healthTile({
        label: "Sleep",
        value: latestSleep ? `${(latestSleep.sleep_seconds / 3600).toFixed(1)}h` : "—",
        sub: latestSleep ? fmtDayLabel(latestSleep.date) : "no data yet",
        onClick: latestSleep && onOpenDay ? () => onOpenDay(latestSleep.date) : null,
      })
    );
    row.appendChild(
      healthTile({
        label: "Steps",
        value: latestSteps ? latestSteps.steps.toLocaleString() : "—",
        sub: latestSteps ? fmtDayLabel(latestSteps.date) : "no data yet",
        onClick: latestSteps && onOpenDay ? () => onOpenDay(latestSteps.date) : null,
      })
    );
    row.appendChild(
      healthTile({
        label: "Recovery",
        value: recoveryHours == null ? "—" : recoveryHours < 0.1 ? "Ready" : `${Math.round(recoveryHours)}h`,
        sub: latestRecovery ? `since ${latestRecovery.activity_name || "last activity"}` : "no recent activity data",
        onClick: latestRecovery && onOpenDay ? () => onOpenDay(isoDate(new Date(latestRecovery.start_time))) : null,
      })
    );
  }

  const weightRow = $("#weightStatRow");
  if (weightRow) {
    weightRow.innerHTML = "";
    const latestWeightDate = [...weightByDate.keys()].sort().reverse().find((d) => weightByDate.get(d) != null);
    const latestWeightKg = latestWeightDate ? weightByDate.get(latestWeightDate) : null;
    weightRow.appendChild(
      healthTile({
        label: "Weight",
        value: latestWeightKg != null ? `${(latestWeightKg * LB_PER_KG).toFixed(1)} lb` : "—",
        sub: latestWeightDate ? fmtDayLabel(latestWeightDate) : "no weigh-ins yet",
        onClick: latestWeightDate && onOpenDay ? () => onOpenDay(latestWeightDate) : null,
      })
    );
  }
}

// Purely descriptive (no "good"/"bad" framing) -- direction of a metric like
// stress or resting HR isn't something to editorialize on without context.
function deltaText(current, previous, { decimals = 0, suffix = "" } = {}) {
  if (current == null || previous == null) return "";
  const diff = current - previous;
  if (Math.abs(diff) < 0.5 / 10 ** decimals) return "No change vs prior period";
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff.toFixed(decimals)}${suffix} vs prior period`;
}

async function fetchPeriodSummary(start, end) {
  const startISO = isoDate(start);
  const endISO = isoDate(end);
  const [dailyRes, activitiesRes, workoutsRes] = await Promise.all([
    supabase.from("garmin_daily_stats").select("resting_hr, avg_stress").gte("date", startISO).lte("date", endISO),
    supabase
      .from("garmin_activities")
      .select("distance_meters")
      .neq("activity_type", "strength_training")
      .gte("start_time", start.toISOString())
      .lte("start_time", end.toISOString()),
    supabase.from("fitlog_workouts").select("id, type").gte("date", start.toISOString()).lte("date", end.toISOString()),
  ]);
  for (const r of [dailyRes, activitiesRes, workoutsRes]) if (r.error) throw r.error;

  const daily = dailyRes.data || [];
  const activities = activitiesRes.data || [];
  const workouts = workoutsRes.data || [];

  const latestRhr = [...daily].reverse().find((d) => d.resting_hr != null);
  const stressVals = daily.map((d) => d.avg_stress).filter((v) => v != null);

  return {
    rhr: latestRhr ? latestRhr.resting_hr : null,
    avgStress: stressVals.length ? stressVals.reduce((a, b) => a + b, 0) / stressVals.length : null,
    strengthCount: workouts.filter((w) => w.type !== "cardio").length,
    cardioCount: activities.length,
    cardioDistanceMi: activities.reduce((sum, a) => sum + (a.distance_meters || 0), 0) * MI_PER_METER,
  };
}

export async function loadDashboard(days, onOpenDay) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const startISO = isoDate(start);
  const endISO = isoDate(end);

  const [dailyRes, activitiesRes, workoutsRes, syncRes] = await Promise.all([
    supabase
      .from("garmin_daily_stats")
      .select(
        "date, resting_hr, body_battery_high, body_battery_low, avg_stress, steps, sleep_seconds, deep_sleep_seconds, light_sleep_seconds, rem_sleep_seconds, awake_seconds, intensity_minutes"
      )
      .gte("date", startISO)
      .lte("date", endISO)
      .order("date", { ascending: true }),
    supabase
      .from("garmin_activities")
      .select("start_time, distance_meters, duration_seconds, activity_type")
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

  // Queried separately from the main daily-stats fetch above, and never
  // allowed to throw -- weight_kg is a new column (schema/015) that may
  // not exist in this Supabase project yet if that migration hasn't been
  // run. Bundling it into the main select would take the whole Health tab
  // down over one missing column; this way a missing/failed weight fetch
  // only means an empty weight chart.
  let weightByDate = new Map();
  try {
    const { data, error } = await supabase.from("garmin_daily_stats").select("date, weight_kg").gte("date", startISO).lte("date", endISO);
    if (error) throw error;
    weightByDate = new Map((data || []).map((d) => [d.date, d.weight_kg]));
  } catch (e) {
    console.warn("weight_kg unavailable (has schema/015_body_weight.sql been run?):", e.message);
  }

  // Same isolation, same reason -- recovery_time_minutes is schema/016.
  // Not date-range-scoped: recovery is a "right now" status off the single
  // most recent activity that reports it, not a historical trend, so this
  // looks back further than the selected range on purpose.
  let latestRecovery = null;
  try {
    const farStart = new Date(end.getTime() - 21 * 24 * 60 * 60 * 1000);
    const { data, error } = await supabase
      .from("garmin_activities")
      .select("id, activity_name, start_time, duration_seconds, recovery_time_minutes")
      .not("recovery_time_minutes", "is", null)
      .gte("start_time", farStart.toISOString())
      .order("start_time", { ascending: false })
      .limit(1);
    if (error) throw error;
    latestRecovery = data?.[0] || null;
  } catch (e) {
    console.warn("recovery_time_minutes unavailable (has schema/016_recovery_time.sql been run?):", e.message);
  }

  // A Garmin-auto-detected "Strength" activity isn't cardio -- excluded
  // from cardio-specific stats/charts below, but `activities` itself stays
  // unfiltered for the consistency heatmap, which cares about "did
  // something that day" regardless of type.
  const cardioActivities = activities.filter((a) => a.activity_type !== "strength_training");
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

  const priorEnd = new Date(start.getTime());
  const priorStart = new Date(priorEnd.getTime() - days * 24 * 60 * 60 * 1000);
  const priorSummary = await fetchPeriodSummary(priorStart, priorEnd);

  renderStats({ daily, activities: cardioActivities, workouts, priorSummary });
  renderHeatmap({ start, end, workouts, activities });
  // Not date-range-scoped -- like Recovery itself, this is "what does
  // right now look like", not a report on whatever range happens to be
  // selected for the charts below it.
  renderHealthTiles({ daily, weightByDate, latestRecovery, onOpenDay });

  // Every Health tab chart opens the same day snapshot on click -- "where
  // is this coming from" for a single day's metric is the rest of what
  // happened that day (workouts, other metrics), not a deeper breakdown
  // of the metric itself, which Garmin doesn't expose below one value/day.
  const onDayClick = onOpenDay ? (p) => onOpenDay(isoDate(p.x)) : undefined;

  renderTrendChart(
    $("#chartRhr"),
    daily.map((d) => ({ x: new Date(d.date), y: d.resting_hr })),
    { emptyMessage: "No resting HR data yet — run the sync job.", onPointClick: onDayClick }
  );

  renderTrendChart(
    $("#chartBattery"),
    [],
    {
      band: daily.map((d) => ({ x: new Date(d.date), yHigh: d.body_battery_high, yLow: d.body_battery_low })),
      emptyMessage: "No Body Battery data yet.",
      onPointClick: onDayClick,
    }
  );

  renderTrendChart(
    $("#chartStress"),
    daily.map((d) => ({ x: new Date(d.date), y: d.avg_stress })),
    { emptyMessage: "No stress data yet.", onPointClick: onDayClick }
  );

  renderTrendChart(
    $("#chartSteps"),
    daily.map((d) => ({ x: new Date(d.date), y: d.steps })),
    { emptyMessage: "No steps data yet.", onPointClick: onDayClick }
  );

  renderTrendChart(
    $("#chartSleep"),
    daily.map((d) => ({ x: new Date(d.date), y: d.sleep_seconds != null ? +(d.sleep_seconds / 3600).toFixed(1) : null })),
    { emptyMessage: "No sleep data yet.", onPointClick: onDayClick }
  );
  renderSleepStages(daily);

  renderTrendChart(
    $("#chartWeight"),
    daily.map((d) => {
      const kg = weightByDate.get(d.date);
      return { x: new Date(d.date), y: kg != null ? +(kg * LB_PER_KG).toFixed(1) : null };
    }),
    { emptyMessage: "No weigh-ins yet — weigh in on the Garmin scale and it'll show up after the next sync.", onPointClick: onDayClick }
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
  cardioActivities.forEach((a) => {
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

function renderStats({ daily, activities, workouts, priorSummary }) {
  const row = $("#statRow");
  row.innerHTML = "";

  const latestRhr = [...daily].reverse().find((d) => d.resting_hr != null);
  const stressVals = daily.map((d) => d.avg_stress).filter((v) => v != null);
  const avgStress = stressVals.length ? Math.round(stressVals.reduce((a, b) => a + b, 0) / stressVals.length) : null;
  const totalDistanceMi = activities.reduce((sum, a) => sum + (a.distance_meters || 0), 0) * MI_PER_METER;
  const strengthCount = workouts.filter((w) => w.type !== "cardio").length;

  const p = priorSummary || {};
  row.appendChild(
    statTile("Resting HR", latestRhr ? `${latestRhr.resting_hr}` : "—", "bpm, latest", deltaText(latestRhr?.resting_hr, p.rhr, { suffix: " bpm" }))
  );
  row.appendChild(
    statTile("Avg Stress", avgStress != null ? avgStress : "—", "period avg", deltaText(avgStress, p.avgStress != null ? Math.round(p.avgStress) : null))
  );
  row.appendChild(statTile("Strength Workouts", strengthCount, "in range", deltaText(strengthCount, p.strengthCount, { suffix: " sessions" })));
  row.appendChild(statTile("Cardio Sessions", activities.length, "in range", deltaText(activities.length, p.cardioCount, { suffix: " sessions" })));
  row.appendChild(
    statTile("Cardio Distance", totalDistanceMi.toFixed(1), "mi, in range", deltaText(totalDistanceMi, p.cardioDistanceMi, { decimals: 1, suffix: " mi" }))
  );
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

// Period-average sleep stage breakdown (deep/light/REM/awake), as a single
// stacked bar -- Garmin already syncs the per-stage seconds, this was just
// never charted. A stacked bar was more honest here than trying to plot
// four stacked series over time in the existing line-chart component.
function renderSleepStages(daily) {
  const el = $("#sleepStages");
  if (!el) return;
  el.innerHTML = "";

  const stages = [
    { key: "deep_sleep_seconds", label: "Deep", cls: "stage-deep" },
    { key: "light_sleep_seconds", label: "Light", cls: "stage-light" },
    { key: "rem_sleep_seconds", label: "REM", cls: "stage-rem" },
    { key: "awake_seconds", label: "Awake", cls: "stage-awake" },
  ];

  const avgSeconds = {};
  let anyData = false;
  stages.forEach(({ key }) => {
    const vals = daily.map((d) => d[key]).filter((v) => v != null);
    avgSeconds[key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    if (vals.length) anyData = true;
  });

  if (!anyData) {
    el.innerHTML = `<p class="chart-empty">No sleep stage data yet.</p>`;
    return;
  }

  const total = stages.reduce((sum, s) => sum + avgSeconds[s.key], 0) || 1;
  const fmtHrs = (sec) => (sec / 3600).toFixed(1);

  const bar = document.createElement("div");
  bar.className = "sleep-stage-bar";
  stages.forEach(({ key, cls }) => {
    const pct = (avgSeconds[key] / total) * 100;
    if (pct <= 0) return;
    const seg = document.createElement("div");
    seg.className = `sleep-stage-seg ${cls}`;
    seg.style.width = `${pct}%`;
    bar.appendChild(seg);
  });
  el.appendChild(bar);

  const legend = document.createElement("div");
  legend.className = "sleep-stage-legend";
  legend.innerHTML = stages
    .map(({ key, label, cls }) => `<span class="sleep-stage-legend-item"><span class="sleep-stage-dot ${cls}"></span>${label} ${fmtHrs(avgSeconds[key])}h</span>`)
    .join("");
  el.appendChild(legend);
}

