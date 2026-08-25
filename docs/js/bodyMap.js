// ---------- Front/back body diagram, colorable by muscle volume ----------
// Uses real anatomical SVG paths (see js/vendor/ + LICENSE-THIRD-PARTY.md)
// instead of hand-drawn shapes. Each vendored "slug" (chest, deltoids, …) is
// mapped to one or more of this app's muscle keys so it can be colored from
// js/volume.js output — some slugs (e.g. a single "deltoids" blob) stand in
// for more than one tracked muscle; some (hands, head, knees…) are just
// body context and never colored.
import { bodyFront, bodyFrontOutline } from "./vendor/bodyFront.js?v=20260826i";
import { bodyBack, bodyBackOutline } from "./vendor/bodyBack.js?v=20260826i";

const FRONT_VIEWBOX = "0 0 724 1448";
const BACK_VIEWBOX = "724 0 724 1448";

const FRONT_SLUG_TO_MUSCLES = {
  chest: ["chest"],
  abs: ["abs"],
  obliques: ["obliques"],
  biceps: ["biceps"],
  triceps: ["triceps"],
  trapezius: ["upperTraps", "middleTraps", "lowerTraps"],
  deltoids: ["frontDelts", "middleDelts"],
  adductors: ["adductors"],
  quadriceps: ["quadriceps"],
  calves: ["calves"],
  forearm: ["forearms"],
};

const BACK_SLUG_TO_MUSCLES = {
  trapezius: ["upperTraps", "middleTraps", "lowerTraps"],
  deltoids: ["rearDelts", "middleDelts"],
  "upper-back": ["upperBack", "lats"],
  triceps: ["triceps"],
  "lower-back": ["lowerBack", "spinalErectors"],
  forearm: ["forearms"],
  gluteal: ["glutes", "abductors"],
  adductors: ["adductors"],
  hamstring: ["hamstrings"],
  calves: ["calves"],
};

function pathStringsFor(part) {
  const p = part.path || {};
  return [...(p.common || []), ...(p.left || []), ...(p.right || [])];
}

function buildFigure(svg, viewBox, outlineD, parts) {
  svg.setAttribute("viewBox", viewBox);
  const NS = "http://www.w3.org/2000/svg";
  svg.innerHTML = "";

  const outline = document.createElementNS(NS, "path");
  outline.setAttribute("d", outlineD);
  outline.setAttribute("class", "bm-outline");
  svg.appendChild(outline);

  parts.forEach((part) => {
    const g = document.createElementNS(NS, "g");
    g.setAttribute("data-slug", part.slug);
    g.setAttribute("class", "bm-region bm-zero");
    pathStringsFor(part).forEach((d) => {
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", d);
      g.appendChild(path);
    });
    svg.appendChild(g);
  });
}

// onRegionClick(muscleKeys): called with the array of muscle keys a clicked
// region stands for (e.g. deltoids -> ["frontDelts","middleDelts"]) -- the
// caller decides which one to drill into (e.g. whichever has more volume).
export function renderBodyMaps(frontSvg, backSvg, onRegionClick) {
  buildFigure(frontSvg, FRONT_VIEWBOX, bodyFrontOutline, bodyFront);
  buildFigure(backSvg, BACK_VIEWBOX, bodyBackOutline, bodyBack);

  if (onRegionClick) {
    const wire = (svg, slugMap) => {
      svg.querySelectorAll("[data-slug]").forEach((g) => {
        const keys = slugMap[g.dataset.slug];
        if (!keys) return;
        g.style.cursor = "pointer";
        g.addEventListener("click", () => onRegionClick(keys));
      });
    };
    wire(frontSvg, FRONT_SLUG_TO_MUSCLES);
    wire(backSvg, BACK_SLUG_TO_MUSCLES);
  }
}

// muscleTotals: { muscleKey: sets }. max: the period's peak single-muscle
// value (shared with the bar-list scale, so the diagram and the numbers agree).
export function applyVolumeColors(frontSvg, backSvg, muscleTotals) {
  const max = Math.max(0, ...Object.values(muscleTotals));

  function colorSide(svg, slugMap) {
    svg.querySelectorAll("[data-slug]").forEach((g) => {
      const keys = slugMap[g.dataset.slug];
      const val = keys ? Math.max(0, ...keys.map((k) => muscleTotals[k] || 0)) : 0;
      if (!keys || val <= 0 || max === 0) {
        g.setAttribute("class", "bm-region bm-zero");
        g.style.removeProperty("--bm-opacity");
      } else {
        const opacity = 0.28 + 0.72 * (val / max);
        g.setAttribute("class", "bm-region bm-active");
        g.style.setProperty("--bm-opacity", opacity.toFixed(2));
      }
    });
  }

  colorSide(frontSvg, FRONT_SLUG_TO_MUSCLES);
  colorSide(backSvg, BACK_SLUG_TO_MUSCLES);
}
