// --- Constants ---
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const LAST_MAP_KEY = 'map-builder:last-map';
const DEFAULT_MAPS = [{ id: 'default', name: 'Main map', image: null }];
const DEFAULT_SETTINGS = { unitsPerPx: 0, unit: 'leagues' };
const DEFAULT_REGION_COLOR = '#3b82f6';

const DETAIL_LABELS = { climate: 'Climate', resources: 'Resources', capital: 'Capital', settlements: 'Settlements', government: 'Government', export: 'Export', religion: 'Religion', danger: 'Danger' };
const DETAIL_INPUTS = { climate: 'det-climate', resources: 'det-resources', capital: 'det-capital', settlements: 'det-settlements', government: 'det-gov', export: 'det-export', religion: 'det-religion', danger: 'det-danger' };

const POI_TYPES = {
    capital: { label: 'Capital', icon: '🏰', color: '#facc15' },
    city: { label: 'City', icon: '🏙️', color: '#60a5fa' },
    town: { label: 'Town', icon: '🏘️', color: '#a3e635' },
    village: { label: 'Village', icon: '🛖', color: '#86efac' },
    port: { label: 'Port', icon: '⚓', color: '#67e8f9' },
    fortress: { label: 'Fortress', icon: '🛡️', color: '#cbd5e1' },
    temple: { label: 'Temple', icon: '🛕', color: '#f0abfc' },
    ruin: { label: 'Ruins', icon: '🏚️', color: '#a8a29e' },
    dungeon: { label: 'Dungeon', icon: '💀', color: '#f87171' },
    landmark: { label: 'Landmark', icon: '⛰️', color: '#c084fc' }
};

const ROUTE_TYPES = {
    road: { label: 'Road', color: '#f3e3c3', width: 3, dash: '' },
    trade: { label: 'Trade route', color: '#f5b942', width: 3, dash: '10 6' },
    river: { label: 'River', color: '#60a5fa', width: 4, dash: '' },
    sea: { label: 'Sea lane', color: '#67e8f9', width: 2.5, dash: '2 6' },
    border: { label: 'Border', color: '#f87171', width: 2.5, dash: '12 4 2 4' }
};

// Categorical slots in fixed order; a ninth value folds into "Other"
const THEME_PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const THEME_OTHER_COLOR = '#8b8a84';
const THEME_NONE_COLOR = '#4b4b48';
const THEME_LABELS = { government: 'Government', religion: 'Religion', climate: 'Climate', danger: 'Danger' };

const TOOL_HELP = {
    region: ['Click to add points; click the first point or press Enter to close the shape.', 'Backspace removes the last point, Escape cancels.', 'Click a shape to edit its details; drag its handles to move vertices.', 'Drag anywhere to pan, scroll to zoom.'],
    pin: ['Click anywhere to place a pin for a city, ruin, dungeon or other place.', 'Drag a pin to move it; click it to edit.'],
    route: ['Click to add points along a road, river, trade route or border.', 'Click the last point again, press Enter or use Finish route to end it.', 'Backspace removes the last point, Escape cancels.', 'To edit a route, click it with the Region tool or pick it below.'],
    measure: ['Click points to measure a distance; it appears in the bottom-right corner.', 'Set the map scale in Maps… to see real distances.', 'Escape or Clear resets the measurement.']
};

const EXPORT_CSS = `
.region-label, .poi-label { fill: white; font-weight: 600; text-anchor: middle; paint-order: stroke; stroke: black; stroke-linejoin: round; font-family: system-ui, sans-serif; }
.region-label { stroke-width: 3px; }`;

// --- State ---
let maps = DEFAULT_MAPS.map(m => ({ ...m }));
let currentMapId = 'default';
let regions = [], pois = [], routes = [];
let mapSettings = { ...DEFAULT_SETTINGS };
let mapImageEl = null;
let loadToken = 0;
let loadFailed = false;
let currentPoints = [];
let routePoints = [];
let measurePoints = [];
let mode = 'EDIT';
let tool = 'region';
let mapWidth = 1000, mapHeight = 1000;
let undoStack = [], redoStack = [];
let editingId = null;
let selectedRegionId = null;
let selectedRouteId = null;
let draggedVertexIndex = null;
let poiDrag = null;
let editingPoiId = null, pendingPoiPoint = null;
let editingRouteId = null, pendingRoutePoints = null;
let pendingCoatArmsFile = null;
let removeCoatArms = false;
let coatPreviewObjectUrl = null;
let modalSession = 0;
let saveQueue = Promise.resolve();
let toastTimeout = null;
let themeField = '';
let currentTheme = null;
let timeline = { enabled: false, year: 0 };
let timelineTimer = null;
let popupAnchor = null;
let exporting = false;
let viewAnimation = null;

// Zoom & Pan
let currentViewBox = { x: 0, y: 0, w: 1000, h: 1000 };
let isPanning = false;
let hasDragged = false;
let panStart = { x: 0, y: 0 };
let mouseStart = { x: 0, y: 0 };

// --- DOM ---
const $ = id => document.getElementById(id);
const mapSvg = $('map-svg');
const regionsGroup = $('regions-group'), verticesGroup = $('vertices-group'), labelsGroup = $('labels-group');
const routesGroup = $('routes-group'), poisGroup = $('pois-group'), measureGroup = $('measure-group');
const tempLine = $('temp-line'), tempPreview = $('temp-line-preview'), closeHint = $('close-hint'), routePreview = $('route-preview');
const regionList = $('region-list'), infoTitle = $('info-title'), infoCards = $('info-cards'), infoDesc = $('info-desc');
const modal = $('region-modal'), modalTitle = $('modal-title'), modalColor = $('modal-color'), modalDesc = $('modal-desc');
const modalHistory = $('modal-history');

async function init() {
    bindEvents();
    renderTools();

    try {
        const list = await fetchJSON('/api/data?maps=1', 'Loading the map list');
        if (Array.isArray(list) && list.length) maps = list;
    } catch (error) {
        reportPersistenceError(error, 'load');
    }

    const hash = readHash();
    let lastMapId = null;
    try { lastMapId = localStorage.getItem(LAST_MAP_KEY); } catch {}
    const start = maps.find(m => m.id === hash.map) || maps.find(m => m.id === lastMapId) || maps[0];
    await loadMap(start.id);

    const linked = hash.region && regions.find(r => r.id === hash.region);
    if (linked) {
        setMode('VIEW');
        selectRegion(linked, { zoom: true });
    }
}

// --- Maps ---
function mapImageUrl(map) {
    return map.image ? imageEndpoint(map.id, map.image, 'map') : 'map1.jpg';
}

function currentMap() {
    return maps.find(m => m.id === currentMapId) || maps[0];
}

async function loadMap(id) {
    const map = maps.find(m => m.id === id) || maps[0];
    const token = ++loadToken;
    currentMapId = map.id;
    try { localStorage.setItem(LAST_MAP_KEY, map.id); } catch {}

    cancelDrawing(); cancelRoute(); clearMeasure(); hidePopup(); stopTimeline();
    regions = []; pois = []; routes = [];
    mapSettings = { ...DEFAULT_SETTINGS };
    undoStack = []; redoStack = [];
    selectedRegionId = null; selectedRouteId = null; editingId = null;
    timeline.enabled = false;
    $('timeline-enabled').checked = false;
    renderMapSelect();
    showRegionInfo(null);
    $('save-status').textContent = 'Loading…';

    const imageUrl = mapImageUrl(map);
    const [image, data] = await Promise.allSettled([
        loadImage(imageUrl),
        fetchJSON(`/api/data?map=${encodeURIComponent(map.id)}`, 'Loading regions')
    ]);
    if (token !== loadToken) return;

    if (image.status === 'fulfilled') {
        mapImageEl = image.value;
        mapWidth = mapImageEl.naturalWidth;
        mapHeight = mapImageEl.naturalHeight;
    } else {
        mapImageEl = null;
        mapWidth = 1000; mapHeight = 1000;
        showToast(`The image for "${map.name}" failed to load.`);
    }
    const img = $('map-image');
    img.setAttribute('href', imageUrl);
    img.setAttribute('width', mapWidth);
    img.setAttribute('height', mapHeight);
    currentViewBox = { x: 0, y: 0, w: mapWidth, h: mapHeight };

    if (data.status === 'fulfilled') {
        const doc = normalizeDoc(data.value);
        regions = doc.regions; pois = doc.pois; routes = doc.routes; mapSettings = doc.settings;
        loadFailed = false;
        $('save-status').textContent = 'Saved to Netlify';
    } else {
        loadFailed = true;
        reportPersistenceError(data.reason, 'load');
    }

    updateViewBox();
    updateHash();
    refreshUI();
}

function normalizeDoc(data) {
    const doc = Array.isArray(data) ? { regions: data } : (data || {});
    return {
        regions: Array.isArray(doc.regions) ? doc.regions : [],
        pois: Array.isArray(doc.pois) ? doc.pois : [],
        routes: Array.isArray(doc.routes) ? doc.routes : [],
        settings: { ...DEFAULT_SETTINGS, ...(doc.settings || {}) }
    };
}

function serializeDoc() {
    return { version: 2, regions, pois, routes, settings: mapSettings };
}

function renderMapSelect() {
    const select = $('map-select');
    select.innerHTML = '';
    maps.forEach(m => {
        const option = document.createElement('option');
        option.value = m.id;
        option.textContent = m.name;
        select.appendChild(option);
    });
    select.value = currentMapId;
}

