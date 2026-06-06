import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_ROOT = new URL("../../3dmap/data/", import.meta.url);
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

const sourceManifest = JSON.parse(await readFile(SOURCE_MANIFEST, "utf8"));
const center = {
  lat: (sourceManifest.bbox.south + sourceManifest.bbox.north) / 2,
  lon: (sourceManifest.bbox.west + sourceManifest.bbox.east) / 2,
};
const origin = lonLatToMercator(center.lon, center.lat);

await mkdir(OUT_PATCH_DIR, { recursive: true });

const manifest = {
  version: 1,
  projection: "local-web-mercator",
  worldScale: WORLD_SCALE,
  center,
  bbox: sourceManifest.bbox,
  rows: sourceManifest.rows,
  cols: sourceManifest.cols,
  patches: [],
};

for (const patch of sourceManifest.patches) {
  const sourcePath = new URL(path.basename(patch.url), new URL("osm-patches/", SOURCE_ROOT));
  const xml = await readFile(sourcePath, "utf8");
  const data = parsePatch(xml);
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
        buildings.push({
          h: parseHeight(tags),
          p: flattenPoints(signedArea(contour) < 0 ? contour.reverse() : contour),
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

function parseHeight(tags) {
  const explicit = Number.parseFloat(String(tags.height ?? "").replace(",", "."));
  if (Number.isFinite(explicit)) return clamp(round(explicit, 1), 2.5, 160);

  const levels = Number.parseFloat(tags["building:levels"]);
  if (Number.isFinite(levels)) return clamp(round(levels * 3.1, 1), 3, 160);

  return 11;
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
