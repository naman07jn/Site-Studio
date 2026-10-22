import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const $ = (id) => document.getElementById(id);
// ================= STEP 1: map picker (Leaflet + Esri imagery, no OpenStreetMap) =================
const map = L.map('map', { zoomControl: false }).setView([28.7525, 77.4996], 16);   // starts near KIET, Muradnagar
L.control.zoom({ position: 'bottomright' }).addTo(map);
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const esriAttr = 'Imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community';
const opts = { maxZoom: 19, maxNativeZoom: 18 };
const streets = L.tileLayer(ESRI + '/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { ...opts, attribution: 'Streets © Esri, HERE, Garmin' });
const sat = L.tileLayer(ESRI + '/World_Imagery/MapServer/tile/{z}/{y}/{x}', { ...opts, attribution: esriAttr });
const labels = L.tileLayer(ESRI + '/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { ...opts, attribution: '© Esri' });
const roads = L.tileLayer(ESRI + '/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { ...opts, attribution: '© Esri' });
const hybrid = L.layerGroup([sat, roads, labels]);          // satellite + road names + place/boundary names
const topo = L.tileLayer(ESRI + '/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { ...opts, attribution: 'Topo © Esri, HERE, Garmin' });
streets.addTo(map);                                          // default: labelled street map, easiest for finding and outlining an area
L.control.layers({ 'Streets (names, roads, boundaries)': streets, 'Satellite + labels': hybrid, 'Satellite only': sat, 'Topo': topo }, {}, { position: 'bottomleft', collapsed: false }).addTo(map);
let drawing = false, verts = [], poly = null, rubber = null, area = null, box = null;
const clearDraw = () => { [poly, rubber, area].forEach((l) => l && l.remove()); poly = rubber = area = null; };
$('draw').onclick = () => {
  clearDraw(); verts = []; box = null; drawing = true; $('go').disabled = true;
  map.doubleClickZoom.disable(); map.getContainer().style.cursor = 'crosshair';
  $('pmsg').textContent = 'Left-click for each corner. Right-click to close the shape.';
};
map.on('click', (e) => {            // left click = add a corner
  if (!drawing) return;
  verts.push(e.latlng); if (poly) poly.remove();
  poly = L.polyline(verts, { color: '#e53e3e' }).addTo(map);
});
map.on('mousemove', (e) => {        // dashed line from the last corner to the mouse
  if (!drawing || !verts.length) return;
  if (rubber) rubber.remove(); rubber = L.polyline([verts.at(-1), e.latlng], { color: '#e53e3e', dashArray: '4' }).addTo(map);
});
map.on('contextmenu', (e) => {      // right click = close the shape
  L.DomEvent.preventDefault(e.originalEvent);
  if (!drawing) return;
  if (verts.length < 3) { $('pmsg').textContent = 'Need at least 3 corners first.'; return; }
  drawing = false; clearDraw(); area = L.polygon(verts, { color: '#e53e3e' }).addTo(map);
  box = area.getBounds(); map.doubleClickZoom.enable(); map.getContainer().style.cursor = '';
  $('go').disabled = false; $('pmsg').textContent = 'Area ready. Press "Generate 3D site".';
});

// ================= data model =================
// object: {id, kind, poly:[[x,z]..] (metres), h, src:'tag'|'estimate'|'you', color:'#rrggbb', name, flagged}
let objects = [], original = [], flats = [], selectedId = null, tool = 'orbit', tracePts = [], showBefore = false, nextId = 1;
let center = { lat: 0, lon: 0 };
const COLORS = { map: '#9aa7b8', traced: '#6aa84f', cafe: '#e69138', seat: '#a5673f', building: '#6fa8dc', bench: '#8b5a2b', tree: '#2f9e44' };
const SRC_TEXT = { tag: 'from building data (height or floors)', estimate: 'ESTIMATE (no height in the data)', you: 'set by you' };
const project = (lat, lon) => [(lon - center.lon) * 111320 * Math.cos(center.lat * Math.PI / 180), -(lat - center.lat) * 110540];
function heightOf(t) {   // Overture properties: height (m) or num_floors
  const h = parseFloat(t.height); if (h > 0) return [h, 'tag'];
  const l = parseFloat(t.num_floors); if (l > 0) return [l * 3.2, 'tag'];
  return [9, 'estimate'];
}

// ================= three.js scene =================
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xdfe6ee);
const camera = new THREE.PerspectiveCamera(50, 1, 1, 60000); camera.position.set(150, 160, 200);
const controls = new OrbitControls(camera, canvas); controls.maxPolarAngle = Math.PI / 2.05;
let dirty = true;                       // render only when something changed
controls.addEventListener('change', () => { dirty = true; });
scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(100, 200, 80); scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xeef3e8 }));
ground.position.y = -0.05; scene.add(ground);
const flatGroup = new THREE.Group(), group = new THREE.Group(), labelGroup = new THREE.Group();
scene.add(flatGroup, group, labelGroup);
const traceLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff0000 })); scene.add(traceLine);
function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; if (!w) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true; }
addEventListener('resize', resize);

