// ---------- Health metric detail: "your range" gauge ----------
// Click a Health tab metric to expand a range gauge underneath its chart:
// a marker for the current period's average (whatever the main range
// selector is set to) plotted against a min/max ruler calibrated over a
// separately-chosen, more stable baseline (6mo/1yr/lifetime) -- so
// switching to "Last 7 days" up top moves the marker, not the ruler.
import { supabase } from "./supabaseClient.js";

export const HEALTH_METRICS = {
  rhr: { label: "Resting Heart Rate", column: "resting_hr", unit: " bpm", direction: "lowerBetter" },
  stress: { label: "Stress", column: "avg_stress", unit: "", direction: "lowerBetter" },
  battery: { label: "Body Battery", column: "body_battery_high", unit: "", direction: "higherBetter" },
  steps: { label: "Steps", column: "steps", unit: "", direction: "neutral" },
  sleep: { label: "Sleep Duration", column: "sleep_seconds", unit: "h", direction: "neutral", transform: (v) => +(v / 3600).toFixed(1) },
};

const BASELINES = [
  { key: "6m", label: "6 months", days: 182 },
  { key: "1y", label: "1 year", days: 365 },
  { key: "life", label: "Lifetime", days: null },
];

async function fetchColumn(column, sinceDays) {
  let q = supabase.from("garmin_daily_stats").select(`date, ${column}`).not(column, "is", null).order("date", { ascending: true });
  if (sinceDays) {
    const start = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    q = q.gte("date", start.toISOString().slice(0, 10));
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map((d) => d[column]).filter((v) => v != null);
}

/**
 * Renders (or re-renders, e.g. after a baseline-toggle click) the gauge for
 * one metric into `container`. currentRangeDays: the main dashboard range
 * selector's value, used only for the marked "current average".
 */
export async function renderMetricDetail(container, metricKey, currentRangeDays, baselineKey) {
  const cfg = HEALTH_METRICS[metricKey];
  // Remember the last baseline picked for this container (e.g. the main
  // range selector changing shouldn't reset "Lifetime" back to "1 year").
  const baseline = BASELINES.find((b) => b.key === (baselineKey || container.dataset.baseline)) || BASELINES[1];
  container.dataset.baseline = baseline.key;

  container.innerHTML = `<p class="chart-empty">Loading…</p>`;

  let rangeVals, currentVals;
  try {
    [rangeVals, currentVals] = await Promise.all([fetchColumn(cfg.column, baseline.days), fetchColumn(cfg.column, currentRangeDays)]);
  } catch (e) {
    container.innerHTML = `<p class="chart-empty">Couldn't load range — see console.</p>`;
    console.error(e);
    return;
  }

  container.innerHTML = "";

  const nav = document.createElement("div");
  nav.className = "seg-nav";
  BASELINES.forEach((b) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "seg-btn" + (b.key === baseline.key ? " active" : "");
    btn.textContent = b.label;
    btn.addEventListener("click", () => renderMetricDetail(container, metricKey, currentRangeDays, b.key));
    nav.appendChild(btn);
  });
  container.appendChild(nav);

  if (!rangeVals.length || !currentVals.length) {
    const p = document.createElement("p");
    p.className = "chart-empty";
    p.textContent = "Not enough data yet for this range.";
    container.appendChild(p);
    return;
  }

  const min = Math.min(...rangeVals);
  const max = Math.max(...rangeVals);
  const current = currentVals.reduce((a, b) => a + b, 0) / currentVals.length;
  const fmt = (v) => `${cfg.transform ? cfg.transform(v) : Math.round(v)}${cfg.unit}`;

  const pct = max > min ? ((current - min) / (max - min)) * 100 : 50;
  const clampedPct = Math.max(2, Math.min(98, pct));

  const gauge = document.createElement("div");
  gauge.className = `metric-gauge metric-gauge-${cfg.direction}`;
  gauge.innerHTML = `
    <div class="metric-gauge-track">
      <div class="metric-gauge-marker" style="left:${clampedPct}%" title="${esc(fmt(current))}"></div>
    </div>
    <div class="metric-gauge-labels">
      <span>${esc(fmt(min))}</span>
      <span>${esc(fmt(max))}</span>
    </div>
  `;
  container.appendChild(gauge);

  const caption = document.createElement("p");
  caption.className = "muted small";
  caption.textContent = `Average of ${fmt(current)} over your selected range, against your ${baseline.label.toLowerCase()} range.`;
  container.appendChild(caption);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
