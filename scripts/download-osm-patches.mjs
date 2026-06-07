import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const manifestPath = new URL("../data/stockholm-patches.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const outDir = new URL("../data/osm-patches/", import.meta.url);

// Optional: pass a row+col filter as args to download a subset.
//   node download-osm-patches.mjs 0 0   (downloads only r0c0)
//   node download-osm-patches.mjs       (downloads all)
const filterRow = process.argv[2] !== undefined ? Number(process.argv[2]) : null;
const filterCol = process.argv[3] !== undefined ? Number(process.argv[3]) : null;

await mkdir(outDir, { recursive: true });

let downloaded = 0;
let skipped = 0;
let failed = 0;

for (const patch of manifest.patches) {
  if (filterRow !== null && patch.row !== filterRow) continue;
  if (filterCol !== null && patch.col !== filterCol) continue;

  const filename = path.basename(patch.url);
  const outPath = new URL(filename, outDir);

  // Skip if already downloaded and looks like valid OSM
  try {
    const existing = await readFile(outPath, "utf8");
    if (existing.trimStart().startsWith("<?xml")) {
      skipped += 1;
      continue;
    }
  } catch {
    // not downloaded yet
  }

  const bbox = `${patch.west},${patch.south},${patch.east},${patch.north}`;
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`;

  let response;
  let attempts = 0;
  while (attempts < 4) {
    attempts += 1;
    try {
      response = await fetch(url, {
        headers: { "User-Agent": "subwayer-stockholm/0.1 (https://github.com/jeer00/tunnelbanan)" },
      });
    } catch (error) {
      if (attempts >= 4) {
        failed += 1;
        console.error(`${patch.id}: fetch error ${error instanceof Error ? error.message : error}`);
      } else {
        await new Promise((r) => setTimeout(r, 5000 * attempts));
      }
      continue;
    }

    if (response.ok) break;
    if (attempts >= 4) {
      failed += 1;
      console.error(`${patch.id}: HTTP ${response.status} (gave up)`);
    } else {
      console.warn(`${patch.id}: HTTP ${response.status} (retry ${attempts}/4 in ${5 * attempts}s)`);
      await new Promise((r) => setTimeout(r, 5000 * attempts));
    }
  }
  if (!response || !response.ok) continue;

  const text = await response.text();
  if (!text.trimStart().startsWith("<?xml")) {
    failed += 1;
    console.error(`${patch.id}: non-XML response (${text.slice(0, 80)}...)`);
    continue;
  }

  await writeFile(outPath, text);
  downloaded += 1;
  const nodes = text.match(/<node /g)?.length ?? 0;
  const ways = text.match(/<way /g)?.length ?? 0;
  console.log(`${patch.id}: ${nodes} nodes, ${ways} ways`);

  // Be polite to the OSM API
  await new Promise((r) => setTimeout(r, 3500));
}

console.log(`\nDone. Downloaded ${downloaded}, skipped ${skipped}, failed ${failed}.`);
