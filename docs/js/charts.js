// ---------- Generic trend line/band chart (plain SVG, no deps) ----------
const NS = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/**
 * points: [{ x: Date, y: number|null }]  (nulls are skipped, gaps in the line)
 * opts:
 *   band: [{ x, yHigh, yLow }]  optional shaded band (e.g. Body Battery high/low)
 *   yUnit: string appended to axis labels
 *   emptyMessage: shown when there's no data at all
 */
export function renderTrendChart(svg, points, opts = {}) {
  svg.innerHTML = "";
  const W = 700, H = 220;
  const padL = 44, padR = 12, padT = 14, padB = 24;

  const valid = points.filter((p) => p.y != null);
  const bandValid = (opts.band || []).filter((p) => p.yHigh != null || p.yLow != null);

  if (valid.length === 0 && bandValid.length === 0) {
    const fo = el("foreignObject", { x: 0, y: 0, width: W, height: H });
    const div = document.createElement("div");
    div.className = "chart-empty";
    div.textContent = opts.emptyMessage || "No data in this range yet.";
    fo.appendChild(div);
    svg.appendChild(fo);
    return;
  }

  const allY = [
    ...valid.map((p) => p.y),
    ...bandValid.flatMap((p) => [p.yHigh, p.yLow].filter((v) => v != null)),
  ];
  let minY = Math.min(...allY);
  let maxY = Math.max(...allY);
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }
  const pad = (maxY - minY) * 0.1;
  minY = Math.max(0, minY - pad);
  maxY += pad;

  const allX = [...points.map((p) => p.x), ...(opts.band || []).map((p) => p.x)];
  const minX = new Date(Math.min(...allX.map((d) => d.getTime())));
  const maxX = new Date(Math.max(...allX.map((d) => d.getTime())));
  const spanMs = Math.max(1, maxX - minX);

  const x = (d) => padL + ((d.getTime() - minX.getTime()) / spanMs) * (W - padL - padR);
  const y = (v) => H - padB - ((v - minY) / (maxY - minY)) * (H - padT - padB);

  // gridlines
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const v = minY + ((maxY - minY) * i) / steps;
    const gy = y(v);
    svg.appendChild(el("line", { class: "grid-line", x1: padL, x2: W - padR, y1: gy, y2: gy }));
    const t = el("text", { x: padL - 8, y: gy + 3, "text-anchor": "end" });
    t.textContent = Math.round(v).toLocaleString();
    svg.appendChild(t);
  }
  svg.appendChild(el("line", { class: "baseline", x1: padL, x2: W - padR, y1: H - padB, y2: H - padB }));

  // x labels: first / mid / last date
  const fmtDate = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  [minX, new Date((minX.getTime() + maxX.getTime()) / 2), maxX].forEach((d, i) => {
    const t = el("text", { x: x(d), y: H - 6, "text-anchor": i === 0 ? "start" : i === 2 ? "end" : "middle" });
    t.textContent = fmtDate(d);
    svg.appendChild(t);
  });

  // band (e.g. body battery high/low)
  if (bandValid.length > 1) {
    const top = bandValid.map((p) => `${x(p.x)},${y(p.yHigh)}`).join(" L ");
    const bottom = [...bandValid].reverse().map((p) => `${x(p.x)},${y(p.yLow)}`).join(" L ");
    svg.appendChild(el("path", { class: "band", d: `M ${top} L ${bottom} Z` }));
    svg.appendChild(
      el("path", {
        class: "series-a",
        d: bandValid.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.x)} ${y(p.yHigh)}`).join(" "),
      })
    );
    svg.appendChild(
      el("path", {
        class: "series-b",
        d: bandValid.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.x)} ${y(p.yLow)}`).join(" "),
      })
    );
    const leg = el("text", { class: "legend-text", x: padL, y: padT });
    leg.textContent = "— high    — low";
    svg.appendChild(leg);
  }

  // single line
  if (valid.length > 0) {
    const path = valid.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.x)} ${y(p.y)}`).join(" ");
    svg.appendChild(el("path", { class: "series-a", d: path }));
    valid.forEach((p) => {
      svg.appendChild(el("circle", { class: "dot-a", cx: x(p.x), cy: y(p.y), r: 2.5 }));
    });
  }
}

/**
 * rows: [{ label, value, sub?, key? }]  sorted by caller, rendered in that order
 * opts: { emptyMessage, onClick(row) }  -- when onClick is given, each row
 *   renders as a button (drill-down: exercise -> sessions, movement -> exercises).
 */
export function renderBarList(container, rows, opts = {}) {
  container.innerHTML = "";
  if (!rows.length) {
    const div = document.createElement("div");
    div.className = "chart-empty";
    div.textContent = opts.emptyMessage || "No data in this range yet.";
    container.appendChild(div);
    return;
  }
  const max = Math.max(...rows.map((r) => r.value), 0);
  rows.forEach((r) => {
    const clickable = !!opts.onClick;
    const row = document.createElement(clickable ? "button" : "div");
    if (clickable) row.type = "button";
    row.className = "bar-row" + (clickable ? " clickable" : "");
    const pct = max > 0 ? Math.max(4, (r.value / max) * 100) : 0;
    const valueText = typeof r.value === "number" ? r.value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : r.value;
    row.innerHTML = `
      <div class="bar-row-top">
        <span class="bar-label">${r.label}</span>
        <span class="bar-value">${valueText}${r.sub ? ` <span class="bar-sub">${r.sub}</span>` : ""}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
    `;
    if (clickable) row.addEventListener("click", () => opts.onClick(r));
    container.appendChild(row);
  });
}