// roads/paths/runways become flat ribbons (a quad per segment), merged into ONE mesh per kind for speed
function ribbon(pts, w, y, pos) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1], l = Math.hypot(x2 - x1, z2 - z1) || 1;
    const nx = -(z2 - z1) / l * w / 2, nz = (x2 - x1) / l * w / 2;
    pos.push(x1 + nx, y, z1 + nz, x1 - nx, y, z1 - nz, x2 + nx, y, z2 + nz, x1 - nx, y, z1 - nz, x2 - nx, y, z2 - nz, x2 + nx, y, z2 + nz);
  }
}
const posMesh = (pos, color) => {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
};
const flatPoly = (pts, y, color) => {   // shape y = -z because of the rotateX below
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)))).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })); m.position.y = y; return m;
};
function buildFlats() {
  flatGroup.clear(); const road = [], runway = [], water = [];
  flats.forEach((f) => {
    if (f.type === 'road') ribbon(f.pts, f.w, 0.15, road);
    else if (f.type === 'runway') ribbon(f.pts, f.w, 0.18, runway);
    else if (f.type === 'water') { if (f.closed) flatGroup.add(flatPoly(f.pts.slice(0, -1), 0.1, 0x6fb1e8)); else ribbon(f.pts, 4, 0.1, water); }
    else flatGroup.add(flatPoly(f.pts, f.type === 'parking' ? 0.12 : 0.05, f.type === 'parking' ? 0xc8c8cc : 0x9fd48a));
  });
  [[road, 0x777777], [runway, 0x3a3a3f], [water, 0x6fb1e8]].forEach(([p, c]) => p.length && flatGroup.add(posMesh(p, c)));
}

// ---- real-looking models for tree / bench / seating area / cafe (built from simple 3D parts) ----
const CUSTOM = new Set(['tree', 'bench', 'seat', 'cafe']);
const part = (geo, color, x, y, z, hgt) => { const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color })); m.position.set(x, y + hgt / 2, z); return m; };
const cube = (w, h, d, color, x, y, z) => part(new THREE.BoxGeometry(w, h, d), color, x, y, z, h);
const cyl = (rt, rb, h, color, x, y, z) => part(new THREE.CylinderGeometry(rt, rb, h, 14), color, x, y, z, h);   // rt = 0 makes a cone
function makeModel(o) {
  const g = new THREE.Group(), n = o.poly.length, p = o.poly;
  const cx = p.reduce((t, q) => t + q[0], 0) / n, cz = p.reduce((t, q) => t + q[1], 0) / n;
  const w = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), d = Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]);
  if (o.kind === 'tree') {                                   // trunk + two cone layers; height setting scales the whole tree
    const lite = new THREE.Color(o.color).offsetHSL(0, 0, 0.07);
    g.add(cyl(0.22, 0.3, 1.8, '#6b4423', 0, 0, 0), cyl(0, 1.5, 2.4, o.color, 0, 1.4, 0), cyl(0, 1.1, 2.0, lite, 0, 2.9, 0));
    g.scale.setScalar(o.h / 5);
  } else if (o.kind === 'bench') {                          // wooden seat + backrest + two legs (colour = wood colour)
    const leg = '#4a3220';
    g.add(cube(w, 0.07, d, o.color, 0, 0.4, 0), cube(w, 0.4, 0.06, o.color, 0, 0.5, -d / 2 + 0.03),
      cube(0.07, 0.4, d * 0.9, leg, -(w / 2 - 0.15), 0, 0), cube(0.07, 0.4, d * 0.9, leg, w / 2 - 0.15, 0, 0));
    g.scale.y = o.h / 0.9;
  } else if (o.kind === 'seat') {                           // two round tables with parasols and four chairs each (colour = chairs)
    [-1.3, 1.3].forEach((tx) => {
      g.add(cyl(0.5, 0.5, 0.06, '#e8c9a0', tx, 0.72, 0), cyl(0.05, 0.05, 2.2, '#888', tx, 0, 0), cyl(0, 1.2, 0.5, '#e74c3c', tx, 2.0, 0));
      [[0.85, 0, 0.2, 0, 0.05, 0.4], [-0.85, 0, -0.2, 0, 0.05, 0.4], [0, 0.85, 0, 0.2, 0.4, 0.05], [0, -0.85, 0, -0.2, 0.4, 0.05]].forEach(([dx, dz, bx, bz, bw, bd]) => {
        g.add(cube(0.4, 0.05, 0.4, o.color, tx + dx, 0.42, dz), cube(bw, 0.4, bd, o.color, tx + dx + bx, 0.47, dz + bz), cyl(0.05, 0.05, 0.4, '#444', tx + dx, 0, dz));
      });
    });
    g.scale.set(w / 5, o.h / 2.5, d / 3);
  } else {                                                  // cafe: body, overhanging roof, red awning, windows and door on the front
    g.add(cube(w, o.h, d, o.color, 0, 0, 0), cube(w + 0.8, 0.3, d + 0.8, '#6d4c41', 0, o.h, 0), cube(w * 0.6, 0.15, 1.2, '#c0392b', 0, o.h * 0.6, d / 2 + 0.6),
      cube(w * 0.18, o.h * 0.3, 0.1, '#9fd3f2', -w * 0.3, o.h * 0.35, d / 2 + 0.05), cube(w * 0.18, o.h * 0.3, 0.1, '#9fd3f2', w * 0.3, o.h * 0.35, d / 2 + 0.05),
      cube(w * 0.14, o.h * 0.55, 0.1, '#5d4037', 0, 0, d / 2 + 0.05));
  }
  g.position.set(cx, 0, cz);
  if (o.kind !== 'tree') g.rotation.y = -Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]);   // follows rotation of the footprint
  if (o.flagged) g.traverse((c) => { if (c.material) c.material.color.set('#e53e3e'); });
  g.userData.id = o.id; return g;
}

