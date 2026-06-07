import { writeFile } from "node:fs/promises";

const SCB_API = "https://api.scb.se/OV0104/v1/doris/sv/ssd";
const WFS = "https://geodata.scb.se/geoserver/stat/wfs";
const OUT_FILE = new URL("../src/demandData.ts", import.meta.url);

const mapBbox = {
  south: 59.22,
  west: 17.85,
  north: 59.43,
  east: 18.20,
};

const displayAreas = [
  { id: "inner-city", name: "Inner city",
    bounds: { south: 59.315, west: 18.028, north: 59.355, east: 18.105 },
    polygon: [[18.028,59.318],[18.030,59.320],[18.033,59.326],[18.038,59.334],[18.042,59.340],[18.048,59.345],[18.055,59.349],[18.065,59.352],[18.075,59.354],[18.085,59.354],[18.095,59.352],[18.103,59.349],[18.105,59.345],[18.105,59.335],[18.103,59.325],[18.095,59.320],[18.085,59.318],[18.075,59.317],[18.065,59.317],[18.055,59.317],[18.045,59.317],[18.035,59.317]],
    jobWeight: 234000 },
  { id: "sodermalm", name: "Sodermalm",
    bounds: { south: 59.295, west: 18.005, north: 59.330, east: 18.110 },
    polygon: [[18.005,59.300],[18.010,59.305],[18.020,59.312],[18.030,59.318],[18.040,59.322],[18.055,59.326],[18.070,59.328],[18.085,59.329],[18.100,59.328],[18.110,59.325],[18.110,59.315],[18.105,59.308],[18.095,59.303],[18.080,59.300],[18.060,59.298],[18.040,59.297],[18.020,59.298]],
    jobWeight: 60000 },
  { id: "kungsholmen", name: "Kungsholmen",
    bounds: { south: 59.318, west: 17.995, north: 59.348, east: 18.060 },
    polygon: [[17.995,59.325],[18.005,59.328],[18.015,59.332],[18.025,59.338],[18.035,59.343],[18.045,59.346],[18.055,59.347],[18.060,59.345],[18.060,59.335],[18.058,59.325],[18.055,59.320],[18.045,59.319],[18.030,59.319],[18.015,59.320],[18.000,59.322]],
    jobWeight: 54000 },
  { id: "vasastan", name: "Vasastan",
    bounds: { south: 59.330, west: 18.020, north: 59.365, east: 18.080 },
    polygon: [[18.025,59.355],[18.035,59.360],[18.045,59.363],[18.055,59.364],[18.065,59.363],[18.075,59.360],[18.080,59.355],[18.078,59.345],[18.075,59.338],[18.068,59.333],[18.058,59.331],[18.048,59.331],[18.038,59.333],[18.028,59.338],[18.025,59.345]],
    jobWeight: 78000 },
  { id: "ostermalm-gardet", name: "Ostermalm and Gardet",
    bounds: { south: 59.330, west: 18.065, north: 59.370, east: 18.145 },
    polygon: [[18.080,59.355],[18.090,59.360],[18.100,59.363],[18.110,59.365],[18.120,59.365],[18.130,59.363],[18.140,59.360],[18.145,59.355],[18.143,59.345],[18.138,59.338],[18.130,59.334],[18.120,59.331],[18.110,59.330],[18.100,59.331],[18.090,59.334],[18.082,59.340],[18.078,59.348]],
    jobWeight: 91000 },
  { id: "solna-sundbyberg", name: "Solna and Sundbyberg",
    bounds: { south: 59.340, west: 17.940, north: 59.390, east: 18.040 },
    polygon: [[17.940,59.360],[17.950,59.365],[17.960,59.372],[17.970,59.378],[17.980,59.383],[17.990,59.387],[18.000,59.389],[18.010,59.390],[18.020,59.389],[18.030,59.386],[18.040,59.380],[18.040,59.370],[18.035,59.360],[18.025,59.352],[18.015,59.347],[18.005,59.343],[17.995,59.342],[17.980,59.343],[17.965,59.346],[17.950,59.352]],
    jobWeight: 133000 },
  { id: "hagersten-liljeholmen", name: "Hagersten and Liljeholmen",
    bounds: { south: 59.280, west: 17.950, north: 59.325, east: 18.040 },
    polygon: [[17.950,59.310],[17.960,59.315],[17.970,59.320],[17.980,59.323],[17.990,59.325],[18.000,59.324],[18.010,59.322],[18.020,59.318],[18.030,59.313],[18.040,59.305],[18.040,59.295],[18.035,59.288],[18.025,59.283],[18.015,59.280],[18.000,59.280],[17.985,59.282],[17.970,59.286],[17.960,59.293],[17.955,59.302]],
    jobWeight: 40000 },
  { id: "soderort-west", name: "Western Soderort",
    bounds: { south: 59.255, west: 17.940, north: 59.310, east: 17.990 },
    polygon: [[17.940,59.280],[17.950,59.290],[17.960,59.298],[17.970,59.304],[17.980,59.308],[17.990,59.310],[17.990,59.298],[17.985,59.288],[17.975,59.278],[17.965,59.268],[17.955,59.260],[17.945,59.258],[17.940,59.268]],
    jobWeight: 32000 },
  { id: "soderort-east", name: "Eastern Soderort",
    bounds: { south: 59.255, west: 18.030, north: 59.310, east: 18.155 },
    polygon: [[18.030,59.310],[18.040,59.312],[18.055,59.313],[18.070,59.312],[18.085,59.310],[18.100,59.306],[18.115,59.300],[18.130,59.293],[18.145,59.285],[18.155,59.275],[18.155,59.265],[18.145,59.260],[18.130,59.258],[18.115,59.258],[18.100,59.260],[18.085,59.265],[18.070,59.272],[18.055,59.280],[18.040,59.290],[18.030,59.300]],
    jobWeight: 34000 },
  { id: "kista-jarva", name: "Kista and Jarva",
    bounds: { south: 59.375, west: 17.910, north: 59.420, east: 17.980 },
    polygon: [[17.910,59.395],[17.920,59.400],[17.930,59.408],[17.940,59.413],[17.950,59.417],[17.960,59.419],[17.970,59.418],[17.980,59.415],[17.980,59.400],[17.975,59.390],[17.965,59.383],[17.950,59.378],[17.935,59.376],[17.920,59.378],[17.910,59.385]],
    jobWeight: 57000 },
  { id: "bromma-vasterort", name: "Bromma and Vasterort",
    bounds: { south: 59.325, west: 17.940, north: 59.380, east: 17.980 },
    polygon: [[17.940,59.355],[17.950,59.362],[17.960,59.368],[17.970,59.373],[17.980,59.376],[17.980,59.365],[17.975,59.355],[17.965,59.345],[17.955,59.338],[17.945,59.332],[17.940,59.340]],
    jobWeight: 34000 },
  { id: "lidingo", name: "Lidingo",
    bounds: { south: 59.345, west: 18.100, north: 59.420, east: 18.200 },
    polygon: [[18.100,59.380],[18.115,59.390],[18.130,59.398],[18.145,59.405],[18.160,59.410],[18.175,59.412],[18.190,59.410],[18.200,59.405],[18.200,59.390],[18.195,59.378],[18.185,59.368],[18.170,59.360],[18.155,59.355],[18.140,59.352],[18.125,59.353],[18.110,59.360],[18.102,59.370]],
    jobWeight: 18000 },
  { id: "nacka", name: "Nacka",
    bounds: { south: 59.260, west: 18.080, north: 59.350, east: 18.200 },
    polygon: [[18.080,59.320],[18.095,59.328],[18.110,59.335],[18.130,59.342],[18.150,59.347],[18.170,59.349],[18.190,59.348],[18.200,59.343],[18.200,59.325],[18.195,59.308],[18.185,59.293],[18.170,59.280],[18.155,59.270],[18.140,59.265],[18.125,59.263],[18.110,59.265],[18.095,59.275],[18.085,59.290],[18.080,59.305]],
    jobWeight: 38000 },
  { id: "farsta-skarpnack", name: "Farsta and Skarpnack",
    bounds: { south: 59.255, west: 18.040, north: 59.300, east: 18.150 },
    polygon: [[18.040,59.280],[18.055,59.288],[18.070,59.293],[18.085,59.297],[18.100,59.299],[18.120,59.299],[18.140,59.296],[18.150,59.290],[18.150,59.275],[18.140,59.268],[18.125,59.263],[18.110,59.260],[18.095,59.258],[18.080,59.258],[18.065,59.260],[18.050,59.265],[18.042,59.273]],
    jobWeight: 22000 },
  { id: "akalla-tensta", name: "Akalla and Tensta",
    bounds: { south: 59.380, west: 17.900, north: 59.420, east: 17.955 },
    polygon: [[17.900,59.395],[17.910,59.402],[17.920,59.408],[17.930,59.413],[17.940,59.416],[17.950,59.417],[17.955,59.412],[17.955,59.400],[17.950,59.390],[17.940,59.383],[17.930,59.378],[17.920,59.376],[17.910,59.380],[17.905,59.388]],
    jobWeight: 14000 },
  { id: "bromma-south", name: "Southern Bromma",
    bounds: { south: 59.300, west: 17.920, north: 59.340, east: 17.980 },
    polygon: [[17.920,59.315],[17.930,59.322],[17.940,59.328],[17.950,59.333],[17.960,59.337],[17.970,59.339],[17.980,59.338],[17.980,59.328],[17.975,59.318],[17.965,59.310],[17.955,59.304],[17.945,59.300],[17.935,59.300],[17.925,59.306]],
    jobWeight: 26000 },
];

