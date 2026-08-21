import { initAuth } from "./auth.js";
import { loadDashboard } from "./dashboard.js";
import { importFitLogBackup } from "./importFitLog.js";
import { renderBarList } from "./charts.js";
import { loadWorkouts, renderWorkoutsList, renderWorkoutDetail, computeExerciseStats, computeMovementMuscleStats } from "./workouts.js";

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

function openWorkout(id) {
  renderWorkoutDetail($("#workoutModalBody"), id);
  $("#workoutModal").hidden = false;
}

async function refreshWorkouts(days) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  await loadWorkouts(start, end);

  renderWorkoutsList($("#workoutsList"), openWorkout);
  renderBarList($("#barExercises"), computeExerciseStats(10), {
    emptyMessage: "No exercises in range yet.",
  });

  const { movementRows, muscleRows, unmatched } = computeMovementMuscleStats();
  renderBarList($("#barMovements"), movementRows, { emptyMessage: "No strength sets in range yet." });
  renderBarList($("#barMuscles"), muscleRows, { emptyMessage: "No strength sets in range yet." });

  const note = $("#unmatchedNote");
  if (unmatched.length) {
    note.hidden = false;
    note.textContent = `Not mapped to a muscle group yet: ${unmatched.join(", ")}`;
  } else {
    note.hidden = true;
  }
}

async function refresh() {
  try {
    await loadDashboard(currentRangeDays());
    await refreshWorkouts(currentRangeDays());
  } catch (e) {
    console.error(e);
    toast("Couldn't load dashboard data — see console.");
  }
}

function initDashboardUI() {
  $("#rangeSelect").addEventListener("change", refresh);

  $("#importBtn").addEventListener("click", () => {
    $("#importModal").hidden = false;
  });
  $("#importClose").addEventListener("click", () => {
    $("#importModal").hidden = true;
  });
  $("#importModal").addEventListener("click", (e) => {
    if (e.target === $("#importModal")) $("#importModal").hidden = true;
  });

  $("#workoutModalClose").addEventListener("click", () => {
    $("#workoutModal").hidden = true;
  });
  $("#workoutModal").addEventListener("click", (e) => {
    if (e.target === $("#workoutModal")) $("#workoutModal").hidden = true;
  });

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
      $("#importStatus").textContent = `Done — ${result.workoutCount} workouts, ${result.setCount} sets, ${result.segmentCount} cardio segments.`;
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

let dashboardInitialized = false;

initAuth({
  onSignedIn: () => {
    $("#loginView").hidden = true;
    $("#mainView").hidden = false;
    if (!dashboardInitialized) {
      dashboardInitialized = true;
      initDashboardUI();
    }
  },
  onSignedOut: () => {
    $("#loginView").hidden = false;
    $("#mainView").hidden = true;
  },
});
