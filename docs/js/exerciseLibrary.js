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

// "isolation" is intentionally NOT one of these -- isolation-movement
// exercises (curls, leg extensions, etc.) still carry a `movement:
// "isolation"` tag below and still count fully toward Muscle Volume, they
// just don't get their own bucket here. The muscle they target already
// gets full credit, so a separate "Isolation / Core" movement total would
// just be double-booking the same volume under a second, vaguer label.
export const MOVEMENTS = [
  { key: "verticalPush", label: "Vertical Push" },
  { key: "horizontalPush", label: "Horizontal Push" },
  { key: "verticalPull", label: "Vertical Pull" },
  { key: "horizontalPull", label: "Horizontal Pull" },
  { key: "squat", label: "Squat" },
  { key: "hinge", label: "Hinge" },
  { key: "lunge", label: "Lunge" },
];
export const MOVEMENT_LABEL = Object.fromEntries(MOVEMENTS.map((m) => [m.key, m.label]));

// Vertical/horizontal push (and pull) are tracked separately above -- real
// distinctions worth seeing on their own -- but they're also both still
// "push" in the everyday sense, so Movement Pattern Volume shows both: a
// Push/Pull total plus the vertical/horizontal split underneath it.
export const MOVEMENT_GROUPS = [
  { key: "push", label: "Push", members: ["verticalPush", "horizontalPush"] },
  { key: "pull", label: "Pull", members: ["verticalPull", "horizontalPull"] },
];

