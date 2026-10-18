import { api, cache } from "./api.js";
import { state, performAction, undo, redo } from "./state.js";
import { normalizePolygon, getSVGCoordinates } from "./geometry.js";
import { renderRegions } from "./render.js";

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const mapWrapper = $("map-wrapper");
const mapImage = $("map-image");
const mapSvg = $("map-svg");
const regionsGroup = $("regions-group");
const labelsGroup = $("labels-group");
const drawingGroup = $("drawing-group");
const tempLine = $("temp-line");
const tempPreview = $("temp-line-preview");
const closeHint = $("close-hint");

const btnEdit = $("btn-edit-mode");
const btnView = $("btn-view-mode");
const btnUndo = $("btn-undo");
const btnRedo = $("btn-redo");
const btnExport = $("btn-export");
const syncStatus = $("sync-status");

const regionList = $("region-list");
const deletedList = $("deleted-list");
const editPanel = $("edit-panel");
const viewPanel = $("view-panel");
const infoTitle = $("info-title");
const infoDesc = $("info-desc");

const modal = $("region-modal");
const modalHeading = $("modal-heading");
const modalTitle = $("modal-title");
const modalDesc = $("modal-desc");
const modalColor = $("modal-color");
const btnModalSave = $("btn-modal-save");
const btnModalCancel = $("btn-modal-cancel");
const btnModalDelete = $("btn-modal-delete");

const histModal = $("history-modal");
const histList = $("history-list");
const histName = $("history-region-name");
const btnHistClose = $("btn-history-close");

const toast = $("toast");

// ---------- Toast ----------
let toastTimer;
function showToast(msg, kind = "info") {
  toast.textContent = msg;
  toast.className = `fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-xl z-50 ${
    kind === "error" ? "bg-red-800 border border-red-600" : "bg-gray-800 border border-gray-700"
  }`;
  toast.style.opacity = "1";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.style.opacity = "0"; }, 2500);
}

// ---------- Init ----------
async function init() {
  await loadImage();
  await loadRegions();
  bindEvents();
  updateModeUI();
  updateUndoUI();
}

function loadImage() {
  return new Promise((resolve) => {
    const apply = () => {
      state.image.el = mapImage;
      state.image.width = mapImage.naturalWidth;
      state.image.height = mapImage.naturalHeight;
      mapSvg.setAttribute("viewBox", `0 0 ${state.image.width} ${state.image.height}`);
      resolve();
    };
    if (mapImage.complete && mapImage.naturalWidth > 0) apply();
    else {
      mapImage.addEventListener("load", apply, { once: true });
      mapImage.addEventListener("error", () => {
        showToast("Failed to load /map.jpg", "error");
        resolve();
      }, { once: true });
    }
  });
}

async function loadRegions() {
  try {
    state.regions = await api.list();
    state.offline = false;
    cache.save(state.regions);
  } catch (err) {
    state.offline = true;
    state.regions = cache.load();
    showToast("Offline — using cached data (writes disabled)", "error");
  }
  syncStatus.textContent = state.offline ? "Offline (cached)" : "Connected";
  syncStatus.className = `text-xs px-2 py-1 rounded ${
    state.offline ? "bg-red-900 text-red-200" : "bg-gray-700 text-gray-300"
  }`;
  refreshAll();
}

function refreshAll() {
  renderRegions(regionsGroup, labelsGroup);
  renderSidebar();
  updateUndoUI();
}

// ---------- Mode ----------
function setMode(mode) {
  state.mode = mode;
  cancelDrawing();
  mapWrapper.classList.toggle("mode-edit", mode === "EDIT");
  mapWrapper.classList.toggle("mode-interactive", mode === "VIEW");
  updateModeUI();
}

function updateModeUI() {
  const edit = state.mode === "EDIT";
  editPanel.classList.toggle("hidden", !edit);
  viewPanel.classList.toggle("hidden", edit);
  btnEdit.className = edit
    ? "px-3 py-1.5 rounded bg-blue-600 text-white font-semibold shadow text-sm"
    : "px-3 py-1.5 rounded text-gray-300 hover:bg-gray-600 text-sm";
  btnView.className = !edit
    ? "px-3 py-1.5 rounded bg-blue-600 text-white font-semibold shadow text-sm"
    : "px-3 py-1.5 rounded text-gray-300 hover:bg-gray-600 text-sm";
  if (!edit) {
    infoTitle.textContent = "Select a Region";
    infoDesc.textContent = "Hover over highlighted areas on the map and click them to view details.";
  }
}

