// ---------- Exercise metadata: muscles + movement patterns ----------
// Ported from FitLog's own js/exerciseLibrary.js so the dashboard can roll
// logged sets up into movement-pattern and muscle-engagement stats, the
// same way FitLog itself does. This is a static reference table (not user
// data), so a plain copy here is fine — it isn't meant to sync back.
//
// Workout data comes from two sources with different naming conventions
// (FitLog's own names, and Boostcamp's equipment-suffixed names like
// "Bench Press (Barbell)"), so resolveExerciseMeta() below normalizes
// names before matching instead of requiring an exact key.

export const MUSCLES = [
  { key: "frontDelts", label: "Front Delts" },
  { key: "middleDelts", label: "Middle Delts" },
  { key: "rearDelts", label: "Rear Delts" },
  { key: "chest", label: "Chest" },
  { key: "triceps", label: "Triceps" },
  { key: "biceps", label: "Biceps" },
  { key: "forearms", label: "Forearms" },
  { key: "abs", label: "Abs" },
  { key: "obliques", label: "Obliques" },
  { key: "lats", label: "Lats" },
  { key: "upperBack", label: "Upper Back" },
  { key: "lowerBack", label: "Lower Back" },
  { key: "traps", label: "Traps" },
  { key: "glutes", label: "Glutes" },
  { key: "hipFlexors", label: "Hip Flexors" },
  { key: "adductors", label: "Adductors" },
  { key: "abductors", label: "Abductors" },
  { key: "hamstrings", label: "Hamstrings" },
  { key: "quadriceps", label: "Quadriceps" },
  { key: "calves", label: "Calves" },
];
export const MUSCLE_LABEL = Object.fromEntries(MUSCLES.map((m) => [m.key, m.label]));

export const MOVEMENTS = [
  { key: "verticalPush", label: "Vertical Push" },
  { key: "horizontalPush", label: "Horizontal Push" },
  { key: "verticalPull", label: "Vertical Pull" },
  { key: "horizontalPull", label: "Horizontal Pull" },
  { key: "squat", label: "Squat" },
  { key: "hinge", label: "Hinge" },
  { key: "lunge", label: "Lunge" },
  { key: "isolation", label: "Isolation / Core" },
];
export const MOVEMENT_LABEL = Object.fromEntries(MOVEMENTS.map((m) => [m.key, m.label]));

export const BUILTIN_EXERCISES = {
  "Barbell Squat": { movement: "squat", muscles: { quadriceps: 1, glutes: 1, hamstrings: 0.5, abs: 0.5, lowerBack: 0.5, adductors: 0.5 } },
  "Bench Press": { movement: "horizontalPush", muscles: { chest: 1, triceps: 0.5, frontDelts: 0.5 } },
  "Deadlift": { movement: "hinge", muscles: { hamstrings: 1, glutes: 1, lowerBack: 1, upperBack: 0.5, traps: 0.5, forearms: 0.5 } },
  "Overhead Press": { movement: "verticalPush", muscles: { frontDelts: 1, middleDelts: 0.5, triceps: 0.5 } },
  "Barbell Row": { movement: "horizontalPull", muscles: { upperBack: 1, lats: 0.5, biceps: 0.5, rearDelts: 0.5 } },
  "Pull-Up": { movement: "verticalPull", muscles: { lats: 1, upperBack: 0.5, biceps: 0.5 } },
  "Chin-Up": { movement: "verticalPull", muscles: { lats: 1, biceps: 1, upperBack: 0.5 } },
  "Push-Up": { movement: "horizontalPush", muscles: { chest: 1, triceps: 0.5, frontDelts: 0.5 } },
  "Dip": { movement: "verticalPush", muscles: { triceps: 1, chest: 0.5, frontDelts: 0.5 } },
  "Lat Pulldown": { movement: "verticalPull", muscles: { lats: 1, upperBack: 0.5, biceps: 0.5 } },
  "Seated Cable Row": { movement: "horizontalPull", muscles: { upperBack: 1, lats: 0.5, biceps: 0.5 } },
  "Incline Bench Press": { movement: "horizontalPush", muscles: { chest: 1, frontDelts: 0.5, triceps: 0.5 } },
  "Dumbbell Bench Press": { movement: "horizontalPush", muscles: { chest: 1, triceps: 0.5, frontDelts: 0.5 } },
  "Dumbbell Shoulder Press": { movement: "verticalPush", muscles: { frontDelts: 1, middleDelts: 0.5, triceps: 0.5 } },
  "Dumbbell Row": { movement: "horizontalPull", muscles: { upperBack: 1, lats: 0.5, biceps: 0.5 } },
  "Dumbbell Curl": { movement: "isolation", muscles: { biceps: 1, forearms: 0.5 } },
  "Barbell Curl": { movement: "isolation", muscles: { biceps: 1, forearms: 0.5 } },
  "Hammer Curl": { movement: "isolation", muscles: { biceps: 1, forearms: 0.5 } },
  "Tricep Pushdown": { movement: "isolation", muscles: { triceps: 1 } },
  "Skull Crusher": { movement: "isolation", muscles: { triceps: 1 } },
  "Leg Press": { movement: "squat", muscles: { quadriceps: 1, glutes: 0.5, hamstrings: 0.5, adductors: 0.5 } },
  "Leg Curl": { movement: "isolation", muscles: { hamstrings: 1 } },
  "Leg Extension": { movement: "isolation", muscles: { quadriceps: 1 } },
  "Romanian Deadlift": { movement: "hinge", muscles: { hamstrings: 1, glutes: 1, lowerBack: 0.5 } },
  "Hip Thrust": { movement: "hinge", muscles: { glutes: 1, hamstrings: 0.5, abductors: 0.5 } },
  "Walking Lunge": { movement: "lunge", muscles: { quadriceps: 1, glutes: 1, hamstrings: 0.5, adductors: 0.5, abductors: 0.5, hipFlexors: 0.5 } },
  "Bulgarian Split Squat": { movement: "lunge", muscles: { quadriceps: 1, glutes: 1, hamstrings: 0.5, adductors: 0.5, abductors: 0.5 } },
  "Calf Raise": { movement: "isolation", muscles: { calves: 1 } },
  "Plank": { movement: "isolation", muscles: { abs: 1, obliques: 0.5 } },
  "Hanging Leg Raise": { movement: "isolation", muscles: { abs: 1, hipFlexors: 1, obliques: 0.5 } },
  "Side Plank": { movement: "isolation", muscles: { obliques: 1, abs: 0.5 } },
  "Bird Dog": { movement: "isolation", muscles: { lowerBack: 1, abs: 0.5, glutes: 0.5 } },
  "Sumo Deadlift": { movement: "hinge", muscles: { adductors: 1, glutes: 1, hamstrings: 0.5, lowerBack: 0.5, quadriceps: 0.5 } },
  "Hip Adduction Machine": { movement: "isolation", muscles: { adductors: 1 } },
  "Hip Abduction Machine": { movement: "isolation", muscles: { abductors: 1 } },
  "Standing Cable Hip Flexion": { movement: "isolation", muscles: { hipFlexors: 1 } },
  "Cable Fly": { movement: "horizontalPush", muscles: { chest: 1 } },
  "Face Pull": { movement: "horizontalPull", muscles: { rearDelts: 1, upperBack: 0.5 } },
  "Lateral Raise": { movement: "isolation", muscles: { middleDelts: 1 } },
  "Front Raise": { movement: "isolation", muscles: { frontDelts: 1 } },
  "Shrug": { movement: "isolation", muscles: { traps: 1 } },
  "Good Morning": { movement: "hinge", muscles: { hamstrings: 1, lowerBack: 1, glutes: 0.5 } },
  "Farmer's Carry": { movement: "isolation", muscles: { forearms: 1, traps: 0.5, abs: 0.5 } },
};