// `athleticism` (present only on compound/loaded movements, absent = 0 --
// see EMPTY_META and how it's read below) is a per-set weight toward the
// Training Emphasis view's Athleticism score, separate from and additional
// to the movement/muscle credit above. Ordinary compound lifts get a
// modest 0.2-0.4 (they build some general athletic capacity but aren't
// explosive); true power/explosive work is weighted far higher, see
// ATHLETICISM_EXERCISES below. Isolation work stays at 0.
export const BUILTIN_EXERCISES = {
  "Barbell Squat": { movement: "squat", muscles: { quadriceps: 1, glutes: 1, hamstrings: 0.5, abs: 0.5, lowerBack: 0.5, adductors: 0.5 }, athleticism: 0.4 },
  "Bench Press": { movement: "horizontalPush", muscles: { chest: 1, triceps: 0.5, frontDelts: 0.5 }, athleticism: 0.2 },
  "Deadlift": { movement: "hinge", muscles: { hamstrings: 1, glutes: 1, lowerBack: 1, upperBack: 0.5, traps: 0.5, forearms: 0.5 }, athleticism: 0.4 },
  "Overhead Press": { movement: "verticalPush", muscles: { frontDelts: 1, middleDelts: 0.5, triceps: 0.5 }, athleticism: 0.3 },
  "Barbell Row": { movement: "horizontalPull", muscles: { upperBack: 1, lats: 0.5, biceps: 0.5, rearDelts: 0.5 }, athleticism: 0.2 },
  "Pull-Up": { movement: "verticalPull", muscles: { lats: 1, upperBack: 0.5, biceps: 0.5 }, athleticism: 0.3 },
  "Chin-Up": { movement: "verticalPull", muscles: { lats: 1, biceps: 1, upperBack: 0.5 }, athleticism: 0.3 },
  "Push-Up": { movement: "horizontalPush", muscles: { chest: 1, triceps: 0.5, frontDelts: 0.5 }, athleticism: 0.2 },
  "Dip": { movement: "verticalPush", muscles: { triceps: 1, chest: 0.5, frontDelts: 0.5 }, athleticism: 0.2 },
  "Lat Pulldown": { movement: "verticalPull", muscles: { lats: 1, upperBack: 0.5, biceps: 0.5 } },
  "Seated Cable Row": { movement: "horizontalPull", muscles: { upperBack: 1, lats: 0.5, biceps: 0.5 } },
  "Incline Bench Press": { movement: "horizontalPush", muscles: { chest: 1, frontDelts: 0.5, triceps: 0.5 }, athleticism: 0.2 },
  "Dumbbell Bench Press": { movement: "horizontalPush", muscles: { chest: 1, triceps: 0.5, frontDelts: 0.5 }, athleticism: 0.2 },
  "Dumbbell Shoulder Press": { movement: "verticalPush", muscles: { frontDelts: 1, middleDelts: 0.5, triceps: 0.5 }, athleticism: 0.2 },
  "Dumbbell Row": { movement: "horizontalPull", muscles: { upperBack: 1, lats: 0.5, biceps: 0.5 } },
  "Dumbbell Curl": { movement: "isolation", muscles: { biceps: 1, forearms: 0.5 } },
  "Barbell Curl": { movement: "isolation", muscles: { biceps: 1, forearms: 0.5 } },
  "Hammer Curl": { movement: "isolation", muscles: { biceps: 1, forearms: 0.5 } },
  "Tricep Pushdown": { movement: "isolation", muscles: { triceps: 1 } },
  "Skull Crusher": { movement: "isolation", muscles: { triceps: 1 } },
  "Leg Press": { movement: "squat", muscles: { quadriceps: 1, glutes: 0.5, hamstrings: 0.5, adductors: 0.5 }, athleticism: 0.2 },
  "Leg Curl": { movement: "isolation", muscles: { hamstrings: 1 } },
  "Leg Extension": { movement: "isolation", muscles: { quadriceps: 1 } },
  "Romanian Deadlift": { movement: "hinge", muscles: { hamstrings: 1, glutes: 1, lowerBack: 0.5 }, athleticism: 0.3 },
  "Hip Thrust": { movement: "hinge", muscles: { glutes: 1, hamstrings: 0.5, abductors: 0.5 }, athleticism: 0.3 },
  "Walking Lunge": { movement: "lunge", muscles: { quadriceps: 1, glutes: 1, hamstrings: 0.5, adductors: 0.5, abductors: 0.5, hipFlexors: 0.5 }, athleticism: 0.3 },
  "Bulgarian Split Squat": { movement: "lunge", muscles: { quadriceps: 1, glutes: 1, hamstrings: 0.5, adductors: 0.5, abductors: 0.5 }, athleticism: 0.3 },
  "Calf Raise": { movement: "isolation", muscles: { calves: 1 } },
  "Plank": { movement: "isolation", muscles: { abs: 1, obliques: 0.5 } },
  "Hanging Leg Raise": { movement: "isolation", muscles: { abs: 1, hipFlexors: 1, obliques: 0.5 } },
  "Side Plank": { movement: "isolation", muscles: { obliques: 1, abs: 0.5 } },
  "Bird Dog": { movement: "isolation", muscles: { lowerBack: 1, abs: 0.5, glutes: 0.5 } },
  "Sumo Deadlift": { movement: "hinge", muscles: { adductors: 1, glutes: 1, hamstrings: 0.5, lowerBack: 0.5, quadriceps: 0.5 }, athleticism: 0.4 },
  "Hip Adduction Machine": { movement: "isolation", muscles: { adductors: 1 } },
  "Hip Abduction Machine": { movement: "isolation", muscles: { abductors: 1 } },
  "Standing Cable Hip Flexion": { movement: "isolation", muscles: { hipFlexors: 1 } },
  "Cable Fly": { movement: "horizontalPush", muscles: { chest: 1 } },
  "Face Pull": { movement: "horizontalPull", muscles: { rearDelts: 1, upperBack: 0.5 } },
  "Lateral Raise": { movement: "isolation", muscles: { middleDelts: 1 } },
  "Front Raise": { movement: "isolation", muscles: { frontDelts: 1 } },
  "Shrug": { movement: "isolation", muscles: { traps: 1 } },
  "Good Morning": { movement: "hinge", muscles: { hamstrings: 1, lowerBack: 1, glutes: 0.5 }, athleticism: 0.3 },
  "Farmer's Carry": { movement: "isolation", muscles: { forearms: 1, traps: 0.5, abs: 0.5 }, athleticism: 0.4 },
};

