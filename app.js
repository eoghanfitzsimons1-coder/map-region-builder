// --- State ---
let regions = [];
let currentPoints = [];
let mode = 'EDIT';
let mapWidth = 1000, mapHeight = 1000; // Fallback defaults
let selectedRegionId = null;
let draggedVertexIndex = null;

// Zoom & Pan State
let currentViewBox = { x: 0, y: 0, w: 1000, h: 1000 };
let isPanning = false;
let hasDragged = false;
let panStart = { x: 0, y: 0 };
let mouseStart = { x: 0, y: 0 };

// --- DOM ---
const $ = id => document.getElementById(id);
const mapSvg = $('map-svg');
const regionsGroup = $('regions-group'), verticesGroup = $('vertices-group'), labelsGroup = $('labels-group');
const tempLine = $('temp-line'), tempPreview = $('temp-line-preview'), closeHint = $('close-hint');
const regionList = $('region-list');

// --- Initialization ---
function init() {
    // 1. Bind events IMMEDIATELY so buttons always work
    bindEvents();

    // 2. Load data
    regions = JSON.parse(localStorage.getItem('map_regions') || '[]');
    refreshUI();

    // 3. Load image in the background
    const img = $('map-image');
    const onLoad = () => {
        mapWidth = img.naturalWidth;
        mapHeight = img.naturalHeight;
        currentViewBox = { x: 0, y: 0, w: mapWidth, h: mapHeight };
        updateViewBox();
        refreshUI();
    };

    if (img.complete && img.naturalWidth > 0) {
        onLoad();
    } else {
        img.onload = onLoad;
        img.onerror = () => console.error("Map image failed to load. Check filename/case.");
    }
}

function updateViewBox() {
    mapSvg.setAttribute('viewBox', `${currentViewBox.x} ${currentViewBox.y} ${currentViewBox.w} ${currentViewBox.h}`);
}

function getSVGCoordinates(evt) {
    const pt = mapSvg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const ctm = mapSvg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 }; // Failsafe
    return pt.matrixTransform(ctm.inverse());
}

function hexAlpha(hex, alpha) {
    const m = hex.replace('#', '');
    const n = parseInt(m, 16);
    return `rgba(${(n>>16)&255}, ${(n>>8)&255}, ${n&255}, ${alpha})`;
}