const stockholmCityAreaIds = new Set([
  "inner-city",
  "sodermalm",
  "kungsholmen",
  "vasastan",
  "ostermalm-gardet",
  "hagersten-liljeholmen",
  "soderort-west",
  "soderort-east",
  "kista-jarva",
  "bromma-vasterort",
  "farsta-skarpnack",
  "akalla-tensta",
  "bromma-south",
]);

const areaMunicipality = {
  "solna-sundbyberg": ["0183", "0184"],
  "lidingo": ["0186"],
  "nacka": ["0182"],
};

const stockholmCityCode = "0180";

const features = await fetchDesoFeatures();
const desoCodes = features
  .map((feature) => feature.properties?.desokod)
  .filter((code) => typeof code === "string" && code.startsWith("01"))
  .map((code) => `${code}_DeSO2025`);

const [population, employedResidents, municipalJobs] = await Promise.all([
  fetchPopulation(desoCodes),
  fetchEmployedResidents(desoCodes),
  fetchMunicipalJobs([...new Set(features.map((feature) => feature.properties?.kommunkod).filter(Boolean))]),
]);

const areas = displayAreas.map((area) => ({
  ...area,
  residents: 0,
  employedResidents: 0,
  jobs: 0,
}));

for (const feature of features) {
  const code = feature.properties?.desokod;
  if (!code) continue;
  const area = bestAreaForFeature(feature, areas);
  if (!area) continue;

  area.residents += population.get(`${code}_DeSO2025`) || population.get(code) || 0;
  area.employedResidents += employedResidents.get(`${code}_DeSO2025`) || employedResidents.get(code) || 0;
}

