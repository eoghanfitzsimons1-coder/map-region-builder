// --- State ---
let regions = [];
let currentPoints = [];
let mode = 'EDIT';
let mapWidth = 0, mapHeight = 0;
let undoStack = [], redoStack = [];
let editingId = null;
let selectedRegionId = null;
let draggedVertexIndex = null;

// Zoom & Pan State
let currentViewBox = { x: 0, y: 0, w: 0, h: 0 };
let isPanning = false;
let hasDragged = false;
let panStart = { x: 0, y: 0 };
let mouseStart = { x: 0, y: 0 };

// --- DOM ---
const $ = id => document.getElementById(id);
const mapWrapper = $('map-wrapper'), mapImage = $('map-image'), mapSvg = $('map-svg');
const regionsGroup = $('regions-group'), labelsGroup = $('labels-group'), verticesGroup = $('vertices-group');
const tempLine = $('temp-line'), tempPreview = $('temp-line-preview'), closeHint = $('close-hint');
const regionList = $('region-list'), infoTitle = $('info-title'), infoCards = $('info-cards');
const modal = $('region-modal'), modalTitle = $('modal-title'), modalColor = $('modal-color');

function loadImage() {
    return new Promise(resolve => {
        const applySize = () => {
            mapWidth = mapImage.naturalWidth; mapHeight = mapImage.naturalHeight;
            currentViewBox = { x: 0, y: 0, w: mapWidth, h: mapHeight };
            updateViewBox();
            resolve();
        };
        if (mapImage.complete && mapImage.naturalWidth > 0) applySize();
        else {
            mapImage.onload = applySize;
            mapImage.onerror = () => { showToast("Map image not found.", "error"); resolve(); };
        }
    });
}

function updateViewBox() {
    mapSvg.setAttribute('viewBox', `${currentViewBox.x} ${currentViewBox.y} ${currentViewBox.w} ${currentViewBox.h}`);
}

// --- Storage & UI ---

function pushUndo() {
    undoStack.push(JSON.stringify(regions));
    redoStack = [];
    updateUndoUI();
}

function updateUndoUI() {
    $('btn-undo').disabled = undoStack.length === 0;
    $('btn-redo').disabled = redoStack.length === 0;
}

function showToast(msg, type='info') {
    const t = $('toast');
    t.textContent = msg;
    t.className = `fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-xl z-50 ${type === 'error' ? 'bg-red-800' : 'bg-gray-800'} transition-opacity opacity-100`;
    setTimeout(() => t.style.opacity = '0', 2500);
}

function refreshUI() {
    renderRegions();
    renderVertices();
    renderSidebar();
    updateUndoUI();
}

// --- Math Helpers ---
function getSVGCoordinates(evt) {
    const pt = mapSvg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    return pt.matrixTransform(mapSvg.getScreenCTM().inverse());
}

function hexAlpha(hex, alpha) {
    const m = hex.replace('#', '');
    const n = parseInt(m, 16);
    return `rgba(${(n>>16)&255}, ${(n>>8)&255}, ${n&255}, ${alpha})`;
}

// --- Rendering ---
function renderRegions() {
    regionsGroup.innerHTML = ''; labelsGroup.innerHTML = '';
    regions.forEach(r => {
        const pts = r.points.map(p => `${p.x * mapWidth},${p.y * mapHeight}`).join(' ');
        
        const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        poly.setAttribute('points', pts);
        poly.dataset.id = r.id;
        poly.classList.add('region-polygon');
        poly.setAttribute('fill', hexAlpha(r.color, 0.25));
        poly.setAttribute('stroke', r.color);
        if (selectedRegionId === r.id) poly.setAttribute('stroke-width', '4');
        regionsGroup.appendChild(poly);

        let cx = 0, cy = 0;
        r.points.forEach(p => { cx += p.x * mapWidth; cy += p.y * mapHeight; });
        cx /= r.points.length; cy /= r.points.length;

        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute('x', cx); label.setAttribute('y', cy);
        label.classList.add('region-label');
        // Scale label based on zoom level so it stays readable
        label.setAttribute('font-size', Math.max(12, currentViewBox.w / 80));
        label.textContent = r.title;
        labelsGroup.appendChild(label);
    });
}