async function saveMaps() {
    const response = await fetch('/api/data?maps=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(maps)
    });
    if (!response.ok) await throwResponseError(response, 'Saving the map list');
}

function openMapsModal() {
    const map = currentMap();
    $('map-setting-name').value = map.name;
    $('map-setting-scale').value = mapSettings.unitsPerPx > 0 ? mapSettings.unitsPerPx : '';
    $('map-setting-unit').value = mapSettings.unit || '';
    $('map-setting-size').textContent = `This map is ${mapWidth.toLocaleString()} × ${mapHeight.toLocaleString()} pixels. ` +
        `For example, if it is 1,000 leagues wide, enter ${formatNumber(1000 / mapWidth)}.`;
    $('new-map-name').value = '';
    $('new-map-image').value = '';
    renderMapsList();
    $('maps-modal').classList.remove('hidden');
}

function renderMapsList() {
    const list = $('maps-list');
    list.innerHTML = '';
    maps.forEach(m => {
        const li = document.createElement('li');
        li.className = 'flex items-center gap-2 bg-gray-700 px-2 py-1 rounded';
        const name = document.createElement('span');
        name.className = 'truncate flex-1';
        name.textContent = m.id === currentMapId ? `${m.name} (current)` : m.name;
        li.appendChild(name);
        if (m.id !== currentMapId) {
            const open = document.createElement('button');
            open.className = 'text-blue-300 hover:text-white';
            open.textContent = 'Open';
            open.onclick = () => { $('maps-modal').classList.add('hidden'); loadMap(m.id); };
            li.appendChild(open);
        }
        if (m.id !== 'default') {
            const remove = document.createElement('button');
            remove.className = 'text-red-400 hover:text-red-300';
            remove.textContent = 'Delete';
            remove.onclick = () => deleteMap(m);
            li.appendChild(remove);
        }
        list.appendChild(li);
    });
}

async function saveMapSettings() {
    const map = currentMap();
    const scale = parseFloat($('map-setting-scale').value);
    map.name = $('map-setting-name').value.trim() || 'Untitled map';
    mapSettings = {
        ...mapSettings,
        unitsPerPx: Number.isFinite(scale) && scale > 0 ? scale : 0,
        unit: $('map-setting-unit').value.trim() || 'leagues'
    };
    renderMapSelect();
    renderMapsList();
    refreshUI();
    renderScaleBar();
    try {
        await Promise.all([saveMaps(), saveData()]);
        showToast('Map settings saved.');
    } catch (error) {
        reportPersistenceError(error, 'save');
    }
}

async function addMap() {
    const file = $('new-map-image').files[0];
    if (!file || !file.type.startsWith('image/')) { showToast('Choose an image file for the new map.'); return; }
    const name = $('new-map-name').value.trim() || file.name.replace(/\.[^.]+$/, '') || 'New map';
    const button = $('btn-add-map');
    button.disabled = true;
    button.textContent = 'Uploading…';
    try {
        const image = await shrinkImage(file);
        const id = 'm_' + crypto.randomUUID();
        const version = crypto.randomUUID();
        const response = await fetch(imageEndpoint(id, version, 'map'), {
            method: 'POST',
            headers: { 'Content-Type': image.type },
            body: image
        });
        if (!response.ok) await throwResponseError(response, 'Uploading the map image');
        maps.push({ id, name, image: version });
        await saveMaps();
        $('maps-modal').classList.add('hidden');
        await loadMap(id);
        showToast(`Added "${name}".`);
    } catch (error) {
        showToast(`Could not add the map: ${error.message}`);
    } finally {
        button.disabled = false;
        button.textContent = 'Add map';
    }
}

async function deleteMap(map) {
    if (!confirm(`Delete "${map.name}" with all of its regions, places and routes? This cannot be undone.`)) return;
    const previous = maps;
    maps = maps.filter(m => m.id !== map.id);
    try {
        await saveMaps();
    } catch (error) {
        maps = previous;
        reportPersistenceError(error, 'save');
        return;
    }
    fetch(`/api/data?map=${encodeURIComponent(map.id)}`, { method: 'DELETE' })
        .then(response => response.ok || console.error('Could not delete map data', response.status));
    if (map.id === currentMapId) await loadMap(maps[0].id);
    renderMapSelect();
    renderMapsList();
}

// --- Persistence ---
async function fetchJSON(url, action) {
    const response = await fetch(url);
    if (!response.ok) await throwResponseError(response, action);
    return response.json();
}

