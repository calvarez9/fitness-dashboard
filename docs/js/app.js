import { loadDashboard } from "./dashboard.js";
import { supabase } from "./supabaseClient.js";
import { importFitLogBackup } from "./importFitLog.js";
import { renderBarList, makeCollapsible } from "./charts.js";
import {
  loadWorkouts,
  renderWorkoutsList,
  renderWorkoutDetail,
  renderGarminActivityDetail,
  renderExerciseDetail,
  renderMovementDetail,
  renderMuscleDetail,
  computeExerciseStats,
  computeMovementMuscleStats,
  loadAllTimePRs,
  getAllExerciseNames,
  renderPRBoard,
  loadTrainingEmphasis,
  renderTrainingEmphasis,
  renderStrengthEmphasisDetail,
  renderAthleticismDetail,
  renderCardioIntensityDetail,
  loadJointLoad,
  renderJointLoad,
  renderJointDetail,
  loadCardioZones,
  loadOtherTrainingZones,
  renderCardioZones,
} from "./workouts.js";
import { loadMonth, renderCalendarGrid, renderDayDetail, monthLabel, resetLinksCache } from "./calendar.js";
import { renderBodyMaps, applyVolumeColors } from "./bodyMap.js";
import { renderMetricDetail } from "./health.js";
import { loadExerciseOverrides, renderLibraryList, renderExerciseForm } from "./library.js";
import { MUSCLES, MOVEMENTS, MUSCLE_GROUPS } from "./exerciseLibrary.js";

const $ = (sel) => document.querySelector(sel);

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2500);
}

function currentRangeDays() {
  return parseInt($("#rangeSelect").value, 10);
}

// ---------- Muscle/movement filters (Workouts list + Library list) ----------
const workoutFilter = { muscle: "", movement: "" };
const libraryFilter = { muscle: "", movement: "" };
let librarySort = "name";

// Re-renders just the Library list against whatever's already loaded --
// used by the filter/sort dropdowns, which shouldn't need a data reload.
function refreshLibraryList() {
  renderLibraryList($("#libraryList"), openExerciseEditor, libraryFilter, librarySort);
}

function initFilters() {
  const muscleOptions = MUSCLES.map((m) => `<option value="${m.key}">${escHtml(m.label)}</option>`).join("");
  const movementOptions = MOVEMENTS.map((m) => `<option value="${m.key}">${escHtml(m.label)}</option>`).join("");

  $("#workoutMuscleFilter").insertAdjacentHTML("beforeend", muscleOptions);
  $("#workoutMovementFilter").insertAdjacentHTML("beforeend", movementOptions);
  $("#libraryMuscleFilter").insertAdjacentHTML("beforeend", muscleOptions);
  $("#libraryMovementFilter").insertAdjacentHTML("beforeend", movementOptions);

  $("#workoutMuscleFilter").addEventListener("change", (e) => {
    workoutFilter.muscle = e.target.value;
    refreshWorkoutsList();
  });
  $("#workoutMovementFilter").addEventListener("change", (e) => {
    workoutFilter.movement = e.target.value;
    refreshWorkoutsList();
  });
  $("#libraryMuscleFilter").addEventListener("change", (e) => {
    libraryFilter.muscle = e.target.value;
    refreshLibraryList();
  });
  $("#libraryMovementFilter").addEventListener("change", (e) => {
    libraryFilter.movement = e.target.value;
    refreshLibraryList();
  });
  $("#librarySort").addEventListener("change", (e) => {
    librarySort = e.target.value;
    refreshLibraryList();
  });
}

function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Re-renders just the Workouts list against whatever's already loaded --
// used by the filter dropdowns, which shouldn't need a full data reload.
function refreshWorkoutsList() {
  renderWorkoutsList(
    $("#workoutsList"),
    (id) => pushModal("workout", id),
    (id) => pushModal("garminActivity", id),
    workoutFilter
  );
  makeCollapsible($("#workoutsList"));
}

// ---------- Detail modal: a small back-stack over workout / exercise / movement views ----------
// Movement Pattern Volume -> click a movement -> exercises in it -> click one
// -> sessions it was performed in -> click one -> the full workout, HR and all.
let modalStack = [];