// Explosive/power movements -- jumps, throws, Olympic lifts, and similar --
// pre-seeded per an explicit request to track "Athleticism" as its own
// thing, distinct from ordinary strength volume. Weighted well above the
// compound-lift range above (1.0-2.0) since these specifically train
// power/speed/coordination rather than just moving load. Movement-pattern
// tags are the closest biomechanical fit (a box jump is squat-pattern, a
// clean is hinge-pattern); a few genuinely don't fit push/pull/squat/
// hinge/lunge (sprints, burpees) and stay "isolation", same precedent as
// the cardio-finisher entries above (Row/Jog).
const ATHLETICISM_EXERCISES = {
  "Box Jump": { movement: "squat", muscles: { quadriceps: 1, glutes: 1, calves: 0.5 }, athleticism: 1.5 },
  "Broad Jump": { movement: "squat", muscles: { quadriceps: 1, glutes: 1, hamstrings: 0.5 }, athleticism: 1.5 },
  "Depth Jump": { movement: "squat", muscles: { quadriceps: 1, glutes: 1, calves: 0.5 }, athleticism: 1.8 },
  "Jump Squat": { movement: "squat", muscles: { quadriceps: 1, glutes: 1 }, athleticism: 1.2 },
  "Tuck Jump": { movement: "squat", muscles: { quadriceps: 1, calves: 0.5, abs: 0.5 }, athleticism: 1.3 },
  "Medicine Ball Slam": { movement: "isolation", muscles: { abs: 1, obliques: 0.5, lats: 0.5 }, athleticism: 1.3 },
  "Medicine Ball Chest Throw": { movement: "horizontalPush", muscles: { chest: 1, frontDelts: 0.5, triceps: 0.5 }, athleticism: 1.3 },
  "Medicine Ball Rotational Throw": { movement: "isolation", muscles: { obliques: 1, abs: 0.5 }, athleticism: 1.3 },
  "Clean": { movement: "hinge", muscles: { hamstrings: 1, glutes: 1, traps: 1, upperBack: 0.5, quadriceps: 0.5 }, athleticism: 1.8 },
  "Snatch": { movement: "hinge", muscles: { hamstrings: 1, glutes: 1, traps: 1, frontDelts: 0.5, quadriceps: 0.5 }, athleticism: 2 },
  "Clean and Jerk": { movement: "hinge", muscles: { hamstrings: 1, glutes: 1, traps: 1, frontDelts: 0.5, quadriceps: 0.5 }, athleticism: 2 },
  "Jerk": { movement: "verticalPush", muscles: { frontDelts: 1, triceps: 0.5, quadriceps: 0.5 }, athleticism: 1.8 },
  "Push Press": { movement: "verticalPush", muscles: { frontDelts: 1, triceps: 0.5, quadriceps: 0.3 }, athleticism: 1 },
  "Kettlebell Swing": { movement: "hinge", muscles: { glutes: 1, hamstrings: 1, lowerBack: 0.5 }, athleticism: 1 },
  "Sprint": { movement: "isolation", muscles: { quadriceps: 0.5, hamstrings: 1, glutes: 0.5, calves: 0.5 }, athleticism: 1.5 },
  "Burpee": { movement: "isolation", muscles: { chest: 0.5, quadriceps: 0.5, abs: 0.5 }, athleticism: 1 },
  "Battle Ropes": { movement: "isolation", muscles: { frontDelts: 0.5, abs: 0.5, forearms: 0.5 }, athleticism: 1 },
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
  "Narrow Push Up": { movement: "horizontalPush", muscles: { triceps: 1, chest: 0.5, frontDelts: 0.5 } },
  "Overhead Tricep Extension": { movement: "isolation", muscles: { triceps: 1 } },
  // Cardio finishers logged by distance -- see stripDistancePrefix() below,
  // which turns "1km Row" / "2km Row" / etc. into just "Row" before lookup.
  "Row": { movement: "isolation", muscles: { lats: 1, upperBack: 0.5, hamstrings: 0.5, quadriceps: 0.5 } },
  "Jog": { movement: "isolation", muscles: { quadriceps: 0.5, hamstrings: 0.5, calves: 1 } },
};