function saveData() {
    if (loadFailed) {
        return Promise.reject(new Error('saving is paused because this map failed to load. Reload the page to try again'));
    }
    const mapId = currentMapId;
    const snapshot = JSON.stringify(serializeDoc());
    const save = saveQueue.catch(() => {}).then(async () => {
        $('save-status').textContent = 'Saving to Netlify…';
        const response = await fetch(`/api/data?map=${encodeURIComponent(mapId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: snapshot
        });
        if (!response.ok) await throwResponseError(response, 'Saving regions');
        $('save-status').textContent = 'Saved to Netlify';
    });
    saveQueue = save;
    return save;
}

async function throwResponseError(response, action) {
    let message = `${action} failed (${response.status})`;
    try {
        const body = await response.json();
        if (body.error) message += `: ${body.error}`;
    } catch {
        if (response.statusText) message += `: ${response.statusText}`;
    }
    throw new Error(message);
}

function persistData() {
    saveData().catch(error => reportPersistenceError(error, 'save'));
}

function reportPersistenceError(error, action) {
    console.error(`Could not ${action} map data in Netlify Blobs:`, error);
    $('save-status').textContent = action === 'load' ? 'Load failed' : 'Save failed';
    showToast(action === 'load'
        ? `Could not load saved data from Netlify: ${error.message}`
        : `Could not save to Netlify: ${error.message}`);
}

function showToast(message) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.remove('opacity-0');
    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => toast.classList.add('opacity-0'), 4000);
}

// --- Undo ---
function snapshotState() { return JSON.stringify({ regions, pois, routes }); }
function restoreState(snapshot) {
    const state = JSON.parse(snapshot);
    regions = state.regions; pois = state.pois; routes = state.routes;
}
function pushUndo() { undoStack.push(snapshotState()); redoStack = []; }
function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshotState()); restoreState(undoStack.pop()); persistData(); refreshUI();
}
function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshotState()); restoreState(redoStack.pop()); persistData(); refreshUI();
}

function updateUndoButtons() {
    $('btn-undo').disabled = undoStack.length === 0;
    $('btn-redo').disabled = redoStack.length === 0;
}

// --- Rendering ---
function refreshUI() {
    currentTheme = themeScale();
    renderRegions(); renderRoutes(); renderPois(); renderVertices(); renderDrawing(); renderMeasure();
    renderSidebar(); renderLegend(); renderTimeline(); updateUndoButtons();
}

function updateViewBox() {
    mapSvg.setAttribute('viewBox', `${currentViewBox.x} ${currentViewBox.y} ${currentViewBox.w} ${currentViewBox.h}`);
    renderScaleBar();
    positionPopup();
}

function getSVGCoordinates(evt) {
    const pt = mapSvg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    return pt.matrixTransform(mapSvg.getScreenCTM().inverse());
}

function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    return el;
}

// Size in map units that stays roughly constant on screen while zooming
function ui(n) { return n * currentViewBox.w / 1000; }

const toPx = p => ({ x: p.x * mapWidth, y: p.y * mapHeight });
const pointsAttr = pts => pts.map(p => `${p.x},${p.y}`).join(' ');

function visibleRegions() {
    if (!timeline.enabled) return regions;
    return regions.filter(r => existsAt(r, timeline.year));
}

function existsAt(item, year) {
    return (!Number.isFinite(item.startYear) || item.startYear <= year) &&
           (!Number.isFinite(item.endYear) || year <= item.endYear);
}

function renderRegions() {
    regionsGroup.innerHTML = ''; labelsGroup.innerHTML = '';
    visibleRegions().forEach(r => {
        if (!r.points?.length) return;
        const color = currentTheme ? currentTheme.colorFor(r) : r.color;
        const poly = svgEl('polygon', {
            points: pointsAttr(r.points.map(toPx)),
            fill: hexAlpha(color, currentTheme ? 0.5 : 0.25),
            stroke: safeColor(color)
        });
        poly.dataset.id = r.id;
        poly.classList.add('region-polygon');
        if (selectedRegionId === r.id) poly.setAttribute('stroke-width', '4');
        regionsGroup.appendChild(poly);

        const center = polygonCentroid(r.points.map(toPx));
        const label = svgEl('text', { x: center.x, y: center.y, 'font-size': Math.max(16, mapWidth / 50) });
        label.classList.add('region-label');
        label.textContent = r.title;
        labelsGroup.appendChild(label);
    });
}

function renderRoutes() {
    routesGroup.innerHTML = '';
    routes.forEach(route => {
        if (!route.points?.length) return;
        const style = ROUTE_TYPES[route.type] || ROUTE_TYPES.road;
        const points = pointsAttr(route.points.map(toPx));
        const width = ui(style.width) * (selectedRouteId === route.id ? 1.8 : 1);
        const group = svgEl('g', { 'data-route-id': route.id });
        const casing = svgEl('polyline', { points, class: 'route-line', fill: 'none', stroke: 'rgba(0,0,0,0.55)', 'stroke-width': width + ui(2) });
        const hit = svgEl('polyline', { points, class: 'route-hit', fill: 'none', stroke: 'transparent', 'stroke-width': ui(14) });
        const title = svgEl('title');
        title.textContent = route.name || style.label;
        hit.appendChild(title);
        const line = svgEl('polyline', { points, class: 'route-line', fill: 'none', stroke: style.color, 'stroke-width': width });
        if (style.dash) line.setAttribute('stroke-dasharray', style.dash.split(' ').map(n => ui(Number(n))).join(' '));
        group.append(casing, hit, line);
        routesGroup.appendChild(group);
    });
}

function renderPois() {
    poisGroup.innerHTML = '';
    const radius = ui(10);
    const showAllNames = currentViewBox.w < mapWidth * 0.5;
    pois.forEach(poi => {
        const type = POI_TYPES[poi.type] || POI_TYPES.landmark;
        const { x, y } = toPx(poi);
        const group = svgEl('g', { class: 'poi-marker', transform: `translate(${x} ${y})` });
        group.dataset.poiId = poi.id;
        group.appendChild(svgEl('circle', { class: 'poi-bg', r: radius, fill: 'rgba(17,24,39,0.85)', stroke: type.color, 'stroke-width': ui(2) }));
        const icon = svgEl('text', { 'font-size': radius * 1.1, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'pointer-events': 'none' });
        icon.textContent = type.icon;
        group.appendChild(icon);
        const title = svgEl('title');
        title.textContent = `${poi.name || 'Unnamed place'} (${type.label})`;
        group.appendChild(title);
        if (showAllNames || poi.type === 'capital' || poi.type === 'city') {
            const label = svgEl('text', { class: 'poi-label', y: radius + ui(14), 'font-size': ui(13), 'stroke-width': ui(3) });
            label.textContent = poi.name;
            group.appendChild(label);
        }
        poisGroup.appendChild(group);
    });
}

function renderVertices() {
    verticesGroup.innerHTML = '';
    if (exporting || !selectedRegionId || mode !== 'EDIT') return;
    const r = regions.find(x => x.id === selectedRegionId);
    if (!r) return;
    r.points.forEach((p, i) => {
        const c = svgEl('circle', { cx: p.x * mapWidth, cy: p.y * mapHeight, r: Math.max(4, currentViewBox.w / 200) });
        c.classList.add('vertex-handle');
        c.dataset.index = i;
        verticesGroup.appendChild(c);
    });
}

function renderDrawing() {
    document.querySelectorAll('.draw-point').forEach(c => c.remove());
    tempLine.setAttribute('points', pointsAttr(currentPoints));
    routePreview.setAttribute('points', pointsAttr(routePoints));
    routePreview.setAttribute('stroke-width', ui(3));
    if (!currentPoints.length) {
        tempPreview.setAttribute('points', '');
        closeHint.style.display = 'none';
    }
    [...currentPoints, ...routePoints].forEach(p => {
        const c = svgEl('circle', { cx: p.x, cy: p.y, r: Math.max(4, currentViewBox.w / 200) });
        c.classList.add('draw-point');
        $('drawing-group').appendChild(c);
    });
}

function renderMeasure(cursor) {
    measureGroup.innerHTML = '';
    const pts = cursor ? [...measurePoints, cursor] : measurePoints;
    if (pts.length > 1) {
        measureGroup.appendChild(svgEl('polyline', { points: pointsAttr(pts), class: 'measure-line', 'stroke-width': ui(3) }));
    }
    measurePoints.forEach(p => measureGroup.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r: ui(5), class: 'measure-point', 'stroke-width': ui(1) })));
    $('measure-readout').classList.toggle('hidden', tool !== 'measure');
    $('measure-text').textContent = measurePoints.length
        ? `Distance: ${formatDistance(pathLength(pts))}`
        : 'Click the map to start measuring';
}

function renderSidebar() {
    fillList(regionList, regions, 'No regions yet.', r => ({
        color: r.color, text: r.title + yearsSuffix(r), active: selectedRegionId === r.id,
        onClick: () => editRegion(r.id)
    }));
    fillList($('poi-list'), pois, 'No places yet. Use the Pin tool.', p => ({
        icon: (POI_TYPES[p.type] || POI_TYPES.landmark).icon, text: p.name || 'Unnamed place',
        onClick: () => { zoomToPoints([toPx(p)], 0.25); editPoi(p.id); }
    }));
    fillList($('route-list'), routes, 'No routes yet. Use the Route tool.', rt => ({
        color: (ROUTE_TYPES[rt.type] || ROUTE_TYPES.road).color, text: rt.name || (ROUTE_TYPES[rt.type] || ROUTE_TYPES.road).label,
        onClick: () => editRoute(rt.id)
    }));
    const sorted = [...regions].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    fillList($('view-region-list'), sorted, 'No regions on this map yet.', r => ({
        color: r.color, text: r.title + yearsSuffix(r),
        onClick: () => selectRegion(r, { zoom: true })
    }));
}

function fillList(list, items, emptyText, describe) {
    list.innerHTML = '';
    if (!items.length) {
        const li = document.createElement('li');
        li.className = 'text-gray-500 italic';
        li.textContent = emptyText;
        list.appendChild(li);
        return;
    }
    items.forEach(item => {
        const d = describe(item);
        const li = document.createElement('li');
        li.className = `flex items-center gap-2 bg-gray-700 px-2 py-1 rounded ${d.active ? 'ring-2 ring-blue-500' : ''}`;
        const marker = document.createElement('span');
        if (d.icon) {
            marker.className = 'shrink-0';
            marker.textContent = d.icon;
        } else {
            marker.className = 'w-3 h-3 rounded-full shrink-0';
            marker.style.background = d.color;
        }
        const name = document.createElement('span');
        name.className = 'truncate flex-1 cursor-pointer hover:text-white';
        name.textContent = d.text;
        name.onclick = d.onClick;
        li.append(marker, name);
        list.appendChild(li);
    });
}

function yearsSuffix(item) {
    const text = yearsText(item);
    return text ? ` (${text})` : '';
}

function yearsText(item) {
    const start = Number.isFinite(item.startYear), end = Number.isFinite(item.endYear);
    if (!start && !end) return '';
    if (start && end) return `${item.startYear}–${item.endYear}`;
    return start ? `from ${item.startYear}` : `until ${item.endYear}`;
}

function safeColor(color) {
    return /^#[0-9a-f]{6}$/i.test(color || '') ? color : DEFAULT_REGION_COLOR;
}

function hexAlpha(hex, alpha) {
    const n = parseInt(safeColor(hex).slice(1), 16);
    return `rgba(${(n>>16)&255}, ${(n>>8)&255}, ${n&255}, ${alpha})`;
}

// --- Geometry ---
function polygonCentroid(pts) {
    let area = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const cross = a.x * b.y - b.x * a.y;
        area += cross; cx += (a.x + b.x) * cross; cy += (a.y + b.y) * cross;
    }
    if (Math.abs(area) < 1e-9) {
        return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    }
    return { x: cx / (3 * area), y: cy / (3 * area) };
}

function pointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

function distanceToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distanceToPolygonEdge(p, poly) {
    let min = Infinity;
    for (let i = 0; i < poly.length; i++) min = Math.min(min, distanceToSegment(p, poly[i], poly[(i + 1) % poly.length]));
    return min;
}

function polygonsTouch(a, b, tolerance) {
    const box = pts => pts.reduce((r, p) => ({ minX: Math.min(r.minX, p.x), minY: Math.min(r.minY, p.y), maxX: Math.max(r.maxX, p.x), maxY: Math.max(r.maxY, p.y) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const ba = box(a), bb = box(b);
    if (ba.minX - tolerance > bb.maxX || bb.minX - tolerance > ba.maxX || ba.minY - tolerance > bb.maxY || bb.minY - tolerance > ba.maxY) return false;
    return a.some(p => distanceToPolygonEdge(p, b) < tolerance || pointInPolygon(p, b)) ||
           b.some(p => distanceToPolygonEdge(p, a) < tolerance || pointInPolygon(p, a));
}

function pathLength(pts) {
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return total;
}

function regionContaining(poi) {
    return visibleRegions().find(r => r.points?.length >= 3 && pointInPolygon(poi, r.points));
}

function placesIn(points) {
    return points.length >= 3 ? pois.filter(p => pointInPolygon(p, points)) : [];
}

function neighboursOf(points, excludeId) {
    if (points.length < 3) return [];
    const shape = points.map(toPx);
    const tolerance = Math.max(mapWidth, mapHeight) * 0.02;
    return regions.filter(r => r.id !== excludeId && r.points?.length >= 3 && polygonsTouch(shape, r.points.map(toPx), tolerance));
}

// --- Distances & scale ---
function formatNumber(n) {
    if (!Number.isFinite(n)) return '0';
    const abs = Math.abs(n);
    return n.toLocaleString(undefined, { maximumFractionDigits: abs >= 100 ? 0 : abs >= 1 ? 1 : 3 });
}

function formatDistance(px) {
    if (mapSettings.unitsPerPx > 0) return `${formatNumber(px * mapSettings.unitsPerPx)} ${mapSettings.unit}`;
    return `${formatNumber(px)} px (set a scale in Maps…)`;
}

function routeLength(route) {
    return pathLength(route.points.map(toPx));
}

function niceNumber(x) {
    const power = 10 ** Math.floor(Math.log10(x));
    const f = x / power;
    return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * power;
}

function renderScaleBar() {
    const bar = $('scale-bar');
    const ctm = mapSvg.getScreenCTM();
    if (!(mapSettings.unitsPerPx > 0) || !ctm || !ctm.a) { bar.classList.add('hidden'); return; }
    const screenPerMapPx = ctm.a;
    const units = niceNumber(120 / screenPerMapPx * mapSettings.unitsPerPx);
    $('scale-bar-line').style.width = `${units / mapSettings.unitsPerPx * screenPerMapPx}px`;
    $('scale-bar-label').textContent = `${formatNumber(units)} ${mapSettings.unit}`;
    bar.classList.remove('hidden');
}

// --- Thematic views ---
function themeScale() {
    if (!themeField) return null;
    const groups = new Map();
    let unset = 0;
    regions.forEach(r => {
        const raw = String(r.details?.[themeField] || '').trim();
        if (!raw) { unset++; return; }
        const key = raw.toLowerCase();
        const group = groups.get(key) || { label: raw, count: 0 };
        group.count++;
        groups.set(key, group);
    });
    // Colors are assigned from all regions so the timeline never repaints the survivors
    const sorted = [...groups.entries()].sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label));
    const slots = sorted.length > THEME_PALETTE.length ? THEME_PALETTE.length - 1 : sorted.length;
    const colors = new Map();
    const legend = [];
    sorted.slice(0, slots).forEach(([key, group], i) => {
        colors.set(key, THEME_PALETTE[i]);
        legend.push({ label: group.label, count: group.count, color: THEME_PALETTE[i] });
    });
    const rest = sorted.slice(slots);
    if (rest.length) legend.push({ label: `Other (${rest.length} values)`, count: rest.reduce((s, [, g]) => s + g.count, 0), color: THEME_OTHER_COLOR });
    if (unset) legend.push({ label: 'Not set', count: unset, color: THEME_NONE_COLOR });
    return {
        label: THEME_LABELS[themeField],
        legend,
        colorFor: r => {
            const raw = String(r.details?.[themeField] || '').trim();
            return raw ? colors.get(raw.toLowerCase()) || THEME_OTHER_COLOR : THEME_NONE_COLOR;
        }
    };
}

function renderLegend() {
    const legend = $('legend');
    if (!currentTheme) { legend.classList.add('hidden'); return; }
    legend.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'font-semibold text-gray-100 mb-2';
    title.textContent = `Colored by ${currentTheme.label}`;
    legend.appendChild(title);
    if (!currentTheme.legend.length) {
        const empty = document.createElement('div');
        empty.className = 'text-gray-400';
        empty.textContent = 'No regions yet.';
        legend.appendChild(empty);
    }
    currentTheme.legend.forEach(item => {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-2 py-0.5';
        const swatch = document.createElement('span');
        swatch.className = 'w-3 h-3 rounded-sm shrink-0';
        swatch.style.background = item.color;
        const label = document.createElement('span');
        label.className = 'truncate flex-1 text-gray-200';
        label.textContent = item.label;
        const count = document.createElement('span');
        count.className = 'text-gray-400 tabular-nums';
        count.textContent = item.count;
        row.append(swatch, label, count);
        legend.appendChild(row);
    });
    legend.classList.remove('hidden');
}

// --- Timeline ---
function timelineRange() {
    const years = regions.flatMap(r => [r.startYear, r.endYear]).filter(Number.isFinite);
    return years.length ? { min: Math.min(...years), max: Math.max(...years) } : null;
}

function renderTimeline() {
    const range = timelineRange();
    const panel = $('timeline');
    if (!range) {
        panel.classList.add('hidden');
        if (timeline.enabled) { timeline.enabled = false; $('timeline-enabled').checked = false; stopTimeline(); }
        return;
    }
    panel.classList.remove('hidden');
    const slider = $('timeline-range');
    slider.min = range.min;
    slider.max = range.max;
    timeline.year = Math.min(Math.max(timeline.year, range.min), range.max);
    slider.value = timeline.year;
    slider.disabled = !timeline.enabled;
    $('btn-timeline-play').disabled = !timeline.enabled;
    $('timeline-year').textContent = timeline.enabled ? `Year ${timeline.year}` : `${range.min}–${range.max}`;
}

function setTimelineYear(year) {
    timeline.year = Math.round(year);
    renderRegions();
    renderTimeline();
}

function stopTimeline() {
    clearInterval(timelineTimer);
    timelineTimer = null;
    $('btn-timeline-play').textContent = '▶';
}

function toggleTimelinePlay() {
    if (timelineTimer) { stopTimeline(); return; }
    const range = timelineRange();
    if (!range) return;
    if (timeline.year >= range.max) setTimelineYear(range.min);
    const step = Math.max(1, Math.round((range.max - range.min) / 100));
    $('btn-timeline-play').textContent = '⏸';
    timelineTimer = setInterval(() => {
        const next = Math.min(range.max, timeline.year + step);
        setTimelineYear(next);
        if (next >= range.max) stopTimeline();
    }, 120);
}

// --- Tools & modes ---
function setMode(newMode) {
    mode = newMode;
    closeHistory(); hidePopup(); cancelDrawing(); cancelRoute(); clearMeasure();
    tool = mode === 'EDIT' ? 'region' : 'select';
    selectedRegionId = null;
    selectedRouteId = null;
    $('map-wrapper').className = `map-container mode-${mode === 'EDIT' ? 'edit' : 'view'} inline-block m-auto shadow-2xl`;
    $('edit-panel').classList.toggle('hidden', mode !== 'EDIT');
    $('view-panel').classList.toggle('hidden', mode !== 'VIEW');
    const active = 'px-3 py-1.5 rounded bg-blue-600 text-white font-semibold shadow text-sm';
    const inactive = 'px-3 py-1.5 rounded text-gray-300 hover:bg-gray-600 text-sm';
    $('btn-edit-mode').className = mode === 'EDIT' ? active : inactive;
    $('btn-view-mode').className = mode === 'VIEW' ? active : inactive;
    showRegionInfo(null);
    renderTools();
    refreshUI();
    updateHash();
}

function setTool(newTool) {
    if (newTool === tool && newTool === 'measure') newTool = mode === 'EDIT' ? 'region' : 'select';
    if (newTool !== 'region') cancelDrawing();
    if (newTool !== 'route') cancelRoute();
    if (newTool !== 'measure') clearMeasure();
    hidePopup();
    tool = newTool;
    renderTools();
    refreshUI();
}

function renderTools() {
    document.querySelectorAll('.tool-btn').forEach(button => {
        button.classList.toggle('active', button.dataset.tool === tool);
        button.classList.toggle('hidden', mode !== 'EDIT' && button.classList.contains('edit-only'));
    });
    $('btn-finish-route').classList.toggle('hidden', !(tool === 'route' && routePoints.length >= 2));
    $('measure-readout').classList.toggle('hidden', tool !== 'measure');
    const help = $('tool-help');
    help.innerHTML = '';
    (TOOL_HELP[tool] || []).forEach(text => {
        const li = document.createElement('li');
        li.textContent = text;
        help.appendChild(li);
    });
    updateCursor();
}

function updateCursor() {
    mapSvg.style.cursor = mode === 'EDIT' || tool === 'measure' ? 'crosshair' : 'default';
}

function isDrawing() { return currentPoints.length > 0 || routePoints.length > 0; }

function anyModalOpen() {
    return ['region-modal', 'poi-modal', 'route-modal', 'maps-modal'].some(id => !$(id).classList.contains('hidden'));
}

// --- Zoom helpers ---
function animateViewBox(target, duration = 300) {
    cancelAnimationFrame(viewAnimation);
    const from = { ...currentViewBox };
    const start = performance.now();
    const step = now => {
        const t = Math.min(1, (now - start) / duration);
        const k = 1 - (1 - t) ** 3;
        for (const key of ['x', 'y', 'w', 'h']) currentViewBox[key] = from[key] + (target[key] - from[key]) * k;
        updateViewBox();
        if (t < 1) viewAnimation = requestAnimationFrame(step);
        else refreshUI();
    };
    viewAnimation = requestAnimationFrame(step);
}

function zoomToPoints(pts, minFraction = 0.15) {
    if (!pts.length) return;
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const aspect = mapHeight / mapWidth;
    const w = Math.min(mapWidth * 2, Math.max((maxX - minX) * 1.5, (maxY - minY) * 1.5 / aspect, mapWidth * minFraction));
    const h = w * aspect;
    animateViewBox({ x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h });
}

function zoomToRegion(region) {
    if (region?.points?.length) zoomToPoints(region.points.map(toPx));
}

// --- Popups ---
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function showPopup(anchor, build) {
    const popup = $('map-popup');
    popup.innerHTML = '';
    const close = el('button', 'float-right text-gray-400 hover:text-white text-lg leading-none ml-2', '×');
    close.setAttribute('aria-label', 'Close');
    close.onclick = hidePopup;
    popup.appendChild(close);
    build(popup);
    popup.classList.remove('hidden');
    popupAnchor = anchor;
    positionPopup();
}

function positionPopup() {
    const popup = $('map-popup');
    if (!popupAnchor || popup.classList.contains('hidden')) return;
    const ctm = mapSvg.getScreenCTM();
    if (!ctm) return;
    const pt = mapSvg.createSVGPoint();
    pt.x = popupAnchor.x; pt.y = popupAnchor.y;
    const screen = pt.matrixTransform(ctm);
    const main = $('map-main').getBoundingClientRect();
    let left = screen.x - main.left + 16;
    if (left + popup.offsetWidth > main.width - 8) left = screen.x - main.left - popup.offsetWidth - 16;
    const top = Math.min(Math.max(8, screen.y - main.top - 20), main.height - popup.offsetHeight - 8);
    popup.style.left = `${Math.max(8, left)}px`;
    popup.style.top = `${top}px`;
}

function hidePopup() {
    popupAnchor = null;
    $('map-popup').classList.add('hidden');
    if (selectedRouteId) { selectedRouteId = null; renderRoutes(); }
}

function showPoiPopup(poi) {
    const type = POI_TYPES[poi.type] || POI_TYPES.landmark;
    showPopup(toPx(poi), popup => {
        popup.appendChild(el('div', 'font-bold text-base text-white', `${type.icon} ${poi.name || 'Unnamed place'}`));
        const meta = el('div', 'text-xs text-gray-400 mb-2', type.label);
        const region = regionContaining(poi);
        if (region) {
            meta.append(' in ');
            const link = el('button', 'text-blue-400 hover:text-blue-300 underline', region.title);
            link.onclick = () => { hidePopup(); selectRegion(region, { zoom: true }); };
            meta.appendChild(link);
        }
        popup.appendChild(meta);
        if (poi.description) popup.appendChild(el('p', 'text-gray-200 whitespace-pre-wrap', poi.description));
    });
}

function showRoutePopup(route, anchor) {
    const style = ROUTE_TYPES[route.type] || ROUTE_TYPES.road;
    showPopup(anchor, popup => {
        popup.appendChild(el('div', 'font-bold text-base text-white', route.name || style.label));
        popup.appendChild(el('div', 'text-xs text-gray-400 mb-2', `${style.label} · ${formatDistance(routeLength(route))}`));
        if (route.notes) popup.appendChild(el('p', 'text-gray-200 whitespace-pre-wrap', route.notes));
    });
    selectedRouteId = route.id;
    renderRoutes();
}

function focusPoi(poi) {
    zoomToPoints([toPx(poi)], 0.25);
    if (mode === 'VIEW') setTimeout(() => showPoiPopup(poi), 320);
    else editPoi(poi.id);
}

// --- Events ---
function bindEvents() {
    // Zoom
    mapSvg.addEventListener('wheel', e => {
        e.preventDefault();
        cancelAnimationFrame(viewAnimation);
        const scale = e.deltaY > 0 ? 1.15 : 0.85;
        let newW = currentViewBox.w * scale;
        if (newW > mapWidth * 2 || newW < (mapWidth * 0.05)) return;

        const coords = getSVGCoordinates(e);
        currentViewBox.x += (coords.x - currentViewBox.x) * (1 - scale);
        currentViewBox.y += (coords.y - currentViewBox.y) * (1 - scale);
        currentViewBox.w = newW;
        currentViewBox.h = newW * (mapHeight / mapWidth);

        updateViewBox();
        refreshUI();
    }, { passive: false });

    // Panning, pin dragging and clicks
    mapSvg.addEventListener('pointerdown', e => {
        if (e.button !== 0 || e.target.classList.contains('vertex-handle')) return;
        cancelAnimationFrame(viewAnimation);
        const poiEl = e.target.closest('.poi-marker');
        if (poiEl && mode === 'EDIT' && tool !== 'measure' && !isDrawing()) {
            const poi = pois.find(p => p.id === poiEl.dataset.poiId);
            if (poi) {
                poiDrag = { poi, before: snapshotState(), start: { x: e.clientX, y: e.clientY }, moved: false };
                mapSvg.setPointerCapture(e.pointerId);
                return;
            }
        }
        isPanning = true; hasDragged = false;
        mouseStart = { x: e.clientX, y: e.clientY };
        panStart = { x: currentViewBox.x, y: currentViewBox.y };
        mapSvg.setPointerCapture(e.pointerId);
    });

    mapSvg.addEventListener('pointermove', e => {
        if (poiDrag) {
            if (!poiDrag.moved && Math.hypot(e.clientX - poiDrag.start.x, e.clientY - poiDrag.start.y) > 3) poiDrag.moved = true;
            if (poiDrag.moved) {
                const coords = getSVGCoordinates(e);
                poiDrag.poi.x = Math.max(0, Math.min(1, coords.x / mapWidth));
                poiDrag.poi.y = Math.max(0, Math.min(1, coords.y / mapHeight));
                renderPois();
            }
            return;
        }

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

        const coords = getSVGCoordinates(e);
        if (tool === 'measure' && measurePoints.length) { renderMeasure(coords); return; }
        if (mode === 'EDIT' && tool === 'route' && routePoints.length) {
            routePreview.setAttribute('points', pointsAttr([...routePoints, coords]));
            return;
        }
        if (mode === 'EDIT' && currentPoints.length > 0) {
            tempLine.setAttribute('points', pointsAttr([...currentPoints, coords]));
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
        if (poiDrag) {
            const drag = poiDrag;
            poiDrag = null;
            if (drag.moved) {
                undoStack.push(drag.before); redoStack = [];
                persistData(); refreshUI();
            } else {
                editPoi(drag.poi.id);
            }
            return;
        }
        if (draggedVertexIndex !== null) { draggedVertexIndex = null; persistData(); }
        if (!isPanning) return;
        isPanning = false;
        updateCursor();
        if (!hasDragged) handleMapClick(e);
    });

    // Vertex Drag
    verticesGroup.addEventListener('pointerdown', e => {
        if (e.target.classList.contains('vertex-handle')) {
            e.stopPropagation(); draggedVertexIndex = parseInt(e.target.dataset.index); pushUndo();
            e.target.setPointerCapture(e.pointerId);
        }
    });

    window.addEventListener('resize', () => { renderScaleBar(); positionPopup(); });

    // Nav
    $('btn-edit-mode').onclick = () => setMode('EDIT');
    $('btn-view-mode').onclick = () => setMode('VIEW');
    $('btn-reset-zoom').onclick = () => animateViewBox({ x: 0, y: 0, w: mapWidth, h: mapHeight });
    $('btn-undo').onclick = undo;
    $('btn-redo').onclick = redo;
    $('map-select').onchange = e => loadMap(e.target.value);
    $('btn-maps').onclick = openMapsModal;
    $('btn-export-png').onclick = exportPng;

    $('btn-export').onclick = () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(serializeDoc(), null, 2)], { type: 'application/json' }));
        a.download = `${slugify(currentMap().name)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('file-import').onchange = e => {
        if (!e.target.files[0]) return;
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const data = JSON.parse(ev.target.result);
                if (!Array.isArray(data) && !Array.isArray(data?.regions)) throw new Error('The imported file must contain a list of regions.');
                const doc = normalizeDoc(data);
                pushUndo();
                regions = doc.regions;
                // Older backups only hold regions, so keep the current places and routes
                if (!Array.isArray(data)) {
                    pois = doc.pois; routes = doc.routes;
                    if (data.settings) mapSettings = doc.settings;
                }
                persistData(); refreshUI(); renderScaleBar();
            } catch (error) {
                showToast(`Could not import regions: ${error.message}`);
            }
        };
        reader.onerror = () => showToast('Could not read the selected JSON file.');
        reader.readAsText(e.target.files[0]); e.target.value = '';
    };

    // Map tools and overlays
    document.querySelectorAll('.tool-btn').forEach(button => { button.onclick = () => setTool(button.dataset.tool); });
    $('btn-finish-route').onclick = finishRoute;
    $('btn-clear-measure').onclick = () => { measurePoints = []; renderMeasure(); };
    $('theme-select').onchange = e => { themeField = e.target.value; refreshUI(); };
    $('timeline-enabled').onchange = e => {
        timeline.enabled = e.target.checked;
        if (!timeline.enabled) stopTimeline();
        refreshUI();
    };
    $('timeline-range').oninput = e => setTimelineYear(Number(e.target.value));
    $('btn-timeline-play').onclick = toggleTimelinePlay;

    // Region modal
    $('btn-modal-cancel').onclick = () => { modal.classList.add('hidden'); cancelDrawing(); };
    $('modal-coat-of-arms').onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            showToast('Choose an image file.');
            e.target.value = '';
            return;
        }
        try {
            const session = modalSession;
            const image = await shrinkImage(file);
            if (session !== modalSession) return;
            pendingCoatArmsFile = image;
            removeCoatArms = false;
            setCoatPreview(URL.createObjectURL(image));
        } catch (error) {
            showToast(error.message);
            e.target.value = '';
        }
    };
    $('btn-clear-coat-of-arms').onclick = () => {
        pendingCoatArmsFile = null;
        removeCoatArms = true;
        $('modal-coat-of-arms').value = '';
        setCoatPreview('');
    };
    $('btn-ai-description').onclick = e => generateText(e.currentTarget, 'description', modalDesc);
    $('btn-ai-history').onclick = e => generateText(e.currentTarget, 'history', modalHistory);
    $('btn-ai-coat').onclick = e => generateCoatOfArms(e.currentTarget);

    $('btn-modal-save').onclick = async () => {
        const startYear = parseYear($('modal-start-year').value);
        const endYear = parseYear($('modal-end-year').value);
        if (startYear !== null && endYear !== null && startYear > endYear) {
            showToast('The start year must be before the end year.');
            return;
        }

        const existing = editingId ? regions.find(x => x.id === editingId) : null;
        const region = existing || {
            id: 'r_' + crypto.randomUUID(),
            points: currentPoints.map(p => ({ x: p.x / mapWidth, y: p.y / mapHeight }))
        };

        try {
            let coatArms = removeCoatArms ? null : region.coatArms || null;
            if (pendingCoatArmsFile) {
                coatArms = await uploadCoatArms(region.id, pendingCoatArmsFile);
            }

            pushUndo();
            Object.assign(region, {
                title: modalTitle.value.trim() || 'Untitled',
                color: modalColor.value,
                description: modalDesc.value.trim(),
                history: modalHistory.value.trim(),
                details: readDetails(),
                startYear,
                endYear,
                coatArms
            });
            if (!existing) regions.push(region);
            refreshUI();
            await saveData();
            modal.classList.add('hidden');
            cancelDrawing();
        } catch (error) {
            reportPersistenceError(error, 'save');
        }
    };

    $('btn-modal-delete').onclick = () => {
        if (confirm("Delete this region?")) { pushUndo(); regions = regions.filter(x => x.id !== editingId); if (selectedRegionId === editingId) selectedRegionId = null; persistData(); refreshUI(); modal.classList.add('hidden'); cancelDrawing(); }
    };

    // Place modal
    populateTypeSelect($('poi-type'), POI_TYPES);
    $('poi-name').oninput = () => {
        if (editingPoiId) return;
        const name = $('poi-name').value.trim().toLowerCase();
        if (name && regions.some(r => (r.details?.capital || '').trim().toLowerCase() === name)) $('poi-type').value = 'capital';
    };
    $('btn-poi-cancel').onclick = () => { $('poi-modal').classList.add('hidden'); pendingPoiPoint = null; };
    $('btn-poi-save').onclick = savePoi;
    $('btn-poi-delete').onclick = () => {
        if (!confirm('Delete this place?')) return;
        pushUndo();
        pois = pois.filter(p => p.id !== editingPoiId);
        persistData(); refreshUI();
        $('poi-modal').classList.add('hidden');
    };

    // Route modal
    populateTypeSelect($('route-type'), ROUTE_TYPES);
    $('btn-route-cancel').onclick = () => { $('route-modal').classList.add('hidden'); cancelRoute(); };
    $('btn-route-save').onclick = saveRoute;
    $('btn-route-delete').onclick = () => {
        if (!confirm('Delete this route?')) return;
        pushUndo();
        routes = routes.filter(r => r.id !== editingRouteId);
        persistData(); refreshUI();
        $('route-modal').classList.add('hidden');
    };

    // Maps modal
    $('btn-maps-close').onclick = () => $('maps-modal').classList.add('hidden');
    $('btn-map-settings-save').onclick = saveMapSettings;
    $('btn-add-map').onclick = addMap;

    // View panel & history
    $('btn-view-back').onclick = () => { selectedRegionId = null; showRegionInfo(null); renderRegions(); updateHash(); };
    $('info-overview-tab').onclick = () => { closeHistory(); setInfoTab(false); };
    $('info-history-button').onclick = openHistory;
    $('btn-close-history').onclick = closeHistory;
    $('history-overlay').onclick = e => { if (e.target === $('history-overlay')) closeHistory(); };
    $('history-content').addEventListener('click', e => {
        const link = e.target.closest('[data-region-id]');
        if (!link) return;
        const region = regions.find(r => r.id === link.dataset.regionId);
        if (!region) return;
        closeHistory();
        selectRegion(region, { zoom: true });
    });

    document.addEventListener('keydown', handleKeydown);
}