// each building = its own extruded mesh with its own outline
function makeMesh(o) {
  if (CUSTOM.has(o.kind)) return makeModel(o);
  const shape = new THREE.Shape(o.poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: o.h, bevelEnabled: false }).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: o.flagged ? '#e53e3e' : o.color }));
  if (objects.length < 1500 || o.id === selectedId) mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: o.id === selectedId ? 0xffd400 : 0x222222 })));
  mesh.userData.id = o.id; return mesh;
}
let siteR = 200;
const labelMats = new Map(), meshCache = new Map();
let selHelper = null;
function label(text, x, y, z) {
  const k = Math.max(1, siteR / 400);
  let mat = labelMats.get(text);                                   // one texture per distinct name
  if (!mat) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 48; const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(0, 0, 256, 48); g.fillStyle = '#111'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.fillText(text.slice(0, 22), 128, 32);
    mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }); labelMats.set(text, mat);
  }
  const sp = new THREE.Sprite(mat); sp.scale.set(32 * k, 6 * k, 1); sp.position.set(x, y + 4 * k, z); return sp;
}
const disposeObj = (m) => m.traverse((c) => { if (c.geometry) c.geometry.dispose(); [].concat(c.material || []).forEach((x) => { if (!x.userData.shared) x.dispose(); }); });
const sigOf = (o) => [o.kind, o.h, o.color, o.flagged ? 1 : 0, o.id === selectedId ? 1 : 0, o.poly.length, o.poly[0][0], o.poly[0][1], o.poly[1][0], o.poly[2][1]].join('|');
function rebuild() {   // only objects whose look changed get a new mesh; the rest are reused
  group.clear(); labelGroup.clear(); let nl = 0;
  if (selHelper) { selHelper.geometry.dispose(); selHelper.material.dispose(); selHelper = null; }
  const alive = new Set();
  (showBefore ? original : objects).forEach((o) => {
    alive.add(o.id);
    const sig = sigOf(o); let c = meshCache.get(o.id);
    if (!c || c.sig !== sig) { if (c) disposeObj(c.mesh); c = { sig, mesh: makeMesh(o) }; meshCache.set(o.id, c); }
    group.add(c.mesh);
    if (CUSTOM.has(o.kind) && o.id === selectedId) { selHelper = new THREE.Box3Helper(new THREE.Box3().setFromObject(c.mesh), 0xffd400); selHelper.raycast = () => {}; group.add(selHelper); }
    if (o.name && $('names').checked && nl++ < 200) { const n = o.poly.length; labelGroup.add(label(o.name, o.poly.reduce((t, p) => t + p[0], 0) / n, o.h, o.poly.reduce((t, p) => t + p[1], 0) / n)); }
  });
  meshCache.forEach((c, id) => { if (!alive.has(id)) { disposeObj(c.mesh); meshCache.delete(id); } });
  dirty = true;
  const s = objects.find((o) => o.id === selectedId);
  $('sel').textContent = s ? `#${s.id} ${s.kind} ${s.name}` : 'Nothing selected';
  $('src').textContent = s ? `Height ${s.h.toFixed(1)} m: ${SRC_TEXT[s.src]}` : '';
  if (s) { $('hgt').value = s.h; $('col').value = s.color; $('hex').value = s.color; const [L, W] = dims(s); $('len').value = +L.toFixed(1); $('wid').value = +W.toFixed(1); $('len').disabled = $('wid').disabled = s.kind === 'tree'; }
}