// Names seen in real imports (mostly Boostcamp) that don't have a close
// enough builtin equivalent to alias to. Added here rather than guessed
// away so their sets still count toward movement/muscle stats.
const EXTRA_EXERCISES = {
  "1/2 Kneeling Adductor Rock Back": { movement: "isolation", muscles: { adductors: 1, abs: 0.5 } },
  "Ab Wheel": { movement: "isolation", muscles: { abs: 1, hipFlexors: 0.5, obliques: 0.5 } },
  "Back Extension": { movement: "hinge", muscles: { lowerBack: 1, glutes: 0.5, hamstrings: 0.5 } },
  "Chest Supported Row": { movement: "horizontalPull", muscles: { upperBack: 1, lats: 0.5, biceps: 0.5, rearDelts: 0.5 } },
  "Cossack Squat": { movement: "lunge", muscles: { quadriceps: 1, adductors: 1, glutes: 0.5 } },
  "Dead Bug": { movement: "isolation", muscles: { abs: 1, obliques: 0.5 } },
  "Goblet Squat": { movement: "squat", muscles: { quadriceps: 1, glutes: 1, adductors: 0.5, abs: 0.5 } },
  "Incline Bicep Curl": { movement: "isolation", muscles: { biceps: 1, forearms: 0.5 } },
};

export const EMPTY_META = { movement: "isolation", muscles: {} };

const ALL_EXERCISES = { ...BUILTIN_EXERCISES, ...EXTRA_EXERCISES };

function normKey(name) {
  return name.trim().toLowerCase();
}
function stripEquipmentSuffix(name) {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

const LOOKUP = new Map(Object.entries(ALL_EXERCISES).map(([k, v]) => [normKey(k), v]));

// Renames for exercise names whose stripped form still doesn't match a
// builtin/extra key directly (equipment variant, alternate phrasing, etc).
const ALIASES = {
  "wide grip lat pulldown": "Lat Pulldown",
  "b-stance romanian deadlift": "Romanian Deadlift",
  "bicep curl": "Dumbbell Curl",
  "leg raise": "Hanging Leg Raise",
  "reverse lunge": "Walking Lunge",
  "seated shoulder press": "Dumbbell Shoulder Press",
  "single leg calf raise": "Calf Raise",
};

/**
 * Resolve movement pattern + muscle engagement for a logged exercise name,
 * tolerant of equipment suffixes ("Bench Press (Barbell)") and casing.
 * Falls back to EMPTY_META (uncredited) when nothing matches, with
 * `matched: false` so callers can surface what wasn't counted.
 */
export function resolveExerciseMeta(rawName) {
  if (!rawName) return { ...EMPTY_META, matched: false, canonicalName: rawName || "" };

  const direct = LOOKUP.get(normKey(rawName));
  if (direct) return { ...direct, matched: true, canonicalName: rawName };

  const stripped = stripEquipmentSuffix(rawName);
  const strippedKey = normKey(stripped);

  const alias = ALIASES[strippedKey];
  if (alias) {
    const meta = LOOKUP.get(normKey(alias));
    if (meta) return { ...meta, matched: true, canonicalName: alias };
  }

  const strippedMatch = LOOKUP.get(strippedKey);
  if (strippedMatch) return { ...strippedMatch, matched: true, canonicalName: stripped };

  return { ...EMPTY_META, matched: false, canonicalName: stripped };
}
