import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const SOURCE_ROOT = new URL("../data/", import.meta.url);
const SOURCE_MANIFEST = new URL("stockholm-patches.json", SOURCE_ROOT);
const OUT_ROOT = new URL("../public/map/", import.meta.url);
const OUT_PATCH_DIR = new URL("patches/", OUT_ROOT);

const WORLD_SCALE = 0.25;
const MAX_BUILDING_POINTS = 28;
const ROAD_TYPES = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "residential",
  "living_street",
  "service",
  "pedestrian",
  "footway",
  "cycleway",
  "path",
]);

const ELEVATION_TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const ELEVATION_ZOOM = 13;
const ELEVATION_GRID = 17;
const ELEVATION_MIN = -8;
const ELEVATION_MAX = 120;
const ELEVATION_SMOOTH_PASSES = 2;

const tileImageCache = new Map();

const sourceManifest = JSON.parse(await readFile(SOURCE_MANIFEST, "utf8"));
const center = {
  lat: (sourceManifest.bbox.south + sourceManifest.bbox.north) / 2,
  lon: (sourceManifest.bbox.west + sourceManifest.bbox.east) / 2,
};
const origin = lonLatToMercator(center.lon, center.lat);

await mkdir(OUT_PATCH_DIR, { recursive: true });

const manifest = {
  version: 3,
  projection: "local-web-mercator",
  worldScale: WORLD_SCALE,
  center,
  bbox: sourceManifest.bbox,
  rows: sourceManifest.rows,
  cols: sourceManifest.cols,
  patches: [],
  elevation: { zoom: ELEVATION_ZOOM, grid: ELEVATION_GRID, source: "terrarium" },
};

for (const patch of sourceManifest.patches) {
  const sourcePath = new URL(path.basename(patch.url), new URL("osm-patches/", SOURCE_ROOT));
  const xml = await readFile(sourcePath, "utf8");
  const data = parsePatch(xml);
  data.elevation = await samplePatchElevation(patch);
  const url = `patches/${patch.id}.json`;
  const outPath = new URL(url, OUT_ROOT);

  await writeFile(outPath, `${JSON.stringify(data)}\n`);

  manifest.patches.push({
    id: patch.id,
    row: patch.row,
    col: patch.col,
    south: patch.south,
    west: patch.west,
    north: patch.north,
    east: patch.east,
    center: project((patch.west + patch.east) / 2, (patch.south + patch.north) / 2),
    url,
    buildings: data.buildings.length,
    roads: data.roads.length,
  });

  console.log(
    `${patch.id}: ${data.buildings.length} buildings, ${data.roads.length} roads, ${formatBytes(JSON.stringify(data).length)}`,
  );
}