function populateTypeSelect(select, types) {
    for (const [value, type] of Object.entries(types)) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = type.icon ? `${type.icon} ${type.label}` : type.label;
        select.appendChild(option);
    }
}

function handleKeydown(e) {
    if (e.key === 'Escape') {
        if (!$('history-overlay').classList.contains('hidden')) { closeHistory(); return; }
        if (!$('maps-modal').classList.contains('hidden')) { $('maps-modal').classList.add('hidden'); return; }
        if (anyModalOpen()) return;
        hidePopup(); cancelDrawing(); cancelRoute();
        if (measurePoints.length) { measurePoints = []; renderMeasure(); }
        renderTools();
        return;
    }
    if (anyModalOpen() || e.target.closest?.('input, textarea, select, [contenteditable]')) return;

    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && key === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === 'Enter') {
        if (routePoints.length >= 2) finishRoute();
        else if (currentPoints.length >= 3) finishDrawing();
        return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
        const list = currentPoints.length ? currentPoints : routePoints.length ? routePoints : tool === 'measure' ? measurePoints : null;
        if (list?.length) {
            e.preventDefault();
            list.pop();
            renderDrawing(); renderMeasure(); renderTools();
        }
    }
}

function handleMapClick(e) {
    const coords = getSVGCoordinates(e);
    const point = { x: coords.x, y: coords.y };
    const target = document.elementFromPoint(e.clientX, e.clientY);

    if (tool === 'measure') { measurePoints.push(point); renderMeasure(); return; }
    if (mode === 'EDIT' && tool === 'route') { addRoutePoint(point); return; }
    if (mode === 'EDIT' && tool === 'region' && currentPoints.length) { addRegionPoint(point); return; }

    const poiEl = target?.closest?.('.poi-marker');
    const routeEl = target?.closest?.('[data-route-id]');
    const poly = target?.closest?.('.region-polygon');

    if (poiEl) {
        const poi = pois.find(p => p.id === poiEl.dataset.poiId);
        if (poi) mode === 'EDIT' ? editPoi(poi.id) : showPoiPopup(poi);
        return;
    }
    if (mode === 'EDIT' && tool === 'pin') { hidePopup(); newPoi(point); return; }
    if (routeEl) {
        const route = routes.find(r => r.id === routeEl.dataset.routeId);
        if (route) mode === 'EDIT' ? editRoute(route.id) : showRoutePopup(route, point);
        return;
    }
    hidePopup();
    if (poly) {
        const region = regions.find(item => item.id === poly.dataset.id);
        if (region) selectRegion(region);
        return;
    }
    if (mode === 'EDIT' && tool === 'region' && !target?.classList.contains('vertex-handle')) {
        if (selectedRegionId) { selectedRegionId = null; refreshUI(); return; }
        addRegionPoint(point);
    }
}