function renderVertices() {
    verticesGroup.innerHTML = '';
    if (!selectedRegionId || mode !== 'EDIT') return;
    
    const r = regions.find(x => x.id === selectedRegionId);
    if (!r) return;

    r.points.forEach((p, i) => {
        const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c.setAttribute('cx', p.x * mapWidth);
        c.setAttribute('cy', p.y * mapHeight);
        c.setAttribute('r', Math.max(4, currentViewBox.w / 200));
        c.classList.add('vertex-handle');
        c.dataset.index = i;
        verticesGroup.appendChild(c);
    });
}

function renderSidebar() {
    regionList.innerHTML = '';
    if (regions.length === 0) {
        regionList.innerHTML = '<li class="italic text-gray-500">No regions yet.</li>';
        return;
    }
    regions.forEach(r => {
        const li = document.createElement('li');
        li.className = `flex items-center gap-2 bg-gray-700 px-2 py-1 rounded ${selectedRegionId === r.id ? 'ring-2 ring-blue-500' : ''}`;
        li.innerHTML = `
            <span class="w-3 h-3 rounded-full shrink-0" style="background:${r.color}"></span>
            <span class="truncate flex-1 cursor-pointer hover:text-white">${r.title}</span>
            <button class="text-red-400 hover:text-red-300 font-bold px-1" onclick="deleteRegion('${r.id}')">&times;</button>
        `;
        li.querySelector('span:nth-child(2)').onclick = () => editRegion(r.id);
        regionList.appendChild(li);
    });
}

// --- Drawing Logic ---
function updateTempDrawing() {
    tempLine.setAttribute('points', currentPoints.map(p => `${p.x},${p.y}`).join(' '));
    document.querySelectorAll('.draw-point').forEach(c => c.remove());
    currentPoints.forEach(p => {
        const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c.setAttribute('cx', p.x); c.setAttribute('cy', p.y);
        c.setAttribute('r', Math.max(4, currentViewBox.w / 200));
        c.classList.add('draw-point');
        $('drawing-group').appendChild(c);
    });
}

function finishDrawing() {
    if (currentPoints.length < 3) return;
    editingId = null;
    $('modal-heading').textContent = 'New Region';
    modalTitle.value = ''; modalColor.value = '#3b82f6';
    
    const details = ['climate','resources','capital','settlements','gov','export','religion','danger'];
    details.forEach(d => $('det-'+d).value = '');

    $('btn-modal-delete').classList.add('hidden');
    modal.classList.remove('hidden');
    modalTitle.focus();
}

function cancelDrawing() {
    currentPoints = [];
    tempLine.setAttribute('points', '');
    tempPreview.setAttribute('points', '');
    closeHint.style.display = 'none';
    document.querySelectorAll('.draw-point').forEach(c => c.remove());
}