// ================= loading =================
function frame(r) { siteR = r; dirty = true; controls.target.set(0, 0, 0); camera.position.set(0, r * 0.9, r * 1.1); }
function show(list, r) {
  objects = list; original = JSON.parse(JSON.stringify(list)); selectedId = null; showBefore = false;
  $('picker').classList.add('off'); $('studio').classList.remove('off'); resize(); buildFlats(); recheck(); frame(r);
}
$('back').onclick = () => { $('studio').classList.add('off'); $('picker').classList.remove('off'); map.invalidateSize(); };
let loading = false, cancelled = false, ctl = null;
$('go').onclick = async () => {
  if (loading) { cancelled = true; if (ctl) ctl.abort(); return; }   // second click = cancel
  const s = box.getSouth(), w = box.getWest(), n = box.getNorth(), e = box.getEast();
  center = { lat: (s + n) / 2, lon: (w + e) / 2 };
  const wm = (e - w) * 111320 * Math.cos(center.lat * Math.PI / 180), hm = (n - s) * 110540;
  if (Math.max(wm, hm) > 10000) { $('pmsg').textContent = 'Area too big (over ~10 km across). Draw a smaller shape.'; return; }
  try {
    loading = true; cancelled = false; ctl = new AbortController(); $('go').textContent = 'Cancel download';
    let list; try { list = parse(await loadTiles({ s, w, n, e })); } finally { loading = false; $('go').textContent = 'Generate 3D site'; }
    $('status').textContent = `${list.length} buildings, ${flats.length} roads/green/water features.` + (list.length ? '' : '\nNo buildings in the data here: use "Trace footprint".');
    show(list, Math.max(wm, hm) / 2); $('pmsg').textContent = '';
  } catch (err) { $('pmsg').textContent = cancelled ? 'Cancelled.' : 'Download failed: ' + err.message + '. Check your connection and retry.'; }
};