function addRegionPoint(point) {
    if (currentPoints.length >= 3 && Math.hypot(point.x - currentPoints[0].x, point.y - currentPoints[0].y) < currentViewBox.w * 0.02) {
        finishDrawing();
        return;
    }
    currentPoints.push(point);
    renderDrawing();
}

function addRoutePoint(point) {
    const last = routePoints[routePoints.length - 1];
    if (routePoints.length >= 2 && Math.hypot(point.x - last.x, point.y - last.y) < currentViewBox.w * 0.015) {
        finishRoute();
        return;
    }
    routePoints.push(point);
    renderDrawing();
    renderTools();
}

// --- Regions ---
function readDetails() {
    return Object.fromEntries(Object.entries(DETAIL_INPUTS).map(([key, id]) => [key, $(id).value]));
}

function parseYear(value) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    const year = Number(text);
    return Number.isFinite(year) ? Math.round(year) : null;
}

function selectRegion(region, { zoom = false } = {}) {
    if (mode === 'EDIT') {
        editRegion(region.id);
        return;
    }
    selectedRegionId = region.id;
    hidePopup();
    showRegionInfo(region);
    renderRegions();
    updateHash();
    if (zoom) zoomToRegion(region);
}

function showRegionInfo(region) {
    $('view-empty').classList.toggle('hidden', !!region);
    $('view-region').classList.toggle('hidden', !region);
    if (!region) return;

    infoTitle.textContent = region.title;
    infoDesc.textContent = region.description || '';
    infoDesc.classList.toggle('hidden', !region.description);
    const years = yearsText(region);
    $('info-years').textContent = years ? `Exists ${years}` : '';
    $('info-years').classList.toggle('hidden', !years);

    [$('info-coat-of-arms'), $('history-coat-of-arms')].forEach(coatArms => {
        if (region.coatArms) {
            coatArms.src = imageEndpoint(region.id, region.coatArms);
            coatArms.classList.remove('hidden');
        } else {
            coatArms.removeAttribute('src');
            coatArms.classList.add('hidden');
        }
    });

    setInfoTab(false);
    $('history-title').textContent = `${region.title} — History`;
    renderMarkdown(region.history || '*No history has been added for this region yet.*', $('history-content'));

    infoCards.innerHTML = '';
    if (region.details) {
        for (const [key, label] of Object.entries(DETAIL_LABELS)) {
            if (!region.details[key]) continue;
            const card = el('div', 'bg-gray-800 p-2 rounded border border-gray-700');
            card.appendChild(el('div', 'text-xs text-blue-400 font-bold uppercase', label));
            const value = el('div', 'text-gray-200');
            if (key === 'capital' || key === 'settlements') appendPlaceLinks(value, region.details[key], key === 'settlements');
            else value.textContent = region.details[key];
            card.appendChild(value);
            infoCards.appendChild(card);
        }
    }

    const places = placesIn(region.points || []);
    $('info-places-section').classList.toggle('hidden', !places.length);
    const list = $('info-places');
    list.innerHTML = '';
    places.forEach(poi => {
        const type = POI_TYPES[poi.type] || POI_TYPES.landmark;
        const li = el('li');
        const button = el('button', 'text-left text-blue-300 hover:text-white', `${type.icon} ${poi.name || 'Unnamed place'}`);
        button.onclick = () => focusPoi(poi);
        li.append(button, el('span', 'text-gray-500 text-xs ml-2', type.label));
        list.appendChild(li);
    });
}

