// --- State ---
let regions = [];
let currentPoints = [];
let mode = 'EDIT';
let mapWidth = 1000, mapHeight = 1000;
let undoStack = [], redoStack = [];
let editingId = null;
let selectedRegionId = null;
let draggedVertexIndex = null;

// Zoom & Pan
let currentViewBox = { x: 0, y: 0, w: 1000, h: 1000 };
let isPanning = false;
let hasDragged = false;
let panStart = { x: 0, y: 0 };
let mouseStart = { x: 0, y: 0 };

const $ = id => document.getElementById(id);
const mapSvg = $('map-svg');
const regionsGroup = $('regions-group'), verticesGroup = $('vertices-group'), labelsGroup = $('labels-group');
const tempLine = $('temp-line'), tempPreview = $('temp-line-preview'), closeHint = $('close-hint');
const regionList = $('region-list'), infoTitle = $('info-title'), infoCards = $('info-cards');
const modal = $('region-modal'), modalTitle = $('modal-title'), modalColor = $('modal-color');

function init() {
    const img = $('map-image');
    
    // Create a temporary standard image to safely get the map's exact pixel size
    const loader = new Image();
    loader.src = img.getAttribute('href');
    
    loader.onload = () => {
        mapWidth = loader.naturalWidth;
        mapHeight = loader.naturalHeight;
        
        // CRITICAL FIX: Force the SVG image to use the exact pixel size, not 100%
        img.setAttribute('width', mapWidth);
        img.setAttribute('height', mapHeight);
        
        currentViewBox = { x: 0, y: 0, w: mapWidth, h: mapHeight };
        updateViewBox();

        regions = JSON.parse(localStorage.getItem('map_regions') || '[]');
        refreshUI();
    };
    
    loader.onerror = () => alert("CRITICAL: map1.jpg failed to load. Check the file path/case.");

    bindEvents();
}

function updateViewBox() {
    mapSvg.setAttribute('viewBox', `${currentViewBox.x} ${currentViewBox.y} ${currentViewBox.w} ${currentViewBox.h}`);
}

function getSVGCoordinates(evt) {
    const pt = mapSvg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    return pt.matrixTransform(mapSvg.getScreenCTM().inverse());
}

function saveData() {
    localStorage.setItem('map_regions', JSON.stringify(regions));
    $('save-status').textContent = 'Saved locally';
}

function pushUndo() { undoStack.push(JSON.stringify(regions)); redoStack = []; }
function refreshUI() { renderRegions(); renderVertices(); renderSidebar(); }

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
        label.setAttribute('font-size', Math.max(12, currentViewBox.w / 80));
        label.textContent = r.title;
        labelsGroup.appendChild(label);
    });
}

function renderVertices() {
    verticesGroup.innerHTML = '';
    if (selectedRegionId && mode === 'EDIT') {
        const r = regions.find(x => x.id === selectedRegionId);
        if (r) {
            r.points.forEach((p, i) => {
                const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                c.setAttribute('cx', p.x * mapWidth); c.setAttribute('cy', p.y * mapHeight);
                c.setAttribute('r', Math.max(4, currentViewBox.w / 200));
                c.classList.add('vertex-handle');
                c.dataset.index = i;
                verticesGroup.appendChild(c);
            });
        }
    }
}

function renderSidebar() {
    regionList.innerHTML = '';
    regions.forEach(r => {
        const li = document.createElement('li');
        li.className = `flex items-center gap-2 bg-gray-700 px-2 py-1 rounded ${selectedRegionId === r.id ? 'ring-2 ring-blue-500' : ''}`;
        li.innerHTML = `<span class="w-3 h-3 rounded-full shrink-0" style="background:${r.color}"></span>
                        <span class="truncate flex-1 cursor-pointer hover:text-white">${r.title}</span>`;
        li.querySelector('span:nth-child(2)').onclick = () => editRegion(r.id);
        regionList.appendChild(li);
    });
}

function hexAlpha(hex, alpha) {
    const m = hex.replace('#', ''); const n = parseInt(m, 16);
    return `rgba(${(n>>16)&255}, ${(n>>8)&255}, ${n&255}, ${alpha})`;
}