function updateUndoUI() {
  btnUndo.disabled = state.undoStack.length === 0;
  btnRedo.disabled = state.redoStack.length === 0;
}

// ---------- Sidebar ----------
async function renderSidebar() {
  regionList.innerHTML = "";
  if (state.regions.length === 0) {
    regionList.innerHTML = '<li class="italic text-gray-500">No regions yet.</li>';
  } else {
    for (const r of state.regions) {
      const li = document.createElement("li");
      li.className = "flex items-center gap-1 bg-gray-700 px-2 py-1 rounded";
      const dot = document.createElement("span");
      dot.className = "w-2 h-2 rounded-full shrink-0";
      dot.style.background = r.color;
      const name = document.createElement("span");
      name.className = "truncate flex-1 cursor-pointer hover:text-white";
      name.textContent = r.title;
      name.onclick = () => selectRegion(r.id);
      const histBtn = document.createElement("button");
      histBtn.textContent = "◷";
      histBtn.title = "History";
      histBtn.className = "text-gray-400 hover:text-white px-1";
      histBtn.onclick = () => openHistory(r.id);
      const delBtn = document.createElement("button");
      delBtn.innerHTML = "&times;";
      delBtn.title = "Delete";
      delBtn.className = "text-red-400 hover:text-red-300 font-bold px-1";
      delBtn.onclick = () => deleteRegion(r.id);
      li.append(dot, name, histBtn, delBtn);
      regionList.appendChild(li);
    }
  }

  // Deleted regions
  deletedList.innerHTML = "";
  if (state.offline) {
    deletedList.innerHTML = '<li class="italic">Unavailable offline.</li>';
    return;
  }
  try {
    const deleted = await api.deleted();
    if (!deleted.length) {
      deletedList.innerHTML = '<li class="italic">None.</li>';
    } else {
      for (const d of deleted) {
        const li = document.createElement("li");
        li.className = "flex items-center gap-1 bg-gray-700/50 px-2 py-1 rounded";
        const name = document.createElement("span");
        name.className = "truncate flex-1";
        name.textContent = d.title;
        const restoreBtn = document.createElement("button");
        restoreBtn.textContent = "Restore";
        restoreBtn.className = "text-green-400 hover:text-green-300 text-xs px-1";
        restoreBtn.onclick = () => restoreDeleted(d.id);
        li.append(name, restoreBtn);
        deletedList.appendChild(li);
      }
    }
  } catch {
    deletedList.innerHTML = '<li class="italic">Failed to load.</li>';
  }
}

function selectRegion(id) {
  const r = state.regions.find((x) => x.id === id);
  if (!r) return;
  state.selectedId = id;
  if (state.mode === "VIEW") {
    infoTitle.textContent = r.title;
    infoDesc.textContent = r.description || "No description provided.";
  } else {
    openEditModal(r);
  }
}

// ---------- CRUD with undo ----------
async function createRegion(data) {
  if (state.offline) { showToast("Cannot save while offline", "error"); return null; }
  const created = await api.create(data);
  await performAction(
    `Create "${created.title}"`,
    async () => {
      state.regions.push(created);
      cache.save(state.regions);
      refreshAll();
    },
    async () => {
      await api.delete(created.id);
      state.regions = state.regions.filter((r) => r.id !== created.id);
      cache.save(state.regions);
      refreshAll();
    }
  );
  return created;
}

async function updateRegion(id, patch) {
  if (state.offline) { showToast("Cannot save while offline", "error"); return; }
  const before = structuredClone(state.regions.find((r) => r.id === id));
  const after = await api.update(id, patch);
  await performAction(
    `Update "${after.title}"`,
    async () => {
      state.regions = state.regions.map((r) => (r.id === id ? after : r));
      cache.save(state.regions);
      refreshAll();
    },
    async () => {
      await api.update(id, {
        title: before.title,
        description: before.description,
        color: before.color,
        points: before.points
      });
      state.regions = state.regions.map((r) => (r.id === id ? before : r));
      cache.save(state.regions);
      refreshAll();
    }
  );
}

async function deleteRegion(id) {
  if (state.offline) { showToast("Cannot delete while offline", "error"); return; }
  if (!confirm("Delete this region?")) return;
  const before = structuredClone(state.regions.find((r) => r.id === id));
  await api.delete(id);
  await performAction(
    `Delete "${before.title}"`,
    async () => {
      state.regions = state.regions.filter((r) => r.id !== id);
      cache.save(state.regions);
      refreshAll();
    },
    async () => {
      const restored = await api.create({
        title: before.title,
        description: before.description,
        color: before.color,
        points: before.points
      });
      state.regions.push(restored);
      cache.save(state.regions);
      refreshAll();
    }
  );
}