await writeFile(new URL("manifest.json", OUT_ROOT), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${manifest.patches.length} patches to ${fileURLToPath(OUT_ROOT)}`);

function parsePatch(xml) {
  const nodes = new Map();
  const buildings = [];
  const roads = [];

  for (const match of xml.matchAll(/<node\b([^>]*)\/?>/g)) {
    const attrs = parseAttrs(match[1]);
    if (!attrs.id || !attrs.lat || !attrs.lon) continue;
    nodes.set(attrs.id, {
      lat: Number(attrs.lat),
      lon: Number(attrs.lon),
    });
  }

  for (const match of xml.matchAll(/<way\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    const body = match[2];
    const tags = {};
    for (const tagMatch of body.matchAll(/<tag\b([^>]*)\/>/g)) {
      const attrs = parseAttrs(tagMatch[1]);
      if (attrs.k) tags[attrs.k] = attrs.v ?? "";
    }

    const isBuilding = Boolean(tags.building);
    const highway = tags.highway;
    if (!isBuilding && !ROAD_TYPES.has(highway)) continue;

    const points = [];
    for (const ndMatch of body.matchAll(/<nd\b[^>]*\bref="([^"]+)"[^>]*\/>/g)) {
      const node = nodes.get(ndMatch[1]);
      if (!node) continue;
      points.push(project(node.lon, node.lat));
    }

    if (isBuilding && points.length >= 4 && isClosed(points)) {
      const contour = simplifyClosed(points.slice(0, -1), MAX_BUILDING_POINTS);
      if (contour.length >= 3) {
        const oriented = signedArea(contour) < 0 ? contour.reverse() : contour;
        const center = polygonCenter(oriented);
        const seed = hashPoint(center);
        buildings.push({
          h: parseHeight(tags, seed),
          t: classifyBuilding(tags),
          s: seedShade(seed),
          p: flattenPoints(oriented),
        });
      }
    } else if (highway && points.length >= 2) {
      roads.push({
        k: highway,
        p: flattenPoints(simplifyOpen(points, 1.4)),
      });
    }
  }

  return { buildings, roads };
}

function parseAttrs(source) {
  const attrs = {};
  for (const match of source.matchAll(/\s([:\w-]+)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function decodeXml(value) {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function parseHeight(tags, seed = 0) {
  const explicit = Number.parseFloat(String(tags.height ?? "").replace(",", "."));
  if (Number.isFinite(explicit)) return clamp(round(explicit, 1), 2.5, 160);

  const levels = Number.parseFloat(tags["building:levels"]);
  if (Number.isFinite(levels)) return clamp(round(levels * 3.1, 1), 3, 160);

  // Default height: 11m ± small variation per building for visual diversity
  const jitter = ((seed >>> 8) & 0xff) / 255; // 0-1
  return clamp(round(9 + jitter * 5, 1), 6, 22);
}

function classifyBuilding(tags) {
  // Returns a coarse building type used for color tinting in the renderer.
  // Types: r (residential), c (commercial), i (industrial), u (public/landmark), d (default)
  const b = tags.building;
  if (b === "apartments" || b === "residential" || b === "house" || b === "detached" || b === "terrace" || b === "dormitory" || b === "bungalow") return "r";
  if (b === "office" || b === "commercial" || b === "retail" || b === "supermarket" || b === "warehouse" || b === "kiosk") return "c";
  if (b === "industrial" || b === "factory" || b === "manufacture" || b === "workshop" || b === "shed") return "i";
  if (b === "cathedral" || b === "church" || b === "mosque" || b === "synagogue" || b === "temple" || b === "school" || b === "university" || b === "hospital" || b === "civic" || b === "public" || b === "museum" || b === "stadium" || b === "train_station" || b === "transportation") return "u";
  return "d";
}

function hashPoint(point) {
  // Deterministic 32-bit hash from centroid coords (well-distributed)
  const x = Math.round(point.x * 100) | 0;
  const z = Math.round(point.z * 100) | 0;
  let h = (x * 2654435761) ^ (z * 1597334677);
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h = h ^ (h >>> 16);
  return h >>> 0;
}

function seedShade(seed) {
  // 0-255 per-building shade variation (8-bit), used by renderer for color jitter
  return seed & 0xff;
}

function polygonCenter(points) {
  let x = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    z += p.z;
  }
  return { x: x / points.length, z: z / points.length };
}

function flattenPoints(points) {
  return points.flatMap((point) => [round(point.x, 2), round(point.z, 2)]);
}

function project(lon, lat) {
  const p = lonLatToMercator(lon, lat);
  return {
    x: (p.x - origin.x) * WORLD_SCALE,
    z: -(p.y - origin.y) * WORLD_SCALE,
  };
}

function lonLatToMercator(lon, lat) {
  const radius = 6378137;
  const lambda = degToRad(lon);
  const phi = degToRad(lat);
  return {
    x: radius * lambda,
    y: radius * Math.log(Math.tan(Math.PI / 4 + phi / 2)),
  };
}

function degToRad(value) {
  return (value * Math.PI) / 180;
}

function isClosed(points) {
  const first = points[0];
  const last = points.at(-1);
  return Math.hypot(first.x - last.x, first.z - last.z) < 0.01;
}

function signedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.z - b.x * a.z;
  }
  return area / 2;
}

function simplifyClosed(points, maxPoints) {
  let simplified = simplifyOpen(points, 0.8);
  while (simplified.length > maxPoints) {
    simplified = simplifyOpen(simplified, 1.8);
    if (simplified.length > maxPoints) simplified = decimate(simplified, maxPoints);
  }
  return simplified;
}

function simplifyOpen(points, tolerance) {
  if (points.length <= 2) return points;
  const result = [points[0]];
  let previous = points[0];

  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i];
    if (Math.hypot(point.x - previous.x, point.z - previous.z) >= tolerance) {
      result.push(point);
      previous = point;
    }
  }

  result.push(points.at(-1));
  return result;
}

function decimate(points, maxPoints) {
  const stride = points.length / maxPoints;
  const result = [];
  for (let i = 0; i < maxPoints; i += 1) {
    result.push(points[Math.floor(i * stride)]);
  }
  return result;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, precision) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function loadTerrariumTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (tileImageCache.has(key)) return tileImageCache.get(key);

  const url = `${ELEVATION_TILE_URL}/${z}/${x}/${y}.png`;
  const promise = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Terrarium tile ${key} ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    return new Promise((resolve, reject) => {
      new PNG().parse(buffer, (error, png) => {
        if (error) reject(error);
        else resolve({ width: png.width, height: png.height, data: png.data });
      });
    });
  })();
  tileImageCache.set(key, promise);
  return promise;
}

function sampleTerrariumElevation(lat, lon) {
  const tile = lonLatToTile(lon, lat, ELEVATION_ZOOM);
  const tileX = Math.floor(tile.x);
  const tileY = Math.floor(tile.y);
  const key = `${ELEVATION_ZOOM}/${tileX}/${tileY}`;
  const promise = tileImageCache.get(key);
  if (!promise) {
    throw new Error(`Missing elevation tile ${key}; call loadTerrariumTile first`);
  }
  return promise.then((png) => {
    const px = Math.min(255, Math.max(0, Math.floor((tile.x - tileX) * 256)));
    const py = Math.min(255, Math.max(0, Math.floor((tile.y - tileY) * 256)));
    const index = (py * png.width + px) * 4;
    const r = png.data[index];
    const g = png.data[index + 1];
    const b = png.data[index + 2];
    return r * 256 + g + b / 256 - 32768;
  });
}

function lonLatToTile(lon, lat, zoom) {
  const latRad = degToRad(lat);
  const tiles = 2 ** zoom;
  return {
    x: ((lon + 180) / 360) * tiles,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * tiles,
  };
}

function gatherTileKeys(patch) {
  const corners = [
    lonLatToTile(patch.west, patch.south, ELEVATION_ZOOM),
    lonLatToTile(patch.east, patch.south, ELEVATION_ZOOM),
    lonLatToTile(patch.west, patch.north, ELEVATION_ZOOM),
    lonLatToTile(patch.east, patch.north, ELEVATION_ZOOM),
  ];
  const minX = Math.floor(Math.min(...corners.map((c) => c.x)));
  const maxX = Math.floor(Math.max(...corners.map((c) => c.x)));
  const minY = Math.floor(Math.min(...corners.map((c) => c.y)));
  const maxY = Math.floor(Math.max(...corners.map((c) => c.y)));
  const keys = [];
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      keys.push(`${ELEVATION_ZOOM}/${x}/${y}`);
    }
  }
  return keys;
}

async function samplePatchElevation(patch) {
  const keys = gatherTileKeys(patch);
  await Promise.all(keys.map((key) => loadTerrariumTile(...key.split("/").map(Number))));

  const samples = [];
  for (let row = 0; row < ELEVATION_GRID; row += 1) {
    const lat = lerp(patch.south, patch.north, row / (ELEVATION_GRID - 1));
    for (let col = 0; col < ELEVATION_GRID; col += 1) {
      const lon = lerp(patch.west, patch.east, col / (ELEVATION_GRID - 1));
      const raw = await sampleTerrariumElevation(lat, lon);
      samples.push(round(clamp(sanitize(raw), ELEVATION_MIN, ELEVATION_MAX), 2));
    }
  }

  const smoothed = smoothElevationGrid(samples, ELEVATION_GRID);
  return { n: ELEVATION_GRID, values: smoothed };
}

function smoothElevationGrid(values, n) {
  let current = values;
  for (let pass = 0; pass < ELEVATION_SMOOTH_PASSES; pass += 1) {
    const next = current.slice();
    for (let row = 0; row < n; row += 1) {
      for (let col = 0; col < n; col += 1) {
        let total = 0;
        let count = 0;
        for (let dr = -1; dr <= 1; dr += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            const r = row + dr;
            const c = col + dc;
            if (r < 0 || r >= n || c < 0 || c >= n) continue;
            total += current[r * n + c];
            count += 1;
          }
        }
        next[row * n + col] = round(total / count, 2);
      }
    }
    current = next;
  }
  return current;
}

function sanitize(value) {
  if (!Number.isFinite(value)) return 0;
  return value;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
