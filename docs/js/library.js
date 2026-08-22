// ---------- Exercise Library: view + add/edit ----------
// Mirrors FitLog's own Settings -> Exercise Library screen (same
// primary/secondary muscle model, same override-vs-custom rules), just
// backed by the exercise_overrides table instead of localStorage, so it's
// reachable from the dashboard directly rather than only from FitLog.
import { supabase } from "./supabaseClient.js";
import { MUSCLES, MOVEMENTS, MOVEMENT_LABEL, JOINTS, JOINT_LABEL, getAllExerciseEntries, setExerciseOverrides } from "./exerciseLibrary.js";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export async function loadExerciseOverrides() {
  const { data, error } = await supabase.from("exercise_overrides").select("name, movement, muscles, athleticism, joint_load");
  if (error) throw error;
  setExerciseOverrides(data || []);
}

async function saveOverride({ name, movement, muscles, athleticism, jointLoad }, originalName) {
  if (originalName && originalName !== name) {
    const { error } = await supabase.from("exercise_overrides").delete().eq("name", originalName);
    if (error) throw error;
  }
  const { error } = await supabase
    .from("exercise_overrides")
    .upsert({ name, movement, muscles, athleticism: athleticism || 0, joint_load: jointLoad || {} }, { onConflict: "name" });
  if (error) throw error;
}

async function deleteOverride(name) {
  const { error } = await supabase.from("exercise_overrides").delete().eq("name", name);
  if (error) throw error;
}

export function renderLibraryList(container, onOpen) {
  container.innerHTML = "";
  const all = getAllExerciseEntries();
  if (!all.length) {
    const p = document.createElement("p");
    p.className = "chart-empty";
    p.textContent = "No exercises yet.";
    container.appendChild(p);
    return;
  }

  all.forEach((ex) => {
    const primary = MUSCLES.filter((m) => (ex.muscles || {})[m.key] === 1).map((m) => m.label);
    const secondary = MUSCLES.filter((m) => (ex.muscles || {})[m.key] === 0.5);
    const bits = [MOVEMENT_LABEL[ex.movement] || ex.movement];
    if (primary.length) bits.push(primary.join(", "));
    if (secondary.length) bits.push(`+${secondary.length} secondary`);
    if (ex.athleticism) bits.push(`⚡ ${ex.athleticism}`);
    const joints = Object.entries(ex.jointLoad || {});
    if (joints.length) bits.push(`🦴 ${joints.map(([k, v]) => `${JOINT_LABEL[k] || k} ${v}`).join(", ")}`);

    const row = document.createElement("button");
    row.type = "button";
    row.className = "workout-row";
    row.innerHTML = `
      <span class="workout-row-main">
        <span class="workout-row-name">${esc(ex.name)}${ex.isCustom || ex.isOverride ? ' <span class="linked-badge" title="Custom/edited">✎</span>' : ""}</span>
        <span class="workout-row-sub">${esc(bits.join(" · "))}</span>
      </span>
    `;
    row.addEventListener("click", () => onOpen(ex.name));
    container.appendChild(row);
  });
}

function muscleGridHtml(groupId, checkedKeys) {
  return MUSCLES.map(
    (m) => `
    <label class="muscle-check">
      <input type="checkbox" data-muscle="${m.key}" data-group="${groupId}" ${checkedKeys.includes(m.key) ? "checked" : ""}>
      ${esc(m.label)}
    </label>`
  ).join("");
}

/**
 * name: null for "Add Exercise", or an existing exercise name to edit.
 * onDone(): called after a successful save or delete, so the caller can
 * refresh the list (and anything downstream that reads resolveExerciseMeta).
 */