// Capital and settlement names that match a pin become links to it
function appendPlaceLinks(container, text, splitList) {
    const names = splitList ? text.split(/\s*[,;]\s*/).filter(Boolean) : [text.trim()];
    names.forEach((name, i) => {
        if (i) container.append(', ');
        const poi = findPoiByName(name);
        if (poi) {
            const link = el('button', 'text-blue-300 hover:text-white underline decoration-dotted', `📍 ${name}`);
            link.title = 'Show on map';
            link.onclick = () => focusPoi(poi);
            container.appendChild(link);
        } else {
            container.append(name);
        }
    });
}

function findPoiByName(name) {
    const key = name.trim().toLowerCase();
    return key ? pois.find(p => (p.name || '').trim().toLowerCase() === key) : null;
}

function imageEndpoint(id, version, kind) {
    return `/api/data?image=${encodeURIComponent(id)}&version=${encodeURIComponent(version)}${kind ? `&kind=${kind}` : ''}`;
}

async function uploadCoatArms(regionId, file) {
    const version = crypto.randomUUID();
    const response = await fetch(imageEndpoint(regionId, version), {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file
    });
    if (!response.ok) await throwResponseError(response, 'Uploading the coat of arms');
    return version;
}

function setCoatPreview(src) {
    if (coatPreviewObjectUrl) URL.revokeObjectURL(coatPreviewObjectUrl);
    coatPreviewObjectUrl = src && src.startsWith('blob:') ? src : null;
    const preview = $('modal-coat-preview');
    if (src) {
        preview.src = src;
        preview.classList.remove('hidden');
        $('btn-clear-coat-of-arms').classList.remove('hidden');
    } else {
        preview.removeAttribute('src');
        preview.classList.add('hidden');
        $('btn-clear-coat-of-arms').classList.add('hidden');
    }
}