async function onWorkoutSaved() {
  closeModal();
  toast("Saved ✓");
  resetLinksCache();
  await refreshWorkouts(currentRangeDays());
  await refreshCalendar();
  await refreshPRBoard();
}

function renderModalTop() {
  const top = modalStack[modalStack.length - 1];
  $("#workoutModalBack").hidden = modalStack.length <= 1;
  const body = $("#workoutModalBody");
  if (top.type === "workout") renderWorkoutDetail(body, top.payload, onWorkoutSaved);
  else if (top.type === "garminActivity") renderGarminActivityDetail(body, top.payload);
  else if (top.type === "exercise") renderExerciseDetail(body, top.payload, (id) => pushModal("workout", id));
  else if (top.type === "movement") renderMovementDetail(body, top.payload, (name) => pushModal("exercise", name));
  else if (top.type === "muscle") renderMuscleDetail(body, top.payload, (name) => pushModal("exercise", name));
  else if (top.type === "joint") renderJointDetail(body, top.payload, (name) => pushModal("exercise", name));
  else if (top.type === "emphasis") {
    const onOpenExercise = (name) => pushModal("exercise", name);
    if (top.payload === "strength") renderStrengthEmphasisDetail(body, onOpenExercise);
    else if (top.payload === "athleticism") renderAthleticismDetail(body, onOpenExercise);
    else if (top.payload === "cardio") renderCardioIntensityDetail(body);
  }
}

function pushModal(type, payload) {
  modalStack.push({ type, payload });
  $("#workoutModal").hidden = false;
  renderModalTop();
}

function popModal() {
  modalStack.pop();
  if (!modalStack.length) $("#workoutModal").hidden = true;
  else renderModalTop();
}

function closeModal() {
  modalStack = [];
  $("#workoutModal").hidden = true;
}

let lastMuscleTotals = {};

async function refreshWorkouts(days) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  await loadWorkouts(start, end);

  const emphasis = await loadTrainingEmphasis(start, end);
  renderTrainingEmphasis($("#trainingEmphasis"), emphasis, (kind) => pushModal("emphasis", kind));

  const jointLoad = await loadJointLoad(start, end);
  renderJointLoad($("#jointLoad"), jointLoad, (key) => pushModal("joint", key));

  const cardioZones = await loadCardioZones(start, end);
  renderCardioZones($("#cardioZones"), cardioZones, "No cardio activity in range yet.");

  const otherTrainingZones = await loadOtherTrainingZones(start, end);
  renderCardioZones($("#otherTrainingZones"), otherTrainingZones, "No other training activity in range yet.");

  refreshWorkoutsList();

  renderBarList($("#barExercises"), computeExerciseStats(10), {
    emptyMessage: "No exercises in range yet.",
    onClick: (r) => pushModal("exercise", r.label),
  });
  makeCollapsible($("#barExercises"));

  const { movementRows, muscleRows, muscleTotals, unmatched } = computeMovementMuscleStats();
  renderBarList($("#barMovements"), movementRows, {
    emptyMessage: "No strength sets in range yet.",
    onClick: (r) => pushModal("movement", r.key),
  });
  renderBarList($("#barMuscles"), muscleRows, {
    emptyMessage: "No strength sets in range yet.",
    onClick: (r) => pushModal("muscle", r.key),
  });
  makeCollapsible($("#barMuscles"));
  lastMuscleTotals = muscleTotals;
  applyVolumeColors($("#bodyFront"), $("#bodyBack"), muscleTotals);

  const note = $("#unmatchedNote");
  if (unmatched.length) {
    note.hidden = false;
    note.textContent = `Not mapped to a muscle group yet: ${unmatched.join(", ")}`;
  } else {
    note.hidden = true;
  }
}

// All-time (not scoped to the range selector -- a PR from 8 months ago is
// still a PR). Re-run after any edit/delete since that can change them.
async function refreshPRBoard() {
  try {
    await loadAllTimePRs();
    renderPRBoard($("#prBoard"), (name) => pushModal("exercise", name));
    makeCollapsible($("#prBoard"));
  } catch (e) {
    console.error(e);
  }
}

// ---------- Health metric "your range" panels ----------
const METRIC_CONTAINER_ID = { rhr: "detailRhr", battery: "detailBattery", stress: "detailStress", steps: "detailSteps", sleep: "detailSleep" };
const openMetricPanels = new Set();

