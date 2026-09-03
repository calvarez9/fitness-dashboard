// ---------- Health metric detail: period-average comparison ----------
// Click a Health tab metric to expand a comparison underneath its chart:
// the current period's average (whatever the main range selector is set
// to) alongside your 6-month, 1-year, and lifetime averages. Started as a
// min/max "range" gauge, but a single outlier day (e.g. one 29k-step day)
// stretches a min/max scale enough to make the marker position meaningless
// -- averages are naturally resistant to that, so this compares those instead.
import { supabase } from "./supabaseClient.js?v=20260903a";
import { renderBarList } from "./charts.js?v=20260903a";

export const HEALTH_METRICS = {
  rhr: { label: "Resting Heart Rate", column: "resting_hr", unit: " bpm" },
  stress: { label: "Stress", column: "avg_stress", unit: "" },
  battery: { label: "Body Battery", column: "body_battery_high", unit: "" },
  steps: { label: "Steps", column: "steps", unit: "" },
  sleep: { label: "Sleep Duration", column: "sleep_seconds", unit: "h", transform: (v) => +(v / 3600).toFixed(1) },
};

function avgSince(rows, sinceDays) {
  const cutoff = sinceDays ? new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) : null;
  const vals = rows.filter((r) => !cutoff || r.date >= cutoff).map((r) => r.value);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export async function renderMetricDetail(container, metricKey, currentRangeDays) {
  const cfg = HEALTH_METRICS[metricKey];
  container.innerHTML = `<p class="chart-empty">Loading…</p>`;

  let rows;
  try {
    const { data, error } = await supabase
      .from("garmin_daily_stats")
      .select(`date, ${cfg.column}`)
      .not(cfg.column, "is", null)
      .order("date", { ascending: true });
    if (error) throw error;
    rows = (data || []).map((d) => ({ date: d.date, value: d[cfg.column] }));
  } catch (e) {
    container.innerHTML = `<p class="chart-empty">Couldn't load averages — see console.</p>`;
    console.error(e);
    return;
  }

  container.innerHTML = "";

  if (!rows.length) {
    container.innerHTML = `<p class="chart-empty">Not enough data yet.</p>`;
    return;
  }

  const fmt = (v) => (cfg.transform ? cfg.transform(v) : Math.round(v));
  const bars = [
    { label: "Selected range", days: currentRangeDays },
    { label: "6 months", days: 182 },
    { label: "1 year", days: 365 },
    { label: "Lifetime", days: null },
  ]
    .map(({ label, days }) => {
      const avg = avgSince(rows, days);
      return avg == null ? null : { label, value: fmt(avg), sub: cfg.unit.trim() };
    })
    .filter(Boolean);

  const list = document.createElement("div");
  list.className = "bar-list";
  container.appendChild(list);
  renderBarList(list, bars, { emptyMessage: "Not enough data yet." });
}