function bindEvents() {
    // Zoom
    mapSvg.addEventListener('wheel', e => {
        e.preventDefault();
        const scale = e.deltaY > 0 ? 1.15 : 0.85;
        let newW = currentViewBox.w * scale;
        if (newW > mapWidth * 2 || newW < (mapWidth * 0.05)) return;

        const pt = mapSvg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
        const coords = pt.matrixTransform(mapSvg.getScreenCTM().inverse());

        currentViewBox.x += (coords.x - currentViewBox.x) * (1 - scale);
        currentViewBox.y += (coords.y - currentViewBox.y) * (1 - scale);
        currentViewBox.w = newW;
        currentViewBox.h = newW * (mapHeight / mapWidth);
        
        updateViewBox();
        refreshUI(); 
    }, { passive: false });

    // Panning
    mapSvg.addEventListener('pointerdown', e => {
        if (e.target.classList.contains('vertex-handle') || e.target.classList.contains('region-polygon')) return;
        isPanning = true; hasDragged = false;
        mouseStart = { x: e.clientX, y: e.clientY };
        panStart = { x: currentViewBox.x, y: currentViewBox.y };
        mapSvg.setPointerCapture(e.pointerId);
    });

    mapSvg.addEventListener('pointermove', e => {
        if (draggedVertexIndex !== null && selectedRegionId) {
            const coords = getSVGCoordinates(e);
            const r = regions.find(x => x.id === selectedRegionId);
            r.points[draggedVertexIndex] = { x: Math.max(0, Math.min(1, coords.x / mapWidth)), y: Math.max(0, Math.min(1, coords.y / mapHeight)) };
            refreshUI(); return;
        }

        if (isPanning) {
            const dx = e.clientX - mouseStart.x; const dy = e.clientY - mouseStart.y;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged = true;
            if (hasDragged) {
                mapSvg.style.cursor = 'grabbing';
                const svgRect = mapSvg.getBoundingClientRect();
                currentViewBox.x = panStart.x - dx * (currentViewBox.w / svgRect.width);
                currentViewBox.y = panStart.y - dy * (currentViewBox.h / svgRect.height);
                updateViewBox();
            }
            return;
        }

        if (mode === 'EDIT' && currentPoints.length > 0) {
            const coords = getSVGCoordinates(e);
            tempLine.setAttribute('points', [...currentPoints, coords].map(p => `${p.x},${p.y}`).join(' '));
            if (currentPoints.length >= 3) {
                tempPreview.setAttribute('points', `${coords.x},${coords.y} ${currentPoints[0].x},${currentPoints[0].y}`);
                tempPreview.style.display = '';
                const dist = Math.hypot(coords.x - currentPoints[0].x, coords.y - currentPoints[0].y);
                closeHint.style.display = dist < (currentViewBox.w * 0.02) ? '' : 'none';
                closeHint.setAttribute('cx', currentPoints[0].x); closeHint.setAttribute('cy', currentPoints[0].y);
                closeHint.setAttribute('r', currentViewBox.w * 0.015);
            }
        }
    });

    mapSvg.addEventListener('pointerup', e => {
        if (draggedVertexIndex !== null) { draggedVertexIndex = null; saveData(); }
        if (isPanning) {
            isPanning = false; mapSvg.style.cursor = mode === 'EDIT' ? 'crosshair' : 'default';
            if (!hasDragged && !e.target.classList.contains('vertex-handle') && !e.target.classList.contains('region-polygon')) {
                if (mode === 'EDIT') {
                    const coords = getSVGCoordinates(e);
                    if (selectedRegionId) { selectedRegionId = null; refreshUI(); return; }
                    if (currentPoints.length >= 3) {
                        if (Math.hypot(coords.x - currentPoints[0].x, coords.y - currentPoints[0].y) < (currentViewBox.w * 0.02)) { finishDrawing(); return; }
                    }
                    currentPoints.push({ x: coords.x, y: coords.y });
                    tempLine.setAttribute('points', currentPoints.map(p => `${p.x},${p.y}`).join(' '));
                    document.querySelectorAll('.draw-point').forEach(c => c.remove());
                    currentPoints.forEach(p => {
                        const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                        c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', Math.max(4, currentViewBox.w / 200));
                        c.classList.add('draw-point'); $('drawing-group').appendChild(c);
                    });
                }
            }
        }
    });

    // Region Clicking (Edit vs View)
    regionsGroup.addEventListener('click', e => {
        const poly = e.target.closest('.region-polygon');
        if (!poly) return;
        const r = regions.find(x => x.id === poly.dataset.id);
        
        if (mode === 'EDIT') {
            e.stopPropagation();
            editRegion(r.id);
        } else {
            infoTitle.textContent = r.title;
            infoCards.innerHTML = '';
            const labels = { climate: 'Climate', resources: 'Resources', capital: 'Capital', settlements: 'Settlements', government: 'Government', export: 'Export', religion: 'Religion', danger: 'Danger' };
            if (r.details) {
                for (const [key, label] of Object.entries(labels)) {
                    if (r.details[key]) {
                        infoCards.innerHTML += `<div class="bg-gray-800 p-2 rounded border border-gray-700">
                            <div class="text-xs text-blue-400 font-bold uppercase">${label}</div>
                            <div class="text-gray-200">${r.details[key]}</div></div>`;
                    }
                }
            }
        }
    });

    // Vertex Drag
    verticesGroup.addEventListener('pointerdown', e => {
        if (e.target.classList.contains('vertex-handle')) {
            e.stopPropagation(); draggedVertexIndex = parseInt(e.target.dataset.index); pushUndo();
            e.target.setPointerCapture(e.pointerId);
        }
    });

    // Buttons
    $('btn-edit-mode').onclick = () => { mode = 'EDIT'; document.getElementById('map-wrapper').className = 'map-container mode-edit inline-block m-auto shadow-2xl'; $('edit-panel').classList.remove('hidden'); $('view-panel').classList.add('hidden'); refreshUI(); };
    $('btn-view-mode').onclick = () => { mode = 'VIEW'; document.getElementById('map-wrapper').className = 'map-container mode-view inline-block m-auto shadow-2xl'; $('edit-panel').classList.add('hidden'); $('view-panel').classList.remove('hidden'); infoTitle.textContent = 'Select a Region'; infoCards.innerHTML = ''; refreshUI(); };
    $('btn-reset-zoom').onclick = () => { currentViewBox = { x: 0, y: 0, w: mapWidth, h: mapHeight }; updateViewBox(); refreshUI(); };
    $('btn-undo').onclick = () => { if(undoStack.length) { redoStack.push(JSON.stringify(regions)); regions = JSON.parse(undoStack.pop()); saveData(); refreshUI(); } };
    $('btn-redo').onclick = () => { if(redoStack.length) { undoStack.push(JSON.stringify(regions)); regions = JSON.parse(redoStack.pop()); saveData(); refreshUI(); } };
    
    $('btn-export').onclick = () => { const a = document.createElement('a'); a.href = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(regions, null, 2)); a.download = "map_backup.json"; a.click(); };
    $('file-import').onchange = e => {
        const reader = new FileReader();
        reader.onload = ev => { try { const data = JSON.parse(ev.target.result); if (Array.isArray(data)) { pushUndo(); regions = data; saveData(); refreshUI(); } } catch {} };
        reader.readAsText(e.target.files[0]); e.target.value = '';
    };

    // Modal
    $('btn-modal-cancel').onclick = () => { modal.classList.add('hidden'); cancelDrawing(); };
    $('btn-modal-save').onclick = () => {
        const title = modalTitle.value.trim() || 'Untitled';
        pushUndo();
        if (editingId) {
            const r = regions.find(x => x.id === editingId);
            r.title = title; r.color = modalColor.value;
            r.details = { climate: $('det-climate').value, resources: $('det-resources').value, capital: $('det-capital').value, settlements: $('det-settlements').value, government: $('det-gov').value, export: $('det-export').value, religion: $('det-religion').value, danger: $('det-danger').value };
        } else {
            regions.push({ id: 'r_' + Date.now(), title, color: modalColor.value, details: {}, points: currentPoints.map(p => ({ x: p.x / mapWidth, y: p.y / mapHeight })) });
        }
        saveData(); refreshUI(); modal.classList.add('hidden'); cancelDrawing();
    };
    $('btn-modal-delete').onclick = () => {
        if (confirm("Delete this region?")) { pushUndo(); regions = regions.filter(x => x.id !== editingId); if (selectedRegionId === editingId) selectedRegionId = null; saveData(); refreshUI(); modal.classList.add('hidden'); cancelDrawing(); }
    };
}