for (const area of areas) {
  const municipalityCodes = areaMunicipality[area.id] || (stockholmCityAreaIds.has(area.id) ? [stockholmCityCode] : []);
  const totalAreaWeight = areas
    .filter((candidate) => overlapsMunicipality(candidate.id, municipalityCodes))
    .reduce((sum, candidate) => sum + candidate.jobWeight, 0);
  const totalMunicipalJobs = municipalityCodes.reduce((sum, code) => sum + (municipalJobs.get(code) || 0), 0);
  area.jobs = totalAreaWeight ? Math.round(totalMunicipalJobs * (area.jobWeight / totalAreaWeight)) : 0;
}

const generatedAreas = areas.map(({ jobWeight, ...area }) => ({
  ...area,
  residents: Math.round(area.residents),
  employedResidents: Math.round(area.employedResidents),
  jobs: Math.round(area.jobs),
}));

await writeFile(
  OUT_FILE,
  `import type { AggregateDemandArea } from "./types";\n\n` +
    `// Generated by scripts/fetch-demand-data.mjs from SCB open data.\n` +
    `// residents: SCB population by DeSO 2025, 2025.\n` +
    `// employedResidents: SCB BAS employed residents by DeSO 2025, 2024.\n` +
    `// jobs: SCB RAMS workplace employment by municipality, 2021, distributed to display areas by job-center weights.\n` +
    `export const aggregateDemandAreas: AggregateDemandArea[] = ${JSON.stringify(generatedAreas, null, 2)};\n`,
);

console.log(`Wrote ${generatedAreas.length} aggregate demand areas to ${OUT_FILE.pathname}`);

async function fetchDesoFeatures() {
  const url = new URL(WFS);
  url.search = new URLSearchParams({
    service: "WFS",
    version: "1.1.0",
    request: "GetFeature",
    typeName: "stat:DeSO_2025",
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    bbox: `${mapBbox.west},${mapBbox.south},${mapBbox.east},${mapBbox.north},EPSG:4326`,
  }).toString();
  const data = await fetchJson(url);
  return data.features || [];
}

async function fetchPopulation(regionCodes) {
  const data = await scbPost(`${SCB_API}/START/BE/BE0101/BE0101Y/FolkmDesoAldKon`, [
    selection("Region", regionCodes),
    selection("Alder", ["totalt"]),
    selection("Kon", ["1+2"]),
    selection("ContentsCode", ["000007Y7"]),
    selection("Tid", ["2025"]),
  ]);
  return valuesByRegion(data);
}

async function fetchEmployedResidents(regionCodes) {
  const data = await scbPost(`${SCB_API}/START/AM/AM0210/AM0210G/ArRegDesoStatusN`, [
    selection("Region", regionCodes),
    selection("Kon", ["1+2"]),
    selection("Alder", ["15-74"]),
    selection("ContentsCode", ["0000089X"]),
    selection("Tid", ["2024"]),
  ]);
  return valuesByRegion(data);
}