export const EMPTY_META = { movement: "isolation", muscles: {}, athleticism: 0 };

const ALL_EXERCISES = { ...BUILTIN_EXERCISES, ...ATHLETICISM_EXERCISES, ...EXTRA_EXERCISES };

function normKey(name) {
  return name.trim().toLowerCase();
}
function stripEquipmentSuffix(name) {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}
// "1km Row" / "2km Row" / "5k Run" -> "Row" / "Run" -- cardio finishers
// logged by distance, which varies session to session.
function stripDistancePrefix(name) {
  return name.replace(/^\d+(\.\d+)?\s*km?\s+/i, "").trim();
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
  "push up": "Push-Up",
  "standing shoulder press": "Dumbbell Shoulder Press",
  "hang clean": "Clean",
  "power clean": "Clean",
  "squat clean": "Clean",
  "hang snatch": "Snatch",
  "power snatch": "Snatch",
  "split jerk": "Jerk",
  "push jerk": "Jerk",
  "sprints": "Sprint",
  "burpees": "Burpee",
  "med ball slam": "Medicine Ball Slam",
  "wall ball": "Medicine Ball Chest Throw",
};

// User-added/edited exercises, loaded from the exercise_overrides table at
// app startup (see workouts.js#loadExerciseOverrides) and re-loaded after
// any edit. A row here with an existing name overrides its builtin entry
// (checked first, below); a new name adds a custom exercise -- the same
// "override vs custom" model FitLog already uses locally, just synced
// through Supabase here instead of localStorage.
let OVERRIDES = new Map(); // normKey(name) -> { name, movement, muscles, athleticism }

export function setExerciseOverrides(rows) {
  OVERRIDES = new Map((rows || []).map((r) => [normKey(r.name), { name: r.name, movement: r.movement, muscles: r.muscles || {}, athleticism: r.athleticism || 0 }]));
}

export function getExerciseOverrides() {
  return [...OVERRIDES.values()];
}

// Every known exercise -- builtins merged with overrides (override wins on
// a name collision) -- for the Exercise Library view.
export function getAllExerciseEntries() {
  const merged = new Map();
  Object.entries(ALL_EXERCISES).forEach(([name, meta]) => {
    merged.set(normKey(name), { name, movement: meta.movement, muscles: meta.muscles || {}, athleticism: meta.athleticism || 0, isCustom: false, isOverride: false });
  });
  OVERRIDES.forEach((meta, key) => {
    const isOverride = merged.has(key);
    merged.set(key, { ...meta, isCustom: !isOverride, isOverride });
  });
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve movement pattern + muscle engagement for a logged exercise name,
 * tolerant of equipment suffixes ("Bench Press (Barbell)") and casing.
 * Falls back to EMPTY_META (uncredited) when nothing matches, with
 * `matched: false` so callers can surface what wasn't counted.
 */
export function resolveExerciseMeta(rawName) {
  if (!rawName) return { ...EMPTY_META, matched: false, canonicalName: rawName || "" };

  const override = OVERRIDES.get(normKey(rawName));
  if (override) return { movement: override.movement, muscles: override.muscles, athleticism: override.athleticism, matched: true, canonicalName: override.name };

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

  const distanceStripped = stripDistancePrefix(stripped);
  if (distanceStripped !== stripped) {
    const distanceMatch = LOOKUP.get(normKey(distanceStripped));
    if (distanceMatch) return { ...distanceMatch, matched: true, canonicalName: distanceStripped };
  }

  return { ...EMPTY_META, matched: false, canonicalName: stripped };
}