// ================= data: Overture Maps vector tiles (PMTiles files on a CDN, read with HTTP range requests) =================
// No API key, no query server, no rate limit: the browser fetches only the few tiles that cover the drawn area.
// Newest release first; the first one whose files exist is used. (Overture publishes a new release monthly: add the new one at the top.)
const RELEASES = ['2026-10-21.0', '2026-09-23.0', '2026-08-19.0', '2026-07-22.0'];
const TILE_BASE = 'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/';
const THEMES = ['buildings', 'transportation', 'base'];
const archives = new Map();   // theme -> PMTiles, for the release that worked
async function openArchives() {
  if (archives.size === THEMES.length) return;
  let lastErr;
  for (const rel of RELEASES) {
    try {
      const got = new Map();
      for (const t of THEMES) { const p = new PMTiles(`${TILE_BASE}${rel}/${t}.pmtiles`); await p.getHeader(); got.set(t, p); }
      got.forEach((p, t) => archives.set(t, p)); return;
    } catch (e) { lastErr = e; }
  }
  throw new Error('Overture tile files not reachable (' + (lastErr && lastErr.message) + ')');
}
const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
const tileLon = (x, z) => x / 2 ** z * 360 - 180;
const tileLat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI;
// all features (as GeoJSON lon/lat) from the tiles covering a box; each piece is kept only by the tile whose core contains its centre, so tile-edge duplicates vanish
async function loadTiles(bb) {
  $('pmsg').textContent = 'Connecting to Overture Maps tiles...'; await openArchives();
  const out = [], jobs = [];
  for (const theme of THEMES) {
    const arc = archives.get(theme), hd = await arc.getHeader(), z = Math.min(14, hd.maxZoom);
    const x0 = lon2x(bb.w, z), x1 = lon2x(bb.e, z), y0 = lat2y(bb.n, z), y1 = lat2y(bb.s, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push({ theme, arc, z, x, y });
  }
  let done = 0, failed = 0;
  const pool = async () => {
    while (jobs.length) {
      if (cancelled) throw new Error('cancelled');
      const j = jobs.pop();
      try {
        const r = await j.arc.getZxy(j.z, j.x, j.y, ctl.signal); if (!r) continue;       // no tile = nothing mapped there
        const vt = new VectorTile(new Pbf(new Uint8Array(r.data)));
        const w0 = tileLon(j.x, j.z), w1 = tileLon(j.x + 1, j.z), n0 = tileLat(j.y, j.z), n1 = tileLat(j.y + 1, j.z);
        for (const name of Object.keys(vt.layers)) {
          const layer = vt.layers[name];
          for (let i = 0; i < layer.length; i++) {
            const f = layer.feature(i), gj = f.toGeoJSON(j.x, j.y, j.z), c = centreOf(gj.geometry);
            if (!c || c[0] < w0 || c[0] >= w1 || c[1] > n0 || c[1] <= n1) continue;
            out.push({ layer: name, theme: j.theme, props: f.properties, geom: gj.geometry });
          }
        }
      } catch (err) { if (cancelled) throw new Error('cancelled'); failed++; }
      $('pmsg').textContent = `Downloading Overture tiles ${++done} of ${done + jobs.length}...`;
    }
  };
  const total = jobs.length; await Promise.all([pool(), pool(), pool(), pool(), pool(), pool()]);
  if (failed && failed === total) throw new Error('all tile requests failed');
  return out;
}
const ringsOf = (g) => g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((p) => p[0]) : [];   // outer rings only
const linesOf = (g) => g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
function centreOf(g) {   // middle of the geometry's bounding box
  const pts = ringsOf(g).flat().concat(linesOf(g).flat(), g.type === 'Point' ? [g.coordinates] : []); if (!pts.length) return null;
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9; pts.forEach(([x, y]) => { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); });
  return [(a + c) / 2, (b + d) / 2];
}
// point-in-polygon: keep only buildings whose centre is inside the drawn area
const inArea = (lat, lon) => { let c = false; for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) { const a = verts[i], b = verts[j]; if ((a.lng > lon) !== (b.lng > lon) && lat < (b.lat - a.lat) * (lon - a.lng) / (b.lng - a.lng) + a.lat) c = !c; } return c; };
const nameOf = (t) => { if (t['@name']) return t['@name']; if (t.name) return t.name; try { const n = typeof t.names === 'string' ? JSON.parse(t.names) : t.names; return (n && n.primary) || ''; } catch (e) { return ''; } };
const ROAD_W = { motorway: 12, trunk: 11, primary: 9, secondary: 8, tertiary: 6, residential: 5, living_street: 4, unclassified: 5, service: 3.5, track: 3, pedestrian: 3, footway: 2, steps: 1.5, path: 1.5, cycleway: 2, bridleway: 2 };
function parse(feats) {   // Overture features -> buildings (out) and flat layers (flats)
  const out = []; flats = [];
  const inBox = (pts) => { const [lo, la] = pts[Math.floor(pts.length / 2)]; return lo >= box.getWest() - 0.002 && lo <= box.getEast() + 0.002 && la >= box.getSouth() - 0.002 && la <= box.getNorth() + 0.002; };
  const P = (ring) => ring.map(([lo, la]) => project(la, lo));
  for (const f of feats) {
    const t = f.props, g = f.geom, lay = f.layer, cls = String(t.class || ''), sub = String(t.subtype || '');
    if (lay === 'building' || lay === 'buildings') {
      ringsOf(g).forEach((r) => {
        if (r.length < 4) return; const n = r.length - 1;
        if (!inArea(r.reduce((s, p) => s + p[1], 0) / r.length, r.reduce((s, p) => s + p[0], 0) / r.length)) return;
        const [h, src] = heightOf(t); out.push({ id: nextId++, kind: 'map', poly: P(r).slice(0, n), h, src, color: COLORS.map, name: nameOf(t) });
      });
    } else if (lay === 'segment') {
      if (sub && sub !== 'road') continue;                                   // skip rail and water routes
      linesOf(g).forEach((l) => { if (l.length > 1 && inBox(l)) flats.push({ type: 'road', pts: P(l), w: ROAD_W[cls] || 4 }); });
    } else if (lay === 'water') {
      ringsOf(g).forEach((r) => inBox(r) && flats.push({ type: 'water', pts: P(r), closed: true }));
      linesOf(g).forEach((l) => inBox(l) && flats.push({ type: 'water', pts: P(l), closed: false }));
    } else if (lay === 'infrastructure') {
      if (/runway|taxiway|apron|helipad/.test(cls + ' ' + sub)) {
        ringsOf(g).forEach((r) => inBox(r) && flats.push({ type: 'parking', pts: P(r).slice(0, -1) }));
        linesOf(g).forEach((l) => inBox(l) && flats.push({ type: 'runway', pts: P(l), w: /taxiway/.test(cls) ? 18 : 45 }));
      } else if (/parking/.test(cls + ' ' + sub)) ringsOf(g).forEach((r) => inBox(r) && flats.push({ type: 'parking', pts: P(r).slice(0, -1) }));
    } else if (lay === 'land_use') {
      if (/parking/.test(cls + ' ' + sub)) ringsOf(g).forEach((r) => inBox(r) && flats.push({ type: 'parking', pts: P(r).slice(0, -1) }));
      else if (/park|garden|pitch|playground|grass|recreation|golf|forest|wood|meadow/.test(cls + ' ' + sub)) ringsOf(g).forEach((r) => inBox(r) && flats.push({ type: 'green', pts: P(r).slice(0, -1) }));
    } else if (lay === 'land_cover') {
      if (/forest|grass|shrub|mangrove|wood/.test(sub + ' ' + cls)) ringsOf(g).forEach((r) => inBox(r) && flats.push({ type: 'green', pts: P(r).slice(0, -1) }));
    }
  }
  return out;
}
// ================= place search: no OpenStreetMap. Typed coordinates, Wikipedia (campuses, airports, landmarks) and GeoNames via Open-Meteo (cities, towns) =================
async function search() {
  const q = $('q').value.trim(); if (!q) return;
  const res = $('results'); res.textContent = 'Searching...';
  const go = (lat, lon, label) => { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { map.setView([lat, lon], 17); res.innerHTML = ''; }; res.appendChild(b); };
  const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/);   // "28.75, 77.49" jumps straight there
  if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) { map.setView([+m[1], +m[2]], 17); res.innerHTML = ''; return; }
  const found = [];
  const wiki = fetch('https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=8&prop=coordinates&colimit=8&gsrsearch=' + encodeURIComponent(q))
    .then((r) => r.json()).then((j) => Object.values((j.query && j.query.pages) || {}).filter((p) => p.coordinates).sort((a, b) => a.index - b.index)
      .forEach((p) => found.push([p.coordinates[0].lat, p.coordinates[0].lon, p.title + ' (Wikipedia)']))).catch(() => {});
  const geo = fetch('https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=' + encodeURIComponent(q))
    .then((r) => r.json()).then((j) => (j.results || []).forEach((p) => found.push([p.latitude, p.longitude, [p.name, p.admin1, p.country].filter(Boolean).join(', ')]))).catch(() => {});
  await Promise.all([wiki, geo]); res.innerHTML = '';
  if (!found.length) { res.textContent = 'No places found. You can also type coordinates like 28.75, 77.49.'; return; }
  found.slice(0, 10).forEach(([la, lo, label]) => go(la, lo, label));
}
$('find').onclick = search; $('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });

$('demo').onclick = () => {
  flats = [{ type: 'road', pts: [[-80, 0], [80, 0]], w: 6 }, { type: 'green', pts: [[-60, 30], [-10, 30], [-10, 70], [-60, 70]] }];
  const b = (x, z, w, d, h, name) => ({ id: nextId++, kind: 'map', h, src: h === 9 ? 'estimate' : 'tag', color: COLORS.map, name, poly: [[x, z], [x + w, z], [x + w, z + d], [x, z + d]] });
  show([b(-40, -40, 30, 25, 12, 'Block A'), b(10, -45, 25, 30, 20, 'Library'), b(20, 20, 35, 15, 9, 'Hostel')], 120);
  $('status').textContent = 'Sample site (offline).';
};

// ================= overlap & clearance (bounding boxes, expanded by clearance) =================
const bbox = (p, m = 0) => { const xs = p.map((q) => q[0]), zs = p.map((q) => q[1]); return [Math.min(...xs) - m, Math.min(...zs) - m, Math.max(...xs) + m, Math.max(...zs) + m]; };
const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
function recheck() {
  const c = +$('clr').value, lines = []; objects.forEach((o) => { o.flagged = false; });
  objects.filter((o) => o.kind !== 'map').forEach((a) => objects.forEach((b) => {
    if (a === b || (a.kind === 'tree' || a.kind === 'bench') && (b.kind === 'tree' || b.kind === 'bench')) return;
    if (hit(bbox(a.poly), bbox(b.poly))) { a.flagged = true; lines.push(`OVERLAP: #${a.id} ${a.kind} with #${b.id} ${b.kind}`); }
    else if (hit(bbox(a.poly, c), bbox(b.poly))) { a.flagged = true; lines.push(`TOO CLOSE (<${c} m): #${a.id} ${a.kind} to #${b.id} ${b.kind}`); }
  }));
  $('report').textContent = `Added objects: ${objects.filter((o) => o.kind !== 'map').length}\n` + (lines.length ? lines.join('\n') : 'No overlaps or clearance problems.');
  rebuild();
}

// ================= pointer: select / trace / place =================
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let down = null;
canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4 || e.button !== 0) return;
  const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
  if (tool === 'orbit') { const h = ray.intersectObjects(group.children, true)[0]; let o = h && h.object; while (o && o.userData.id === undefined) o = o.parent; selectedId = o ? o.userData.id : null; rebuild(); return; }
  if (showBefore) { $('status').textContent = 'Switch back to "after" view to edit.'; return; }
  const p = new THREE.Vector3(); if (!ray.ray.intersectPlane(plane, p)) return;
  if (tool === 'trace') { dirty = true; tracePts.push([p.x, p.z]); traceLine.geometry.setFromPoints(tracePts.map(([x, z]) => new THREE.Vector3(x, 0.4, z))); return; }
  let poly;
  if (tool === 'tree') poly = Array.from({ length: 8 }, (_, i) => [p.x + 1.5 * Math.cos(i * Math.PI / 4), p.z + 1.5 * Math.sin(i * Math.PI / 4)]);
  else { const [w, d] = { cafe: [10, 8], seat: [5, 3], building: [14, 12], bench: [2, 0.7] }[tool]; poly = [[p.x - w / 2, p.z - d / 2], [p.x + w / 2, p.z - d / 2], [p.x + w / 2, p.z + d / 2], [p.x - w / 2, p.z + d / 2]]; }
  const h = { cafe: 4, seat: 2.5, building: 9, bench: 0.9, tree: 5 }[tool];
  const id = nextId++; objects.push({ id, kind: tool, poly, h, src: 'you', color: COLORS[tool], name: '' }); selectedId = id; setTool('orbit'); recheck();
});
// drag-to-move: press on the SELECTED object and drag it along the ground (registered in the capture phase so it runs before the orbit controls)
let drag = null;
function groundPoint(e) {
  const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
  const p = new THREE.Vector3(); return ray.ray.intersectPlane(plane, p) ? p : null;
}
addEventListener('pointerdown', (e) => {
  if (e.target !== canvas || tool !== 'orbit' || showBefore || e.button !== 0 || selectedId === null) return;
  const p = groundPoint(e); if (!p) return;
  const h = ray.intersectObjects(group.children, true)[0]; let o = h && h.object; while (o && o.userData.id === undefined) o = o.parent;
  if (!o || o.userData.id !== selectedId) return;       // only the selected object can be dragged
  drag = { start: p, mesh: o, base: o.position.clone(), dx: 0, dz: 0 }; controls.enabled = false;
}, true);
addEventListener('pointermove', (e) => {
  if (!drag) return; const p = groundPoint(e); if (!p) return;
  dirty = true; drag.dx = p.x - drag.start.x; drag.dz = p.z - drag.start.z;
  drag.mesh.position.set(drag.base.x + drag.dx, drag.base.y, drag.base.z + drag.dz);   // move the mesh live; the real footprint is updated on release
});
addEventListener('pointerup', () => {
  if (!drag) return; const d = drag, s = sel(); drag = null; controls.enabled = true; d.mesh.position.copy(d.base);
  if (s && Math.hypot(d.dx, d.dz) > 0.05) { s.poly = s.poly.map(([x, z]) => [x + d.dx, z + d.dz]); recheck(); }
});
canvas.addEventListener('dblclick', () => { const s = objects.find((o) => o.id === selectedId); if (s) zoomTo(s); });
function zoomTo(o) {
  dirty = true;
  const b = bbox(o.poly), cx = (b[0] + b[2]) / 2, cz = (b[1] + b[3]) / 2, s = Math.max(b[2] - b[0], b[3] - b[1], 15);
  controls.target.set(cx, o.h / 2, cz); camera.position.set(cx + s * 1.4, s * 1.1 + o.h, cz + s * 1.4);
}