// --- Interactions ---
function bindEvents() {
    // --- Zoom ---
    mapSvg.addEventListener('wheel', e => {
        e.preventDefault();
        const coords = getSVGCoordinates(e);
        const scale = e.deltaY > 0 ? 1.15 : 0.85; // Zoom out / in
        
        let newW = currentViewBox.w * scale;
        let newH = currentViewBox.h * scale;

        // Clamp zoom limits (don't zoom out further than 1.5x original, don't zoom in past 50px)
        if (newW > mapWidth * 1.5 || newW < 50) return;

        currentViewBox.x += (coords.x - currentViewBox.x) * (1 - scale);
        currentViewBox.y += (coords.y - currentViewBox.y) * (1 - scale);
        currentViewBox.w = newW;
        currentViewBox.h = newH;
        
        updateViewBox();
        renderVertices(); 
        renderRegions(); // Re-render labels to fix font size
    }, { passive: false });

    // --- Pan & Draw ---
    mapSvg.addEventListener('pointerdown', e => {
        if (e.target.tagName !== 'svg' && e.target.id !== 'map-image') return;
        if (e.button !== 0 && e.button !== 1) return; // Left or middle click
        
        isPanning = true;
        hasDragged = false;
        mouseStart = { x: e.clientX, y: e.clientY };
        panStart = { x: currentViewBox.x, y: currentViewBox.y };
        mapSvg.setPointerCapture(e.pointerId);
    });

    mapSvg.addEventListener('pointermove', e => {
        // Handle Panning
        if (isPanning) {
            const dx = e.clientX - mouseStart.x;
            const dy = e.clientY - mouseStart.y;
            
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                hasDragged = true;
                mapSvg.style.cursor = 'grabbing';
            }
            
            if (hasDragged) {
                const svgRect = mapSvg.getBoundingClientRect();
                const scaleX = currentViewBox.w / svgRect.width;
                const scaleY = currentViewBox.h / svgRect.height;
                
                currentViewBox.x = panStart.x - dx * scaleX;
                currentViewBox.y = panStart.y - dy * scaleY;
                updateViewBox();
            }
            return;
        }

        // Handle Drawing Preview
        if (mode !== 'EDIT' || currentPoints.length === 0) return;
        const coords = getSVGCoordinates(e);
        tempLine.setAttribute('points', [...currentPoints, coords].map(p => `${p.x},${p.y}`).join(' '));
        
        if (currentPoints.length >= 3) {
            tempPreview.setAttribute('points', `${coords.x},${coords.y} ${currentPoints[0].x},${currentPoints[0].y}`);
            tempPreview.style.display = '';
            const dist = Math.hypot(coords.x - currentPoints[0].x, coords.y - currentPoints[0].y);
            closeHint.style.display = dist < (currentViewBox.w * 0.02) ? '' : 'none';
            closeHint.setAttribute('cx', currentPoints[0].x);
            closeHint.setAttribute('cy', currentPoints[0].y);
            closeHint.setAttribute('r', currentViewBox.w * 0.015);
        } else {
            tempPreview.style.display = 'none';
        }
    });

    mapSvg.addEventListener('pointerup', e => {
        if (!isPanning) return;
        isPanning = false;
        mapSvg.style.cursor = mode === 'EDIT' ? 'crosshair' : 'default';
        
        // If we didn't drag, treat it as a click (drawing)
        if (!hasDragged && (e.target.tagName === 'svg' || e.target.id === 'map-image')) {
            if (mode === 'EDIT' && modal.classList.contains('hidden')) {
                const coords = getSVGCoordinates(e);
                
                if (selectedRegionId) {
                    selectedRegionId = null;
                    refreshUI();
                    return; 
                }

                if (currentPoints.length >= 3) {
                    const first = currentPoints[0];
                    if (Math.hypot(coords.x - first.x, coords.y - first.y) < (currentViewBox.w * 0.02)) {
                        finishDrawing(); return;
                    }
                }
                currentPoints.push({ x: coords.x, y: coords.y });
                updateTempDrawing();
            }
        }
    });

    // --- Regions & Vertices ---
    regionsGroup.addEventListener('click', e => {
        const poly = e.target.closest('.region-polygon');
        if (!poly) return;

        if (mode === 'VIEW') {
            const r = regions.find(x => x.id === poly.dataset.id);
            infoTitle.textContent = r.title;
            infoCards.innerHTML = '';
            
            const labels = {
                climate: 'Climate', resources: 'Resources', capital: 'Capital', 
                settlements: 'Settlements', government: 'Government', 
                export: 'Primary Export', religion: 'Religion', danger: 'Danger Level'
            };
            
            if (r.details) {
                for (const [key, label] of Object.entries(labels)) {
                    if (r.details[key]) {
                        infoCards.innerHTML += `
                            <div class="bg-gray-800 p-2 rounded border border-gray-700">
                                <div class="text-xs text-blue-400 font-bold uppercase">${label}</div>
                                <div class="text-gray-200">${r.details[key]}</div>
                            </div>`;
                    }
                }
            }
        } else {
            e.stopPropagation();
            selectedRegionId = poly.dataset.id;
            refreshUI();
        }
    });

    verticesGroup.addEventListener('pointerdown', e => {
        if (e.target.classList.contains('vertex-handle')) {
            e.stopPropagation();
            draggedVertexIndex = parseInt(e.target.dataset.index);
            pushUndo();
            e.target.setPointerCapture(e.pointerId);
        }
    });

    mapSvg.addEventListener('pointermove', e => {
        if (draggedVertexIndex === null || !selectedRegionId) return;
        const coords = getSVGCoordinates(e);
        const r = regions.find(x => x.id === selectedRegionId);
        
        r.points[draggedVertexIndex] = {
            x: Math.max(0, Math.min(1, coords.x / mapWidth)),
            y: Math.max(0, Math.min(1, coords.y / mapHeight))
        };
        
        renderRegions();
        renderVertices();
    });

    mapSvg.addEventListener('pointerup', e => {
        if (draggedVertexIndex !== null) {
            draggedVertexIndex = null;
            saveData();
        }
    });

    // --- Keyboard ---
    window.addEventListener('keydown', e => {
        if (modal.contains(document.activeElement)) {
            if (e.key === 'Escape') { modal.classList.add('hidden'); cancelDrawing(); }
            return;
        }
        if (mode !== 'EDIT') return;
        
        if (e.key === 'Enter' && currentPoints.length >= 3) finishDrawing();
        else if (e.key === 'Escape') {
            cancelDrawing();
            selectedRegionId = null;
            refreshUI();
        }
        else if (e.key === 'Backspace' && currentPoints.length > 0) {
            e.preventDefault(); currentPoints.pop(); updateTempDrawing();
        }
    });

    // --- Top Bar ---
    $('btn-edit-mode').onclick = () => { mode = 'EDIT'; mapWrapper.className = 'map-container mode-edit inline-block m-auto shadow-2xl'; $('edit-panel').classList.remove('hidden'); $('view-panel').classList.add('hidden'); refreshUI(); };
    $('btn-view-mode').onclick = () => { mode = 'VIEW'; mapWrapper.className = 'map-container mode-interactive inline-block m-auto shadow-2xl'; $('edit-panel').classList.add('hidden'); $('view-panel').classList.remove('hidden'); refreshUI(); };
    
    $('btn-reset-zoom').onclick = () => {
        currentViewBox = { x: 0, y: 0, w: mapWidth, h: mapHeight };
        updateViewBox();
        refreshUI();
    };

    $('btn-undo').onclick = () => {
        if (undoStack.length === 0) return;
        redoStack.push(JSON.stringify(regions));
        regions = JSON.parse(undoStack.pop());
        selectedRegionId = null;
        saveData(); refreshUI();
    };
    $('btn-redo').onclick = () => {
        if (redoStack.length === 0) return;
        undoStack.push(JSON.stringify(regions));
        regions = JSON.parse(redoStack.pop());
        selectedRegionId = null;
        saveData(); refreshUI();
    };

    $('btn-export').onclick = () => {
        const a = document.createElement('a');
        a.href = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(regions, null, 2));
        a.download = "map_backup.json";
        a.click();
    };

    $('file-import').onchange = e => {
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const data = JSON.parse(ev.target.result);
                if (Array.isArray(data)) { pushUndo(); regions = data; saveData(); refreshUI(); showToast("Imported successfully"); }
                else showToast("Invalid JSON", "error");
            } catch { showToast("Invalid JSON", "error"); }
        };
        reader.readAsText(e.target.files[0]);
        e.target.value = '';
    };

    // --- Modal ---
    $('btn-modal-cancel').onclick = () => { modal.classList.add('hidden'); cancelDrawing(); };
    $('btn-modal-save').onclick = () => {
        const title = modalTitle.value.trim() || 'Untitled';
        const color = modalColor.value;
        
        const details = {
            climate: $('det-climate').value.trim(),
            resources: $('det-resources').value.trim(),
            capital: $('det-capital').value.trim(),
            settlements: $('det-settlements').value.trim(),
            government: $('det-gov').value.trim(),
            export: $('det-export').value.trim(),
            religion: $('det-religion').value.trim(),
            danger: $('det-danger').value.trim()
        };

        pushUndo();
        
        if (editingId) {
            const r = regions.find(x => x.id === editingId);
            r.title = title; r.details = details; r.color = color;
        } else {
            regions.push({
                id: 'r_' + Date.now(),
                title, details, color,
                points: currentPoints.map(p => ({ x: p.x / mapWidth, y: p.y / mapHeight }))
            });
        }
        saveData(); refreshUI(); modal.classList.add('hidden'); cancelDrawing();
    };

    $('btn-modal-delete').onclick = () => {
        if (confirm("Delete this region?")) {
            pushUndo(); regions = regions.filter(x => x.id !== editingId);
            if (selectedRegionId === editingId) selectedRegionId = null;
            saveData(); refreshUI(); modal.classList.add('hidden'); cancelDrawing();
        }
    };
}