function refreshUI() {
    // Render Regions
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

    // Render Vertices
    verticesGroup.innerHTML = '';
    if (selectedRegionId && mode === 'EDIT') {
        const r = regions.find(x => x.id === selectedRegionId);
        if (r) {
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
    }

    // Render Sidebar
    regionList.innerHTML = '';
    regions.forEach(r => {
        const li = document.createElement('li');
        li.className = `flex items-center gap-2 bg-gray-700 px-2 py-1 rounded ${selectedRegionId === r.id ? 'ring-2 ring-blue-500' : ''}`;
        li.innerHTML = `<span class="w-3 h-3 rounded-full shrink-0" style="background:${r.color}"></span>
                        <span class="truncate flex-1 cursor-pointer hover:text-white">${r.title}</span>`;
        regionList.appendChild(li);
    });
}

function bindEvents() {
    // 1. Zoom
    mapSvg.addEventListener('wheel', e => {
        e.preventDefault();
        const scale = e.deltaY > 0 ? 1.15 : 0.85;
        let newW = currentViewBox.w * scale;
        
        if (newW > mapWidth * 2 || newW < (mapWidth * 0.05)) return;

        const pt = mapSvg.createSVGPoint();
        pt.x = e.clientX; pt.y = e.clientY;
        const ctm = mapSvg.getScreenCTM();
        if (!ctm) return;
        const coords = pt.matrixTransform(ctm.inverse());

        currentViewBox.x += (coords.x - currentViewBox.x) * (1 - scale);
        currentViewBox.y += (coords.y - currentViewBox.y) * (1 - scale);
        currentViewBox.w = newW;
        currentViewBox.h = newW * (mapHeight / mapWidth);
        
        updateViewBox();
        refreshUI(); 
    }, { passive: false });

    // 2. Pointer Down
    mapSvg.addEventListener('pointerdown', e => {
        if (e.target.tagName !== 'svg') return;
        isPanning = true;
        hasDragged = false;
        mouseStart = { x: e.clientX, y: e.clientY };
        panStart = { x: currentViewBox.x, y: currentViewBox.y };
        mapSvg.setPointerCapture(e.pointerId);
    });

    // 3. Pointer Move (Drag & Draw)
    mapSvg.addEventListener('pointermove', e => {
        if (draggedVertexIndex !== null && selectedRegionId) {
            const coords = getSVGCoordinates(e);
            const r = regions.find(x => x.id === selectedRegionId);
            r.points[draggedVertexIndex] = {
                x: Math.max(0, Math.min(1, coords.x / mapWidth)),
                y: Math.max(0, Math.min(1, coords.y / mapHeight))
            };
            refreshUI();
            return;
        }

        if (isPanning) {
            const dx = e.clientX - mouseStart.x;
            const dy = e.clientY - mouseStart.y;
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
                closeHint.setAttribute('cx', currentPoints[0].x);
                closeHint.setAttribute('cy', currentPoints[0].y);
                closeHint.setAttribute('r', currentViewBox.w * 0.015);
            }
        }
    });

    // 4. Pointer Up (Click map)
    mapSvg.addEventListener('pointerup', e => {
        if (draggedVertexIndex !== null) {
            draggedVertexIndex = null;
            saveLocal();
        }

        if (isPanning) {
            isPanning = false;
            mapSvg.style.cursor = mode === 'EDIT' ? 'crosshair' : 'default';
            
            if (!hasDragged && e.target.tagName === 'svg') {
                if (mode === 'EDIT') {
                    const coords = getSVGCoordinates(e);
                    
                    if (selectedRegionId) {
                        selectedRegionId = null; refreshUI(); return;
                    }

                    if (currentPoints.length >= 3) {
                        const first = currentPoints[0];
                        if (Math.hypot(coords.x - first.x, coords.y - first.y) < (currentViewBox.w * 0.02)) {
                            finishDrawing(); return;
                        }
                    }
                    currentPoints.push({ x: coords.x, y: coords.y });
                    
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
            }
        }
    });

    // 5. Region Click
    regionsGroup.addEventListener('click', e => {
        const poly = e.target.closest('.region-polygon');
        if (!poly) return;
        
        if (mode === 'EDIT') {
            e.stopPropagation();
            selectedRegionId = poly.dataset.id;
            refreshUI();
        }
    });

    // 6. Vertex Drag
    verticesGroup.addEventListener('pointerdown', e => {
        if (e.target.classList.contains('vertex-handle')) {
            e.stopPropagation();
            draggedVertexIndex = parseInt(e.target.dataset.index);
            e.target.setPointerCapture(e.pointerId);
        }
    });

    // 7. Top Buttons
    $('btn-edit-mode').onclick = () => { mode = 'EDIT'; mapSvg.style.cursor = 'crosshair'; };
    $('btn-view-mode').onclick = () => { mode = 'VIEW'; mapSvg.style.cursor = 'default'; };
    
    $('btn-reset-zoom').onclick = () => {
        currentViewBox = { x: 0, y: 0, w: mapWidth, h: mapHeight };
        updateViewBox();
        refreshUI();
    };
}

function saveLocal() {
    localStorage.setItem('map_regions', JSON.stringify(regions));
}

function finishDrawing() {
    const title = prompt("Region Name:", "New Region");
    if (!title) return;
    
    regions.push({
        id: 'r_' + Date.now(),
        title: title,
        color: '#3b82f6',
        details: {},
        points: currentPoints.map(p => ({ x: p.x / mapWidth, y: p.y / mapHeight }))
    });
    
    currentPoints = [];
    tempLine.setAttribute('points', '');
    tempPreview.style.display = 'none';
    document.querySelectorAll('.draw-point').forEach(c => c.remove());
    
    saveLocal();
    refreshUI();
}

// Start Everything
init();