// ================= UI wiring =================
function setTool(t) { tool = t; document.body.dataset.tool = t; document.querySelectorAll('.tool').forEach((x) => x.classList.toggle('on', x.dataset.tool === t)); }
document.querySelectorAll('.tool').forEach((b) => b.onclick = () => setTool(b.dataset.tool));
$('finish').onclick = () => {
  if (tracePts.length < 3) { $('status').textContent = 'Click at least 3 ground points first.'; return; }
  const id = nextId++; objects.push({ id, kind: 'traced', poly: tracePts, h: 9, src: 'you', color: COLORS.traced, name: '' });
  tracePts = []; traceLine.geometry.setFromPoints([]); selectedId = id; setTool('orbit'); recheck();
};
const sel = () => objects.find((o) => o.id === selectedId);
$('hgt').onchange = () => { const s = sel(); if (s) { s.h = Math.max(0.3, +$('hgt').value); s.src = 'you'; recheck(); } };
const setColor = (v) => { const s = sel(); if (s && /^#[0-9a-f]{6}$/i.test(v)) { s.color = v; rebuild(); } };
$('col').oninput = () => setColor($('col').value); $('hex').onchange = () => setColor($('hex').value.trim());
$('del').onclick = () => { objects = objects.filter((o) => o.id !== selectedId); selectedId = null; recheck(); };
$('zoom').onclick = () => { const s = sel(); if (s) zoomTo(s); };
function rotate(deg) {   // spin the selected object around its own centre (works on map buildings too)
  const s = sel(); if (!s) return;
  const a = deg * Math.PI / 180, c = Math.cos(a), n = Math.sin(a), m = s.poly.length;
  const cx = s.poly.reduce((t, p) => t + p[0], 0) / m, cz = s.poly.reduce((t, p) => t + p[1], 0) / m;
  s.poly = s.poly.map(([x, z]) => [cx + (x - cx) * c - (z - cz) * n, cz + (x - cx) * n + (z - cz) * c]); recheck();
}
// ---- length / width: scale the footprint along the object's own axes (the first edge defines "length") ----
function frameOf(o) {
  const p = o.poly, n = p.length, a = Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]);
  return { cx: p.reduce((t, q) => t + q[0], 0) / n, cz: p.reduce((t, q) => t + q[1], 0) / n, c: Math.cos(a), sn: Math.sin(a) };
}
function dims(o) {   // current length and width in metres
  const f = frameOf(o); let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  o.poly.forEach(([x, z]) => { const dx = x - f.cx, dz = z - f.cz, u = dx * f.c + dz * f.sn, v = -dx * f.sn + dz * f.c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); });
  return [u1 - u0, v1 - v0];
}
function resizeSelected(newL, newW) {   // pass 0 for the side that should stay as it is
  const s = sel(); if (!s) return; const [L, W] = dims(s), f = frameOf(s);
  const ku = newL && L > 0.01 ? newL / L : 1, kv = newW && W > 0.01 ? newW / W : 1;
  s.poly = s.poly.map(([x, z]) => {
    const dx = x - f.cx, dz = z - f.cz, u = (dx * f.c + dz * f.sn) * ku, v = (-dx * f.sn + dz * f.c) * kv;
    return [f.cx + u * f.c - v * f.sn, f.cz + u * f.sn + v * f.c];
  });
  recheck();
}
$('len').onchange = () => { const v = +$('len').value; if (v >= 0.5) resizeSelected(v, 0); };
$('wid').onchange = () => { const v = +$('wid').value; if (v >= 0.5) resizeSelected(0, v); };
const stepDeg = () => +$('step').value || 15;
$('rl').onclick = () => rotate(-stepDeg()); $('rr').onclick = () => rotate(stepDeg());
addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT') return; if (e.key === 'q') rotate(-stepDeg()); if (e.key === 'e') rotate(stepDeg()); if (e.key === 'Escape') setTool('orbit'); });
$('clr').onchange = recheck; $('names').onchange = rebuild;
$('cmp').onclick = () => { showBefore = !showBefore; $('status').textContent = showBefore ? 'Showing BEFORE (original map data).' : 'Showing AFTER (your changes).'; rebuild(); };
$('glb').onclick = () => {
  const root = new THREE.Group(); root.add(flatGroup.clone(), group.clone());
  new GLTFExporter().parse(root, (buf) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' })); a.download = 'site.glb'; a.click(); },
    () => { $('status').textContent = 'GLB export failed.'; }, { binary: true });
};
(function loop() {
  requestAnimationFrame(loop); controls.update();
  if (!dirty) return; dirty = false;
  camera.near = Math.max(0.5, camera.position.distanceTo(controls.target) * 0.01); camera.updateProjectionMatrix();   // keeps flat layers from flickering at any zoom
  renderer.render(scene, camera);
})();