function finishDrawing() {
    editingId = null;
    $('modal-heading').textContent = 'New Region';
    modalTitle.value = ''; modalColor.value = '#3b82f6';
    ['climate','resources','capital','settlements','gov','export','religion','danger'].forEach(d => $('det-'+d).value = '');
    $('btn-modal-delete').classList.add('hidden');
    modal.classList.remove('hidden');
    modalTitle.focus();
}

function editRegion(id) {
    editingId = id; selectedRegionId = id; refreshUI();
    const r = regions.find(x => x.id === id);
    $('modal-heading').textContent = 'Edit Region';
    modalTitle.value = r.title; modalColor.value = r.color;
    const d = r.details || {};
    $('det-climate').value = d.climate || ''; $('det-resources').value = d.resources || '';
    $('det-capital').value = d.capital || ''; $('det-settlements').value = d.settlements || '';
    $('det-gov').value = d.government || ''; $('det-export').value = d.export || '';
    $('det-religion').value = d.religion || ''; $('det-danger').value = d.danger || '';
    $('btn-modal-delete').classList.remove('hidden');
    modal.classList.remove('hidden');
    modalTitle.focus();
}

function cancelDrawing() {
    currentPoints = []; tempLine.setAttribute('points', ''); tempPreview.setAttribute('points', '');
    closeHint.style.display = 'none'; document.querySelectorAll('.draw-point').forEach(c => c.remove());
}

// Start the app
init();