function resetCoatArmsForm(version, regionId) {
    pendingCoatArmsFile = null;
    removeCoatArms = false;
    $('modal-coat-of-arms').value = '';
    setCoatPreview(version ? imageEndpoint(regionId, version) : '');
}

function openHistory() {
    setInfoTab(true);
    $('history-overlay').classList.remove('hidden');
    $('history-overlay').classList.add('flex');
    $('btn-close-history').focus();
}

function closeHistory() {
    $('history-overlay').classList.add('hidden');
    $('history-overlay').classList.remove('flex');
    setInfoTab(false);
}

function setInfoTab(historySelected) {
    const overview = $('info-overview-tab');
    const history = $('info-history-button');
    overview.setAttribute('aria-selected', String(!historySelected));
    history.setAttribute('aria-selected', String(historySelected));
    overview.classList.toggle('border-blue-500', !historySelected);
    overview.classList.toggle('border-transparent', historySelected);
    overview.classList.toggle('text-white', !historySelected);
    overview.classList.toggle('text-gray-400', historySelected);
    history.classList.toggle('border-blue-500', historySelected);
    history.classList.toggle('border-transparent', !historySelected);
    history.classList.toggle('text-white', historySelected);
    history.classList.toggle('text-gray-400', !historySelected);
}

function fillRegionForm(region) {
    modalSession++;
    modalTitle.value = region?.title || '';
    modalColor.value = safeColor(region?.color);
    modalDesc.value = region?.description || '';
    modalHistory.value = region?.history || '';
    $('modal-start-year').value = Number.isFinite(region?.startYear) ? region.startYear : '';
    $('modal-end-year').value = Number.isFinite(region?.endYear) ? region.endYear : '';
    resetCoatArmsForm(region?.coatArms, region?.id);
    const details = region?.details || {};
    for (const [key, id] of Object.entries(DETAIL_INPUTS)) $(id).value = details[key] || '';
}

function finishDrawing() {
    editingId = null;
    $('modal-heading').textContent = 'New Region';
    fillRegionForm(null);
    $('btn-modal-delete').classList.add('hidden');
    modal.classList.remove('hidden');
    modalTitle.focus();
}

function editRegion(id) {
    editingId = id; selectedRegionId = id; refreshUI();
    const r = regions.find(x => x.id === id);
    $('modal-heading').textContent = 'Edit Region';
    fillRegionForm(r);
    $('btn-modal-delete').classList.remove('hidden');
    modal.classList.remove('hidden');
    modalTitle.focus();
}

function cancelDrawing() {
    currentPoints = []; tempLine.setAttribute('points', ''); tempPreview.setAttribute('points', '');
    closeHint.style.display = 'none';
    renderDrawing();
}

// --- Places ---
function unplacedSettlementNames() {
    const names = new Map();
    regions.forEach(r => {
        const d = r.details || {};
        [d.capital || '', ...(d.settlements || '').split(/\s*[,;]\s*/)].forEach(name => {
            const trimmed = name.trim();
            if (trimmed && !findPoiByName(trimmed)) names.set(trimmed.toLowerCase(), trimmed);
        });
    });
    return [...names.values()].sort((a, b) => a.localeCompare(b));
}

function openPoiModal(poi) {
    $('poi-heading').textContent = poi ? 'Edit Place' : 'New Place';
    $('poi-name').value = poi?.name || '';
    $('poi-type').value = poi?.type || 'city';
    $('poi-desc').value = poi?.description || '';
    $('btn-poi-delete').classList.toggle('hidden', !poi);
    const suggestions = $('poi-suggestions');
    suggestions.innerHTML = '';
    unplacedSettlementNames().forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        suggestions.appendChild(option);
    });
    $('poi-modal').classList.remove('hidden');
    $('poi-name').focus();
}

function newPoi(point) {
    editingPoiId = null;
    pendingPoiPoint = { x: Math.max(0, Math.min(1, point.x / mapWidth)), y: Math.max(0, Math.min(1, point.y / mapHeight)) };
    openPoiModal(null);
}

function editPoi(id) {
    const poi = pois.find(p => p.id === id);
    if (!poi) return;
    editingPoiId = id;
    pendingPoiPoint = null;
    openPoiModal(poi);
}

function savePoi() {
    const values = {
        name: $('poi-name').value.trim() || 'Unnamed place',
        type: $('poi-type').value,
        description: $('poi-desc').value.trim()
    };
    pushUndo();
    const existing = editingPoiId && pois.find(p => p.id === editingPoiId);
    if (existing) Object.assign(existing, values);
    else if (pendingPoiPoint) pois.push({ id: 'p_' + crypto.randomUUID(), ...pendingPoiPoint, ...values });
    pendingPoiPoint = null;
    $('poi-modal').classList.add('hidden');
    persistData(); refreshUI();
}

// --- Routes ---
function finishRoute() {
    if (routePoints.length < 2) { showToast('A route needs at least two points.'); return; }
    editingRouteId = null;
    pendingRoutePoints = routePoints.map(p => ({ x: p.x / mapWidth, y: p.y / mapHeight }));
    openRouteModal(null, pathLength(routePoints));
}

function editRoute(id) {
    const route = routes.find(r => r.id === id);
    if (!route) return;
    editingRouteId = id;
    pendingRoutePoints = null;
    openRouteModal(route, routeLength(route));
}

function openRouteModal(route, lengthPx) {
    $('route-heading').textContent = route ? 'Edit Route' : 'New Route';
    $('route-length').textContent = `Length: ${formatDistance(lengthPx)}`;
    $('route-name').value = route?.name || '';
    $('route-type').value = route?.type || 'road';
    $('route-notes').value = route?.notes || '';
    $('btn-route-delete').classList.toggle('hidden', !route);
    $('route-modal').classList.remove('hidden');
    $('route-name').focus();
}

function saveRoute() {
    const values = {
        name: $('route-name').value.trim(),
        type: $('route-type').value,
        notes: $('route-notes').value.trim()
    };
    pushUndo();
    const existing = editingRouteId && routes.find(r => r.id === editingRouteId);
    if (existing) Object.assign(existing, values);
    else if (pendingRoutePoints) routes.push({ id: 'rt_' + crypto.randomUUID(), points: pendingRoutePoints, ...values });
    pendingRoutePoints = null;
    $('route-modal').classList.add('hidden');
    cancelRoute();
    persistData(); refreshUI();
}

function cancelRoute() {
    routePoints = [];
    routePreview.setAttribute('points', '');
    renderDrawing();
    $('btn-finish-route').classList.add('hidden');
}

function clearMeasure() {
    measurePoints = [];
    measureGroup.innerHTML = '';
}

