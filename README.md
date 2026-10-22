# Site Studio
### Turn any area on a map into an editable 3D digital twin, in your browser

Draw a shape on a map. Site Studio downloads free, open map data for that shape and builds the buildings, roads, parking, green areas, water and airport runways in 3D. You can then change buildings, add new structures, check for overlaps and export the result as a 3D model.

- **Hackathon:** InnoTech26, KIET
- **Category:** Smart Solutions, Smarter Society
- **Theme:** AR/VR, Digital Twins & Industry 4.0
- **Team:** [add team name and member names]

---

## Contents
1. [The problem and the idea](#1-the-problem-and-the-idea)
2. [What it can do](#2-what-it-can-do)
3. [How to run it](#3-how-to-run-it)
4. [How to use it](#4-how-to-use-it)
5. [The flow, step by step](#5-the-flow-step-by-step)
6. [Tech stack: what each tool does](#6-tech-stack-what-each-tool-does)
7. [Where the data comes from](#7-where-the-data-comes-from)
8. [Key concepts explained simply](#8-key-concepts-explained-simply)
9. [Project structure](#9-project-structure)
10. [Limitations (be upfront)](#10-limitations-be-upfront)
11. [Future work](#11-future-work)
12. [Licences and attribution](#12-licences-and-attribution)
13. [Panel Q&A cheat sheet](#13-panel-qa-cheat-sheet)
14. [3-minute demo script](#14-3-minute-demo-script)

---

## 1. The problem and the idea

Planning changes to a campus, market or public space is harder than it should be:

- **3D planning tools are expensive** and need trained users. Most colleges and small organisations cannot access them.
- **Online maps only show what exists.** You cannot edit them to ask "what if we add a cafe here?"
- **Open map data is incomplete.** Building heights are often missing, and some buildings are not in the data at all.
- **Conflicts are found late.** Overlaps and crowding between new and existing structures are usually discovered after work begins.

**Our idea:** a free tool where anyone can pick a place, see it in 3D within a minute, change it, and test the change before anything is built.

A **digital twin** is a virtual copy of a real place that you can change and test safely. Site Studio is a lightweight digital twin of a site.

## 2. What it can do

| Feature | What it does |
|---|---|
| Place search | Finds places by name (Wikipedia and GeoNames) or by typed coordinates like `28.75, 77.49` |
| Map styles | Switch between Streets (road names, boundaries), Satellite + labels, Satellite only, and Topo |
| Freeform area selection | Left-click each corner, right-click to close; up to about 10 km across |
| Automatic 3D site | Buildings, roads and paths, parking, green areas, water, airport runways and taxiways |
| Building names | Names from the data float above buildings (first 200 shown) |
| Honest height handling | Uses the data's `height`, else `num_floors` x 3.2 m, else a 9 m estimate; the panel says which one was used |
| Manual tracing | Click corners on the ground to create a building the map is missing |
| Editable objects | Select any object to change height, length, width and colour, rotate it, drag it or delete it |
| Placeable objects | Building, cafe, seating area, bench, tree, each with a 3D model |
| Overlap and clearance checks | Added objects turn red if they overlap or sit closer than the set clearance (1.5 m default) |
| Before / after | One button switches between the original data and your proposal |
| Zoom to object | Fly the camera to the selected structure |
| GLB export | Download the 3D scene for use in Blender, Windows 3D Viewer, game engines and more |
| Sample site | "Try sample" builds a small demo without internet |

## 3. How to run it

You need **Node.js 18 or newer** (check with `node -v`).

```
npm install
npm run dev        # open the localhost address it prints (usually http://localhost:5173)
```

To make a static build you can host anywhere:

```
npm run build      # creates the dist/ folder
```

Upload `dist/` to any static host. Easiest: drag the `dist` folder onto `app.netlify.com/drop`, or push to GitHub and import it on Vercel (it detects Vite automatically).

An internet connection is needed for the map, search and data download. Only **Try sample** works offline.

## 4. How to use it

**Map screen**
1. Search for a place, or pan the map to it. Pick a style from the switcher at the bottom-left (Streets is the easiest for finding places).
2. Press **Draw area**. Left-click each corner, then right-click to close the shape.
3. Press **Generate 3D site**. Press it again while loading to cancel.

**3D screen**

| Action | How |
|---|---|
| Rotate / pan / zoom | Left-drag / right-drag / scroll |
| Select an object | Click it with the **Select** tool (it gets a yellow outline) |
| Move an object | Select it, then drag it along the ground |
| Rotate an object | Q / E keys, or the rotate buttons (step size is adjustable) |
| Place an object | Pick a tool, then click the ground; the tool returns to Select afterwards |
| Trace a missing building | **Trace** tool: click corners, then **Finish traced shape** |
| Zoom to object | **Zoom to** button, or double-click a selected object |
| Esc | Back to the Select tool |

## 5. The flow, step by step

```
 1. MAP SCREEN        Leaflet map with Esri tiles. Search jumps the map.
        |             User draws a freeform polygon (the "area").
        v
 2. DOWNLOAD          Work out which map tiles cover the area's bounding box.
        |             Fetch only those tiles from Overture's PMTiles files
        |             on a CDN (HTTP range requests, 6 downloads at a time).
        v
 3. DECODE            Each tile is a compressed vector tile (Mapbox Vector Tile
        |             format). Decode it into GeoJSON: points, lines, polygons
        |             with latitude/longitude and properties (height, names...).
        v
 4. PARSE + CONVERT   Keep buildings whose centre is inside the drawn shape.
        |             Convert lat/lon to local metres around the area's centre.
        |             Decide each building's height (data -> floors -> estimate).
        |             Turn roads, water, parking, green, runways into flat shapes.
        v
 5. BUILD 3D          Three.js: extrude each building footprint upward by its
        |             height. Roads become flat ribbons merged into one mesh.
        v
 6. EDIT              Select, move, rotate, resize, recolour, place new objects,
        |             trace missing buildings.
        v
 7. CHECK             Bounding boxes (grown by the clearance) are compared.
        |             Overlapping or too-close objects turn red, with a report.
        v
 8. COMPARE + EXPORT  Before/after toggle. Export the scene as a .glb file.
```

**In plain words:** we ask a free map-data library only for the small piece of the world you drew, turn flat outlines into 3D boxes, and then let you play with them.

### What happens when you press "Generate 3D site"
1. The app checks the area is not bigger than about 10 km.
2. `openArchives()` connects to Overture's files. It tries the newest release first and falls back to older ones if a file is missing.
3. `loadTiles()` lists every tile covering the area at zoom 14, for three themes (buildings, transportation, base), then downloads them with 6 workers in parallel.
4. Each tile is decoded with `@mapbox/vector-tile` and `pbf` into GeoJSON features. A feature is kept only by the tile that contains its centre, so objects cut by a tile edge are not doubled.
5. `parse()` sorts features by type: `building`, `segment` (roads), `water`, `infrastructure` (runways, parking), `land_use` and `land_cover` (parks, forest).
6. `show()` switches to the 3D screen, builds the flat layers (`buildFlats()`), runs the overlap check and frames the camera.

## 6. Tech stack: what each tool does

| Tool | Role in this project | Why we chose it |
|---|---|---|
| **JavaScript (ES modules)** | All application logic, in the browser | One language, no backend to run |
| **Vite 5** | Development server and production bundler. It turns our files and npm packages into a fast static website | Instant reload, simple config |
| **Leaflet 1.9** | The 2D map on the first screen: panning, zooming, drawing the area polygon, map style switcher | Small, simple and reliable |
| **Esri map tiles** | The picture shown inside Leaflet: Streets, Satellite imagery, place and boundary labels, road names, Topo | Free labelled street map and imagery with no API key |
| **Wikipedia API + Open-Meteo geocoding (GeoNames)** | Place search. Wikipedia finds campuses, airports and landmarks. GeoNames finds cities and towns | Free, no key, not OpenStreetMap |
| **Overture Maps (PMTiles)** | The real data: building footprints, heights, names, roads, water, parking, parks, runways | Free, open, worldwide and merges several sources |
| **PMTiles (`pmtiles` library)** | Reads one huge map file on a CDN by asking for only the byte ranges we need. This is why no server or API key is needed | Cheap and fast |
| **Mapbox Vector Tile + Pbf (`@mapbox/vector-tile`, `pbf`)** | Decode the compressed tiles into features with coordinates and properties | Standard tile format |
| **Three.js r160** | The 3D engine on the second screen: scene, camera, lights, extruded buildings, raycasting for clicks, models for trees and cafes | Runs in any browser, large community |
| **OrbitControls** (Three.js add-on) | Rotate, pan and zoom the camera with the mouse | Ready-made and smooth |
| **GLTFExporter** (Three.js add-on) | Exports the scene as a `.glb` 3D file | Opens in most 3D software |
| **HTML + CSS** | Layout and the dark interface | No framework needed |

There is **no backend, database or API key**. Everything runs in the browser, so the finished site is just static files.

## 7. Where the data comes from

- **Overture Maps Foundation** publishes the building, road, land and water data as static tile files. It combines several sources:
  - Buildings: Google Open Buildings, Microsoft ML Buildings, Esri Community Maps and OpenStreetMap contributors.
  - Roads: OpenStreetMap contributors and TomTom.
- **Esri** provides the base map pictures (street map, satellite, labels, topo).
- **Wikipedia and GeoNames** provide place search.

**Be honest with the panel on this point:** the app never contacts openstreetmap.org, Overpass or Nominatim. But Overture's own data does include OpenStreetMap-derived records, because Overture is a merge of several open sources. The app does not depend on OSM's servers or query limits.

## 8. Key concepts explained simply

**Vector tiles.** A map cut into small squares. Instead of pictures, each tile holds shapes (outlines of buildings, lines for roads) as data. We download only the squares we need.

**Zoom level and tile numbers.** Zoom 0 is the whole world as one tile. Each zoom level doubles the number of tiles in each direction. We use zoom 14 (each tile is roughly 2 km wide at Indian latitudes), a good balance between detail and download size.

**PMTiles and range requests.** All tiles for the world live in one big file. A small index at the start says where each tile is. The browser asks the server for just those bytes. No server code is needed, only a file host.

**Extrusion.** Taking a flat 2D outline and pushing it upward to make a 3D block. Footprint + height = building.

**Local metres.** Latitude and longitude are angles, not distances. We convert every point to metres from the area's centre (`project()` in `main.js`). Then moving, rotating and measuring become simple geometry.

**Height rules (and honesty).** Many buildings in open data have no height. We use, in order:
1. the `height` value in the data,
2. `num_floors` x 3.2 m,
3. a 9 m guess, clearly labelled **ESTIMATE** in the side panel.

We never present a guess as a fact. The user can set the real height, which is then labelled "set by you".

**Raycasting.** To know what you clicked in 3D, the app shoots an invisible line from the camera through the mouse position and finds the first object it hits.

**Overlap and clearance check.** Each object gets a rectangle around it (bounding box). Two overlapping rectangles means OVERLAP. If they overlap only after growing one by the clearance (1.5 m by default), it is TOO CLOSE. Flagged objects turn red.

**Performance tricks.** We render only when something changed, reuse meshes that did not change, merge all road pieces into one mesh, and free memory for deleted objects.

**GLB.** A single-file 3D format ("binary glTF"), often called the JPEG of 3D.

## 9. Project structure

```
site-studio/
  index.html        page layout (map screen and 3D screen)
  src/main.js       all application logic
  src/style.css     interface styling
  vite.config.js    build settings (relative paths so it works from any folder)
  package.json      dependencies and scripts
```

Inside `src/main.js`, in order:

| Section | What it does |
|---|---|
| Step 1: map picker | Leaflet map, Esri layers and the style switcher, polygon drawing |
| Data model | The shape of an object, colours, `project()` (lat/lon to metres), `heightOf()` |
| Three.js scene | Renderer, camera, lights, ground, road ribbons, flat areas |
| Models | Trees, benches, seating areas and cafes built from simple 3D parts |
| `makeMesh` / `rebuild` | Builds each object's 3D shape, labels, selection outline and reuses unchanged meshes |
| Loading | Press "Generate" flow, cancel, switch screens |
| Data | Overture release list, tile maths, downloading, decoding |
| `parse()` | Turns raw features into buildings and flat layers |
| Place search | Wikipedia + GeoNames + typed coordinates |
| Overlap and clearance | `bbox`, `hit`, `recheck` |
| Pointer handling | Select, trace, place, drag to move |
| UI wiring | Buttons, rotate, resize, colour, delete, before/after, GLB export |
| Render loop | Draws a frame only when something changed |

## 10. Limitations (be upfront)

- Heights without tags are **estimates**, not surveyed values. Many Indian campus buildings have none.
- Buildings that no source has mapped will be missing. Use the **Trace** tool to add them.
- Overlap checks use **bounding boxes**, so L-shaped buildings can be flagged when only their corners come close.
- Length and width scale the whole footprint evenly. Individual corners cannot be reshaped yet. Trees resize by height only.
- Buildings with courtyards (holes) are drawn solid: only the outer outline is used.
- Visuals are flat-coloured, not photo-realistic. Satellite imagery is used only on the picker map, not inside the 3D scene.
- Very large areas download many tiles (about 100 requests for a 10 km square). Thousands of buildings can be heavy on low-end laptops.
- The Overture tile files are published for data inspection, not as a guaranteed service. The app tries the four releases in `RELEASES` (top of the data section in `src/main.js`). Add the newest release name there each month.
- Esri's free public tiles are meant for light use. A production version should use a licensed plan or its own tile hosting.

## 11. Future work

- Exact polygon-based overlap checks.
- Reshape individual corners of a footprint.
- Complex buildings with courtyards, and interiors.
- Save and share projects by link, with comments.
- Analysis: sunlight and shadows, walking distances, seating capacity.
- Self-hosted tile extract for reliability.
- Optional AI suggestions for placement, layered on top of the core tool.

## 12. Licences and attribution

- Building, road, park and water data: Overture Maps Foundation (https://docs.overturemaps.org/attribution/). Check each theme's licence before commercial use.
- Map imagery and street map: © Esri, HERE, Garmin and their providers. Check Esri's terms before heavy or commercial use.
- Place search: Wikipedia and GeoNames (via Open-Meteo).
- Libraries: Three.js, Leaflet, Vite, pmtiles, @mapbox/vector-tile and pbf (open-source licences).
- The project was built step by step with Claude (an AI assistant from Anthropic) as a coding assistant. The product itself uses **no AI at runtime**; it is deterministic geometry built from open data.

---

## 13. Panel Q&A cheat sheet

**Where does the data come from?**
Overture Maps, a free open dataset that merges Google, Microsoft, Esri and OpenStreetMap-contributor building footprints, plus OSM and TomTom roads. The base map is Esri. We credit all of them.

**Why not just use Google Maps?**
Google's 3D data is not free or editable and needs a paid API key. We wanted a free tool with editable objects.

**Why did you stop using Overpass / OSM servers?**
Overpass is a live query server with rate limits and timeouts. Overture is a set of static files on a CDN: no key, no rate limit and no server to fail under load.

**Is it accurate?**
Footprints are as accurate as the source data. Heights come from the data when present and are clearly marked as estimates otherwise. Missing buildings can be traced by hand.

**How do you get 3D from a flat map?**
Each building is a polygon outline. We extrude it upward by its height with Three.js.

**How do you know a building's height?**
We use the data's height, else floors x 3.2 m, else a 9 m estimate. The panel always says which one was used, and the user can override it.

**What is a digital twin?**
A virtual copy of a real place that can be changed and tested before the real world changes.

**What is a vector tile and why use it?**
A small map square holding shapes as data, not pictures. It lets us download only the area the user drew.

**What are PMTiles?**
A single-file format for a whole tileset. The browser reads only the byte ranges it needs, so there is no map server.

**Where is the backend?**
There is none. Everything runs in the browser and the built site is static files, so hosting is free.

**How does the overlap check work?**
Bounding boxes, grown by the clearance distance, are compared for every added object. It is fast and simple but conservative (see limitations).

**How big an area can it handle?**
About 10 km across. Beyond about 3 km it is slower, and thousands of buildings can slow a weak laptop.

**What if there is no data for a place?**
Use the Trace tool to draw footprints manually. The Sample button works offline.

**Is there AI in it?**
Not at runtime. We used an AI coding assistant to build it. AI placement suggestions are a planned extension.

**How is it different from existing tools?**
Every building is individually editable. You can add new structures, run overlap checks, compare before and after, trace missing buildings, and export a 3D model, all free, in a browser.

**Can it scale?**
The architecture is static, so serving many users is cheap. The free tile bucket is not a guaranteed service, so a production version would host its own tile extract.

**Who is it for?**
Colleges, students, local authorities, community groups, and small businesses or architects checking a concept quickly.

**Does it use OpenStreetMap?**
Our app never calls OSM's servers or Overpass. Overture's merged data includes OSM-contributor records, which we credit.

## 14. 3-minute demo script

1. **Hook (20 s).** "Want to add a cafe to your campus? Today you need expensive 3D software or you guess. We built Site Studio to do it in minutes, for free."
2. **Select (30 s).** Search a place, switch to Streets so boundaries are visible, draw a freeform shape, press Generate.
3. **Explore (30 s).** Orbit the 3D site. Point out buildings, names, roads, parking, green areas.
4. **Edit (45 s).** Select a building, change its height and colour, rotate and drag it. Mention heights are labelled "from data" or "estimate".
5. **Plan (45 s).** Place a cafe, seating and trees. Drop one too close to a building so it turns red and the report explains why.
6. **Compare and export (20 s).** Toggle before/after, then export the GLB.
7. **Close (10 s).** "Free, open data, works in any browser, ready to use today."

Keep **Try sample** ready as a fallback if the internet is slow.