function initHealthDetails() {
  $$(".stat-detail-toggle").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const metric = btn.dataset.metric;
      const container = $(`#${METRIC_CONTAINER_ID[metric]}`);
      if (!container.hidden) {
        container.hidden = true;
        btn.classList.remove("expanded");
        openMetricPanels.delete(metric);
        return;
      }
      container.hidden = false;
      btn.classList.add("expanded");
      openMetricPanels.add(metric);
      await renderMetricDetail(container, metric, currentRangeDays());
    });
  });
}

async function refreshOpenMetricPanels() {
  for (const metric of openMetricPanels) {
    const container = $(`#${METRIC_CONTAINER_ID[metric]}`);
    if (container) await renderMetricDetail(container, metric, currentRangeDays());
  }
}

// ---------- Exercise Library ----------
function showLibraryList() {
  $("#libraryListSection").hidden = false;
  $("#libraryFormSection").hidden = true;
}

function openExerciseEditor(name) {
  $("#libraryListSection").hidden = true;
  $("#libraryFormSection").hidden = false;
  renderExerciseForm($("#libraryFormBody"), name, onLibraryChanged);
}

async function onLibraryChanged() {
  showLibraryList();
  refreshLibraryList();
  toast("Saved ✓");
  // Editing an exercise's movement/muscles/athleticism can change every
  // downstream stat that reads it -- refresh those too, not just the list.
  await refreshWorkouts(currentRangeDays());
  await refreshPRBoard();
}

async function refresh() {
  try {
    // Overrides must be loaded before anything computes movement/muscle/
    // athleticism stats, since resolveExerciseMeta() checks them first.
    await loadExerciseOverrides();
    refreshLibraryList();
    await loadDashboard(currentRangeDays());
    await refreshWorkouts(currentRangeDays());
    await refreshPRBoard();
    await refreshOpenMetricPanels();
  } catch (e) {
    console.error(e);
    toast("Couldn't load dashboard data — see console.");
  }
}

// ---------- Calendar ----------
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

async function onCalendarDaySaved(dateKey) {
  resetLinksCache();
  toast("Saved ✓");
  await refreshWorkouts(currentRangeDays());
  await renderCalendarAndGrid(dateKey);
  await refreshPRBoard();
}

let currentDailyByDate = new Map();

async function openCalendarDay(dateKey, events) {
  await renderDayDetail($("#calDayDetail"), dateKey, events, currentDailyByDate.get(dateKey), () => onCalendarDaySaved(dateKey));
  $$(".cal-day", $("#calGrid")).forEach((el) => el.classList.toggle("selected", el.dataset.date === dateKey));
}

async function renderCalendarAndGrid(selectedDateKey) {
  const { byDay, dailyByDate } = await loadMonth(calMonth);
  currentDailyByDate = dailyByDate;
  renderCalendarGrid($("#calGrid"), calMonth, byDay, openCalendarDay);
  if (selectedDateKey) await openCalendarDay(selectedDateKey, byDay.get(selectedDateKey) || []);
}

async function refreshCalendar() {
  $("#calMonthLabel").textContent = monthLabel(calMonth);
  $("#calDayDetail").innerHTML = "";
  try {
    await renderCalendarAndGrid();
  } catch (e) {
    console.error(e);
    $("#calGrid").innerHTML = "";
    toast("Couldn't load calendar — see console.");
  }
}

function $$(sel, root = document) {
  return root.querySelectorAll(sel);
}

const TAB_STORAGE_KEY = "fitnessDashboardActiveTab";

function setActiveTab(tab) {
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".tab-panel").forEach((p) => (p.hidden = p.dataset.tab !== tab));
  localStorage.setItem(TAB_STORAGE_KEY, tab);
}

function initTabs() {
  $$(".tab-btn").forEach((btn) => btn.addEventListener("click", () => setActiveTab(btn.dataset.tab)));
  const saved = localStorage.getItem(TAB_STORAGE_KEY);
  const valid = [...$$(".tab-btn")].some((b) => b.dataset.tab === saved);
  setActiveTab(valid ? saved : "health");
}