// --- Markdown ---
function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderInline(text) {
    // Pull out code spans and [[links]] before escaping so their contents stay literal
    const tokens = [];
    const hold = html => `\u0000${tokens.push(html) - 1}\u0000`;
    let s = String(text).replace(/\u0000/g, '')
        .replace(/`([^`]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`))
        .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, name, label) => hold(regionLinkHtml(name.trim(), (label || name).trim())));
    s = escapeHtml(s)
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.+?)__/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
        .replace(/(^|[\s(])_(?!\s)(.+?)_(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>')
        .replace(/~~(.+?)~~/g, '<del>$1</del>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[i]);
}

function regionLinkHtml(name, label) {
    const region = regions.find(r => (r.title || '').trim().toLowerCase() === name.toLowerCase());
    if (!region) return `<span class="md-missing-link" title="No region named ${escapeHtml(name)}">${escapeHtml(label)}</span>`;
    return `<button type="button" class="md-region-link" data-region-id="${escapeHtml(region.id)}">${escapeHtml(label)}</button>`;
}

function markdownToHtml(src) {
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let paragraph = [], list = null, quote = [];
    const flushParagraph = () => { if (paragraph.length) out.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`); paragraph = []; };
    const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map(i => `<li>${renderInline(i)}</li>`).join('')}</${list.tag}>`); list = null; };
    const flushQuote = () => { if (quote.length) out.push(`<blockquote>${quote.map(renderInline).join('<br>')}</blockquote>`); quote = []; };
    const flushAll = () => { flushParagraph(); flushList(); flushQuote(); };

    for (const line of lines) {
        let m;
        if (!line.trim()) { flushAll(); continue; }
        if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushAll(); out.push(`<h${m[1].length}>${renderInline(m[2])}</h${m[1].length}>`); continue; }
        if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushAll(); out.push('<hr>'); continue; }
        if ((m = line.match(/^>\s?(.*)$/))) { flushParagraph(); flushList(); quote.push(m[1]); continue; }
        if ((m = line.match(/^\s*[-*+]\s+(.*)$/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
            const tag = /^\s*\d/.test(line) ? 'ol' : 'ul';
            flushParagraph(); flushQuote();
            if (list && list.tag !== tag) flushList();
            if (!list) list = { tag, items: [] };
            list.items.push(m[1]);
            continue;
        }
        flushList(); flushQuote();
        paragraph.push(line);
    }
    flushAll();
    return out.join('');
}

function renderMarkdown(src, container) {
    container.innerHTML = markdownToHtml(src);
}

// --- AI lore helper ---
function draftRegionPoints() {
    const existing = editingId && regions.find(r => r.id === editingId);
    return existing ? existing.points : currentPoints.map(p => ({ x: p.x / mapWidth, y: p.y / mapHeight }));
}

async function requestLore(kind) {
    const points = draftRegionPoints();
    const summarize = r => ({ title: r.title, description: r.description, details: r.details, startYear: r.startYear, endYear: r.endYear });
    const response = await fetch('/api/lore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            kind,
            mapName: currentMap().name,
            region: {
                title: modalTitle.value.trim(),
                description: modalDesc.value.trim(),
                history: modalHistory.value.trim(),
                details: readDetails(),
                startYear: parseYear($('modal-start-year').value),
                endYear: parseYear($('modal-end-year').value)
            },
            neighbours: neighboursOf(points, editingId).map(summarize),
            places: placesIn(points).map(p => ({ name: p.name, type: (POI_TYPES[p.type] || POI_TYPES.landmark).label, description: p.description }))
        })
    });
    if (!response.ok) await throwResponseError(response, 'Generating with AI');
    return response.json();
}

async function runAiTask(button, task) {
    if (button.disabled) return;
    const label = button.textContent;
    const session = modalSession;
    button.disabled = true;
    button.textContent = 'Generating…';
    try {
        await task(() => session === modalSession && !modal.classList.contains('hidden'));
    } catch (error) {
        showToast(error.message);
    } finally {
        button.disabled = false;
        button.textContent = label;
    }
}

function generateText(button, kind, field) {
    if (field.value.trim() && !confirm('Replace the current text with an AI-generated version? The current text is used as its starting point.')) return;
    runAiTask(button, async stillOpen => {
        const { text } = await requestLore(kind);
        if (stillOpen()) field.value = text;
    });
}

function generateCoatOfArms(button) {
    runAiTask(button, async stillOpen => {
        const { image, mimeType } = await requestLore('coat-of-arms');
        const bytes = Uint8Array.from(atob(image), c => c.charCodeAt(0));
        const file = await shrinkImage(new File([bytes], 'coat-of-arms.png', { type: mimeType || 'image/png' }));
        if (!stillOpen()) return;
        pendingCoatArmsFile = file;
        removeCoatArms = false;
        $('modal-coat-of-arms').value = '';
        setCoatPreview(URL.createObjectURL(file));
    });
}

// --- Images ---
function loadImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Could not load image ${url}`));
        image.src = url;
    });
}

async function shrinkImage(file, maxBytes = MAX_IMAGE_BYTES) {
    if (file.size <= maxBytes) return file;
    const url = URL.createObjectURL(file);
    try {
        const image = await loadImage(url);
        let scale = Math.min(1, 6000 / Math.max(image.naturalWidth, image.naturalHeight));
        for (let attempt = 0; attempt < 8; attempt++) {
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(image.naturalWidth * scale);
            canvas.height = Math.round(image.naturalHeight * scale);
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
            if (blob && blob.size <= maxBytes) {
                return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
            }
            scale *= 0.8;
        }
        throw new Error('The image is too large to shrink below 5 MB.');
    } finally {
        URL.revokeObjectURL(url);
    }
}

function slugify(text) {
    return (text || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';
}

// --- PNG export ---
async function exportPng() {
    const button = $('btn-export-png');
    button.disabled = true;
    button.textContent = 'Exporting…';
    const savedView = { ...currentViewBox };
    const savedSelection = selectedRegionId;
    try {
        // Render at full-map zoom so pins, routes and labels are sized for the whole map
        exporting = true;
        selectedRegionId = null;
        currentViewBox = { x: 0, y: 0, w: mapWidth, h: mapHeight };
        refreshUI();
        const clone = mapSvg.cloneNode(true);
        exporting = false;
        selectedRegionId = savedSelection;
        currentViewBox = savedView;
        updateViewBox();
        refreshUI();

        ['map-image', 'vertices-group', 'drawing-group', 'measure-group'].forEach(id => clone.querySelector(`#${id}`)?.remove());
        clone.querySelectorAll('.route-hit, title').forEach(node => node.remove());
        clone.removeAttribute('style');
        clone.setAttribute('xmlns', SVG_NS);
        clone.setAttribute('viewBox', `0 0 ${mapWidth} ${mapHeight}`);
        clone.setAttribute('width', mapWidth);
        clone.setAttribute('height', mapHeight);
        const style = document.createElementNS(SVG_NS, 'style');
        style.textContent = EXPORT_CSS;
        clone.insertBefore(style, clone.firstChild);

        const svgUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
        let overlay;
        try { overlay = await loadImage(svgUrl); } finally { URL.revokeObjectURL(svgUrl); }

        const scale = Math.min(1, 8192 / Math.max(mapWidth, mapHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(mapWidth * scale);
        canvas.height = Math.round(mapHeight * scale);
        const ctx = canvas.getContext('2d');
        if (mapImageEl) ctx.drawImage(mapImageEl, 0, 0, canvas.width, canvas.height);
        else { ctx.fillStyle = '#1a202c'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height);
        drawExportExtras(ctx, canvas.width, canvas.height);

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('the browser could not create the image');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${slugify(currentMap().name)}${timeline.enabled ? `-year-${timeline.year}` : ''}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (error) {
        showToast(`Could not export the map image: ${error.message}`);
    } finally {
        if (exporting) {
            exporting = false;
            selectedRegionId = savedSelection;
            currentViewBox = savedView;
            updateViewBox();
            refreshUI();
        }
        button.disabled = false;
        button.textContent = 'Export PNG';
    }
}

function drawExportExtras(ctx, width, height) {
    const font = Math.max(14, Math.round(Math.max(width, height) / 90));
    const pad = font;
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${font}px system-ui, sans-serif`;

    if (timeline.enabled) {
        const text = `Year ${timeline.year}`;
        const w = ctx.measureText(text).width + pad * 2;
        ctx.fillStyle = 'rgba(17,24,39,0.85)';
        ctx.fillRect(pad, pad, w, font * 2);
        ctx.fillStyle = '#f3f4f6';
        ctx.fillText(text, pad * 2, pad + font);
    }

    if (currentTheme?.legend.length) {
        const rows = [{ label: `Colored by ${currentTheme.label}`, title: true }, ...currentTheme.legend];
        const lineHeight = font * 1.6;
        const boxWidth = Math.max(...rows.map(r => ctx.measureText(r.label).width)) + font * 2.5 + pad * 2;
        const boxHeight = rows.length * lineHeight + pad;
        const x = pad, y = height - boxHeight - pad;
        ctx.fillStyle = 'rgba(17,24,39,0.9)';
        ctx.fillRect(x, y, boxWidth, boxHeight);
        rows.forEach((row, i) => {
            const cy = y + pad / 2 + lineHeight * (i + 0.5);
            if (!row.title) {
                ctx.fillStyle = row.color;
                ctx.fillRect(x + pad, cy - font / 2, font, font);
            }
            ctx.fillStyle = row.title ? '#f3f4f6' : '#d1d5db';
            ctx.fillText(row.label, x + pad + (row.title ? 0 : font * 1.5), cy);
        });
    }
}

// --- Links ---
function readHash() {
    return Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
}

function updateHash() {
    const params = new URLSearchParams({ map: currentMapId });
    if (mode === 'VIEW' && selectedRegionId) params.set('region', selectedRegionId);
    history.replaceState(null, '', `#${params}`);
}

// Start the app
init();