function editRegion(id) {
    editingId = id;
    selectedRegionId = id;
    refreshUI();
    const r = regions.find(x => x.id === id);
    $('modal-heading').textContent = 'Edit Region';
    modalTitle.value = r.title; 
    modalColor.value = r.color;
    
    const d = r.details || {};
    $('det-climate').value = d.climate || '';
    $('det-resources').value = d.resources || '';
    $('det-capital').value = d.capital || '';
    $('det-settlements').value = d.settlements || '';
    $('det-gov').value = d.government || '';
    $('det-export').value = d.export || '';
    $('det-religion').value = d.religion || '';
    $('det-danger').value = d.danger || '';

    $('btn-modal-delete').classList.remove('hidden');
    modal.classList.remove('hidden');
    modalTitle.focus();
}

function deleteRegion(id) {
    if (confirm("Delete this region?")) {
        pushUndo(); regions = regions.filter(x => x.id !== id);
        if (selectedRegionId === id) selectedRegionId = null;
        saveData(); refreshUI();
    }
}

// --- NEW API & INIT LOGIC ---

let saveTimeout;
function saveData() {
    // Save to localStorage immediately as a fallback
    localStorage.setItem('map_regions', JSON.stringify(regions));
    $('save-status').textContent = 'Saving...';

    // Debounce the API call to prevent spamming the server
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(regions)
            });
            if (res.ok) $('save-status').textContent = 'Saved to Cloud';
            else throw new Error();
        } catch (e) {
            $('save-status').textContent = 'Saved Locally (Offline)';
        }
    }, 500);
}

async function init() {
    await loadImage();
    try {
        const res = await fetch('/api/data');
        const data = await res.json();
        
        // Check if the data is actually an array before using it
        if (Array.isArray(data)) {
            regions = data;
            $('save-status').textContent = 'Cloud Synced';
        } else {
            // If it's an error object or HTML, fallback to local
            throw new Error("Invalid cloud data");
        }
    } catch (e) {
        console.log("Offline or API failed, falling back to local");
        regions = JSON.parse(localStorage.getItem('map_regions') || '[]');
        $('save-status').textContent = 'Loaded Locally (Offline)';
    }
    refreshUI();
    bindEvents();
}

// Start the app
init();