export function renderExerciseForm(container, name, onDone) {
  const isNew = !name;
  const all = getAllExerciseEntries();
  const existing = isNew ? null : all.find((e) => e.name === name);
  const movement = existing?.movement || "squat";
  const muscles = existing?.muscles || {};
  const athleticism = existing?.athleticism || 0;
  const jointLoad = existing?.jointLoad || {};
  const canDelete = !isNew && existing && (existing.isCustom || existing.isOverride);

  const primaryKeys = Object.keys(muscles).filter((k) => muscles[k] === 1);
  const secondaryKeys = Object.keys(muscles).filter((k) => muscles[k] === 0.5);

  container.innerHTML = `
    <div class="workout-detail-header"><h4>${isNew ? "Add Exercise" : "Edit Exercise"}</h4></div>
    <div class="edit-field"><label>Name</label><input type="text" id="libFormName" value="${esc(name || "")}" placeholder="e.g. Cable Crossover" /></div>
    <div class="edit-field">
      <label>Movement pattern</label>
      <select id="libFormMovement">${MOVEMENTS.map((m) => `<option value="${m.key}" ${m.key === movement ? "selected" : ""}>${esc(m.label)}</option>`).join("")}</select>
    </div>
    <div class="edit-field"><label>Athleticism (0 = none, 0.2–0.5 = compound, 1 = explosive/power)</label><input type="number" id="libFormAthleticism" min="0" max="1.5" step="0.1" value="${athleticism || ""}" placeholder="0" /></div>
    <div class="edit-field">
      <label>Joint load (0 = none, up to ~1 = heavy)</label>
      <div class="joint-load-grid">
        ${JOINTS.map(
          (j) =>
            `<label>${esc(j.label)}<input type="number" id="libFormJoint-${j.key}" min="0" max="2" step="0.1" value="${jointLoad[j.key] || ""}" placeholder="0" /></label>`
        ).join("")}
      </div>
    </div>
    <div class="edit-field"><label>Primary muscles (full credit)</label><div class="muscle-grid" id="libFormPrimary">${muscleGridHtml("primary", primaryKeys)}</div></div>
    <div class="edit-field"><label>Secondary muscles (half credit)</label><div class="muscle-grid" id="libFormSecondary">${muscleGridHtml("secondary", secondaryKeys)}</div></div>
    <div class="workout-detail-actions">
      <button type="button" class="btn primary small" id="libFormSaveBtn">Save exercise</button>
      <button type="button" class="btn ghost small" id="libFormDeleteBtn" ${canDelete ? "" : "hidden"}>Delete</button>
    </div>
  `;

  // Keep primary/secondary mutually exclusive, same as FitLog's form.
  container.querySelectorAll("input[data-muscle]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (!cb.checked) return;
      const other = cb.dataset.group === "primary" ? "secondary" : "primary";
      const twin = container.querySelector(`input[data-muscle="${cb.dataset.muscle}"][data-group="${other}"]`);
      if (twin) twin.checked = false;
    });
  });

  container.querySelector("#libFormSaveBtn").addEventListener("click", async () => {
    const newName = container.querySelector("#libFormName").value.trim();
    if (!newName) {
      alert("Name is required.");
      return;
    }
    const newMovement = container.querySelector("#libFormMovement").value;
    const newAthleticism = parseFloat(container.querySelector("#libFormAthleticism").value) || 0;
    const newJointLoad = {};
    JOINTS.forEach((j) => {
      const v = parseFloat(container.querySelector(`#libFormJoint-${j.key}`).value);
      if (v) newJointLoad[j.key] = v;
    });
    const newMuscles = {};
    container.querySelectorAll('input[data-muscle][data-group="primary"]').forEach((cb) => {
      if (cb.checked) newMuscles[cb.dataset.muscle] = 1;
    });
    container.querySelectorAll('input[data-muscle][data-group="secondary"]').forEach((cb) => {
      if (cb.checked && newMuscles[cb.dataset.muscle] !== 1) newMuscles[cb.dataset.muscle] = 0.5;
    });

    const btn = container.querySelector("#libFormSaveBtn");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      await saveOverride({ name: newName, movement: newMovement, muscles: newMuscles, athleticism: newAthleticism, jointLoad: newJointLoad }, name);
      await loadExerciseOverrides();
      if (onDone) onDone();
    } catch (e) {
      alert(`Couldn't save: ${e.message}`);
      btn.disabled = false;
      btn.textContent = "Save exercise";
    }
  });

  const deleteBtn = container.querySelector("#libFormDeleteBtn");
  if (canDelete) {
    deleteBtn.addEventListener("click", async () => {
      if (!confirm(`Remove "${name}" from your library? Past workouts keep the name either way.`)) return;
      try {
        await deleteOverride(name);
        await loadExerciseOverrides();
        if (onDone) onDone();
      } catch (e) {
        alert(`Couldn't delete: ${e.message}`);
      }
    });
  }
}