function initDashboardUI() {
  initTabs();
  initHealthDetails();
  initFilters();

  $("#newExerciseBtn").addEventListener("click", () => openExerciseEditor(null));
  $("#libraryFormBackBtn").addEventListener("click", showLibraryList);

  $("#rangeSelect").addEventListener("change", refresh);

  $("#importBtn").addEventListener("click", () => {
    $("#importModal").hidden = false;
  });
  $("#syncNowBtn").addEventListener("click", async () => {
    const btn = $("#syncNowBtn");
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "…";
    try {
      const { error } = await supabase.functions.invoke("trigger-garmin-sync", { body: {} });
      if (error) throw error;
      toast("Sync triggered — check back in a minute");
    } catch (e) {
      console.error(e);
      toast("Couldn't trigger sync — see console");
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
  $("#importClose").addEventListener("click", () => {
    $("#importModal").hidden = true;
  });
  $("#importModal").addEventListener("click", (e) => {
    if (e.target === $("#importModal")) $("#importModal").hidden = true;
  });

  $("#workoutModalBack").addEventListener("click", popModal);
  $("#workoutModalClose").addEventListener("click", closeModal);
  $("#workoutModal").addEventListener("click", (e) => {
    if (e.target === $("#workoutModal")) closeModal();
  });

  $("#searchInput").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    const results = $("#searchResults");
    results.innerHTML = "";
    if (!q) return;
    getAllExerciseNames()
      .filter((name) => name.toLowerCase().includes(q))
      .slice(0, 8)
      .forEach((name) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "workout-row";
        const nameEl = document.createElement("span");
        nameEl.className = "workout-row-main";
        const inner = document.createElement("span");
        inner.className = "workout-row-name";
        inner.textContent = name;
        nameEl.appendChild(inner);
        row.appendChild(nameEl);
        row.addEventListener("click", () => {
          pushModal("exercise", name);
          e.target.value = "";
          results.innerHTML = "";
        });
        results.appendChild(row);
      });
  });

  renderBodyMaps($("#bodyFront"), $("#bodyBack"), (muscleKeys) => {
    // A region whose muscle keys are exactly one MUSCLE_GROUPS entry's
    // members (e.g. trapezius -> upper/middle/lower traps) opens the
    // group's own detail view (the upper/middle/lower split + combined
    // exercise list), not just whichever single sub-muscle happens to
    // have the most volume -- that was the bug: clicking always jumped
    // straight to "Upper Traps" alone since it was the only one with any
    // data, and the split view (which explains that "middle/lower have no
    // logged volume yet") never got a chance to show.
    const group = MUSCLE_GROUPS.find((g) => g.members.length === muscleKeys.length && g.members.every((m) => muscleKeys.includes(m)));
    if (group) {
      pushModal("muscle", group.key);
      return;
    }
    const best = muscleKeys.reduce((a, b) => ((lastMuscleTotals[b] || 0) > (lastMuscleTotals[a] || 0) ? b : a));
    pushModal("muscle", best);
  });

  $("#calPrev").addEventListener("click", () => {
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
    refreshCalendar();
  });
  $("#calNext").addEventListener("click", () => {
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
    refreshCalendar();
  });
  refreshCalendar();

  $("#importGoBtn").addEventListener("click", async () => {
    const file = $("#importFile").files[0];
    if (!file) {
      $("#importStatus").textContent = "Choose a file first.";
      return;
    }
    $("#importGoBtn").disabled = true;
    $("#importStatus").textContent = "Importing…";
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = await importFitLogBackup(data, (done, total) => {
        $("#importStatus").textContent = `Importing… ${done}/${total} workouts`;
      });
      $("#importStatus").textContent = `Done — ${result.workoutCount} workouts, ${result.setCount} sets, ${result.segmentCount} cardio segments, ${result.exerciseCount} exercise definitions.`;
      toast("FitLog backup imported ✓");
      await refresh();
    } catch (e) {
      console.error(e);
      $("#importStatus").textContent = `Failed: ${e.message}`;
    }
    $("#importGoBtn").disabled = false;
  });

  refresh();
}

// No login gate -- an explicit, informed choice (see schema/012), not an
// oversight. Supabase is queried as the anon role from here on; the RLS
// policies/grants in that migration are what make anon's requests
// actually succeed instead of hitting permission errors everywhere.
initDashboardUI();