async function fetchMunicipalJobs(municipalityCodes) {
  const data = await scbPost(`${SCB_API}/START/AM/AM0207/AM0207Z/DagSni07KonKN`, [
    selection("Region", municipalityCodes),
    all("SNI2007"),
    all("Kon"),
    selection("ContentsCode", ["00000544"]),
    selection("Tid", ["2021"]),
  ]);
  return valuesByRegionSum(data);
}

async function scbPost(url, query) {
  return fetchJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, response: { format: "JSON-stat2" } }),
  });
}

function selection(code, values) {
  return {
    code,
    selection: {
      filter: "item",
      values,
    },
  };
}

function all(code) {
  return {
    code,
    selection: {
      filter: "all",
      values: ["*"],
    },
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

function valuesByRegion(data) {
  const regionIndex = data.id.findIndex((code) => code === "Region");
  const values = new Map();
  forEachJsonStatRow(data, (key, value) => {
    values.set(key[regionIndex], Number(value || 0));
  });
  return values;
}

function valuesByRegionSum(data) {
  const regionIndex = data.id.findIndex((code) => code === "Region");
  const values = new Map();
  forEachJsonStatRow(data, (key, value) => {
    const region = key[regionIndex];
    values.set(region, (values.get(region) || 0) + Number(value || 0));
  });
  return values;
}

function forEachJsonStatRow(data, callback) {
  const sizes = data.size || [];
  const ids = data.id || [];
  const categoryValues = ids.map((id) => {
    const index = data.dimension[id].category.index;
    return Object.entries(index)
      .sort((a, b) => a[1] - b[1])
      .map(([code]) => code);
  });
  const total = (data.value || []).length;

  for (let flatIndex = 0; flatIndex < total; flatIndex += 1) {
    let remainder = flatIndex;
    const key = new Array(sizes.length);
    for (let dimensionIndex = sizes.length - 1; dimensionIndex >= 0; dimensionIndex -= 1) {
      const size = sizes[dimensionIndex];
      const valueIndex = remainder % size;
      remainder = Math.floor(remainder / size);
      key[dimensionIndex] = categoryValues[dimensionIndex][valueIndex];
    }
    callback(key, data.value[flatIndex]);
  }
}

function bestAreaForFeature(feature, areas) {
  const ring = feature.geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const centroid = ringCentroid(ring);
  const candidates = areas.filter((a) => a.bounds && contains(a.bounds, centroid));
  if (candidates.length === 0) {
    return areas
      .map((a) => ({ area: a, d: centroidDistance(a, centroid) }))
      .sort((x, y) => x.d - y.d)[0]?.area || null;
  }
  const withPoly = candidates
    .map((a) => ({ area: a, inside: a.polygon ? pointInPolygon(centroid, a.polygon) : true }))
    .filter((c) => c.inside);
  if (withPoly.length > 0) {
    return withPoly.sort((x, y) => boundsArea(y.area.bounds) - boundsArea(x.area.bounds))[0].area;
  }
  return candidates.sort((a, b) => boundsArea(a.bounds) - boundsArea(b.bounds))[0];
}

function ringCentroid(ring) {
  let area2 = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const f = xi * yj - xj * yi;
    area2 += f;
    cx += (xi + xj) * f;
    cy += (yi + yj) * f;
  }
  if (area2 === 0) {
    let sx = 0, sy = 0;
    for (const [x, y] of ring) { sx += x; sy += y; }
    return { lon: sx / ring.length, lat: sy / ring.length };
  }
  return { lon: cx / (3 * area2), lat: cy / (3 * area2) };
}

function pointInPolygon(point, polygon) {
  let inside = false;
  const x = point.lon, y = point.lat;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function contains(bounds, point) {
  return point.lat >= bounds.south &&
    point.lat <= bounds.north &&
    point.lon >= bounds.west &&
    point.lon <= bounds.east;
}

function centroidDistance(area, point) {
  const cx = (area.bounds.west + area.bounds.east) / 2;
  const cy = (area.bounds.south + area.bounds.north) / 2;
  return (cx - point.lon) ** 2 + (cy - point.lat) ** 2;
}

function boundsArea(bounds) {
  return Math.max(0, bounds.north - bounds.south) * Math.max(0, bounds.east - bounds.west);
}

function overlapsMunicipality(areaId, municipalityCodes) {
  const areaCodes = areaMunicipality[areaId] || (stockholmCityAreaIds.has(areaId) ? [stockholmCityCode] : []);
  return areaCodes.some((code) => municipalityCodes.includes(code));
}