async function restoreDeleted(id) {
  try {
    const restored = await api.restore(id, { fromDeleted: true });
    state.regions.push(restored);
    cache.save(state.regions);
    refreshAll();
    showToast(`Restored "${restored.title}"`);
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ---------- Modal ----------
function openEditModal(region) {
  modalHeading.textContent = "Edit Region";
  modalTitle.value = region.title;
  modalDesc.value = region.description;
  modalColor.value = region.color;
  btnModalDelete.classList.remove("hidden");
  modal.dataset.regionId = region.id;
  modal.classList.remove("hidden");
  modalTitle.focus();
}

function openCreateModal() {
  modalHeading.textContent = "New Region";
  modalTitle.value = "";
  modalDesc.value = "";
  modalColor.value = "#3b82f6";
  btnModalDelete.classList.add("hidden");
  delete modal.dataset.regionId;
  modal.classList.remove("hidden");
  modalTitle.focus();
}

function closeModal() { modal.classList.add("hidden"); }

btnModalCancel.onclick = () => { closeModal(); cancelDrawing(); };

btnModalSave.onclick = async () => {
  const title = modalTitle.value.trim() || "Untitled Region";
  const description = modalDesc.value.trim();
  const color = modalColor.value;
  const id = modal.dataset.regionId;

  try {
    if (id) {
      await updateRegion(id, { title, description, color });
    } else {
      const normPts = normalizePolygon(state.currentPoints, state.image.width, state.image.height);
      await createRegion({ title, description, color, points: normPts });
    }
    closeModal();
    cancelDrawing();
  } catch (err) {
    showToast(err.message, "error");
  }
};

btnModalDelete.onclick = async () => {
  const id = modal.dataset.regionId;
  if (!id) return;
  closeModal();
  await deleteRegion(id);
};

// ---------- History modal ----------
async function openHistory(id) {
  try {
    const [h, r] = await Promise.all([api.history(id), api.get(id).catch(() => null)]);
    histName.textContent = r ? r.title : "(deleted region)";
    histList.innerHTML = "";
    if (!h.versions?.length) {
      histList.innerHTML = '<li class="text-gray-500 italic">No history yet.</li>';
    } else {
      h.versions.forEach((v, i) => {
        const li = document.createElement("li");
        li.className = "bg-gray-700 px-3 py-2 rounded flex justify-between items-center gap-2";
        const info = document.createElement("div");
        info.className = "min-w-0";
        info.innerHTML = `<div class="text-sm font-medium truncate">${escapeHtml(v.title || "Untitled")}</div>
          <div class="text-xs text-gray-400">${new Date(v.archivedAt).toLocaleString()}</div>`;
        const btn = document.createElement("button");
        btn.textContent = "Restore";
        btn.className = "text-green-400 hover:text-green-300 text-xs shrink-0";
        btn.onclick = async () => {
          try {
            const restored = await api.restore(id, { versionIndex: i });
            state.regions = state.regions.map((x) => (x.id === id ? restored : x));
            cache.save(state.regions);
            refreshAll();
            histModal.classList.add("hidden");
            showToast(`Restored "${restored.title}"`);
          } catch (err) {
            showToast(err.message, "error");
          }
        };
        li.append(info, btn);
        histList.appendChild(li);
      });
    }
    histModal.classList.remove("hidden");
  } catch (err) {
    showToast(err.message, "error");
  }
}

btnHistClose.onclick = () => histModal.classList.add("hidden");

// ---------- Drawing ----------
function onMapClick(e) {
  if (state.mode !== "EDIT" || !modal.classList.contains("hidden")) return;

  // If we have points and click near the first vertex, close the polygon
  if (state.currentPoints.length >= 3) {
    const coords = getSVGCoordinates(e, mapSvg);
    const first = state.currentPoints[0];
    if (Math.hypot(coords.x - first.x, coords.y - first.y) < 20) {
      finishDrawing();
      return;
    }
  }

  const coords = getSVGCoordinates(e, mapSvg);
  state.currentPoints.push({ x: coords.x, y: coords.y });
  updateTempDrawing();
}

function onMapMove(e) {
  if (state.mode !== "EDIT" || state.currentPoints.length === 0) return;
  const coords = getSVGCoordinates(e, mapSvg);
  const all = [...state.currentPoints, { x: coords.x, y: coords.y }];
  tempLine.setAttribute("points", all.map((p) => `${p.x},${p.y}`).join(" "));

  // Preview closing line back to first point
  if (state.currentPoints.length >= 3) {
    const first = state.currentPoints[0];
    tempPreview.setAttribute("points", `${coords.x},${coords.y} ${first.x},${first.y}`);
    tempPreview.style.display = "";
  } else {
    tempPreview.style.display = "none";
  }

  // Highlight first vertex when close
  closeHint.style.display = "none";
  if (state.currentPoints.length >= 3) {
    const first = state.currentPoints[0];
    if (Math.hypot(coords.x - first.x, coords.y - first.y) < 20) {
      closeHint.setAttribute("cx", first.x);
      closeHint.setAttribute("cy", first.y);
      closeHint.setAttribute("r", 14);
      closeHint.style.display = "";
    }
  }
}

function updateTempDrawing() {
  tempLine.setAttribute("points", state.currentPoints.map((p) => `${p.x},${p.y}`).join(" "));
  drawingGroup.querySelectorAll("circle:not(#close-hint)").forEach((c) => c.remove());
  state.currentPoints.forEach((p) => {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", p.x);
    c.setAttribute("cy", p.y);
    c.setAttribute("r", Math.max(4, state.image.width / 300));
    c.classList.add("draw-point");
    drawingGroup.appendChild(c);
  });
  closeHint.style.display = "none";
}

function cancelDrawing() {
  state.currentPoints = [];
  tempLine.setAttribute("points", "");
  tempPreview.setAttribute("points", "");
  tempPreview.style.display = "none";
  closeHint.style.display = "none";
  drawingGroup.querySelectorAll("circle:not(#close-hint)").forEach((c) => c.remove());
}

function finishDrawing() {
  if (state.currentPoints.length < 3) return;
  openCreateModal();
}

function removeLastVertex() {
  if (state.currentPoints.length === 0) return;
  state.currentPoints.pop();
  updateTempDrawing();
}

// ---------- Events ----------
function bindEvents() {
  mapSvg.addEventListener("click", onMapClick);
  mapSvg.addEventListener("mousemove", onMapMove);
  mapSvg.addEventListener("dblclick", (e) => {
    e.preventDefault();
    if (state.currentPoints.length >= 3) finishDrawing();
  });

  // Region click (view mode) via delegation
  regionsGroup.addEventListener("click", (e) => {
    const poly = e.target.closest(".region-polygon");
    if (!poly) return;
    if (state.mode === "VIEW") selectRegion(poly.dataset.id);
    else if (state.mode === "EDIT") selectRegion(poly.dataset.id);
  });

  btnEdit.onclick = () => setMode("EDIT");
  btnView.onclick = () => setMode("VIEW");
  btnUndo.onclick = async () => {
    try { if (await undo()) { updateUndoUI(); showToast("Undone"); } }
    catch (err) { showToast(err.message, "error"); }
  };
  btnRedo.onclick = async () => {
    try { if (await redo()) { updateUndoUI(); showToast("Redone"); } }
    catch (err) { showToast(err.message, "error"); }
  };

  btnExport.onclick = () => {
    const data = JSON.stringify(state.regions, null, 2);
    const a = document.createElement("a");
    a.href = "data:application/json;charset=utf-8," + encodeURIComponent(data);
    a.download = "map_regions.json";
    a.click();
  };

  $("image-upload").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      mapImage.src = ev.target.result;
      mapImage.onload = () => {
        state.image.width = mapImage.naturalWidth;
        state.image.height = mapImage.naturalHeight;
        mapSvg.setAttribute("viewBox", `0 0 ${state.image.width} ${state.image.height}`);
        refreshAll();
        showToast("Map preview changed (session only)");
      };
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  });

  window.addEventListener("keydown", (e) => {
    // Don't intercept when typing in modal inputs
    if (modal.contains(document.activeElement) && document.activeElement.tagName !== "BUTTON") {
      if (e.key === "Escape") { closeModal(); cancelDrawing(); }
      return;
    }

    if (state.mode !== "EDIT") return;

    if (e.key === "Enter" && state.currentPoints.length >= 3) {
      e.preventDefault();
      finishDrawing();
    } else if (e.key === "Escape") {
      cancelDrawing();
    } else if (e.key === "Backspace" && state.currentPoints.length > 0) {
      e.preventDefault();
      removeLastVertex();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) btnRedo.click();
      else btnUndo.click();
    }
  });

  window.addEventListener("online", () => { showToast("Back online"); loadRegions(); });
  window.addEventListener("offline", () => { showToast("Offline", "error"); state.offline = true; });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

init();