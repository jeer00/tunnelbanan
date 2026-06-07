import { mkdir, writeFile } from "node:fs/promises";

const bbox = {
  south: 59.26,
  west: 17.95,
  north: 59.41,
  east: 18.18
};
const rows = 10;
const cols = 6;
const patches = [];
const tints = [0x304f3b, 0x2b4936, 0x345640];

for (let row = 0; row < rows; row += 1) {
  const south = lerp(bbox.south, bbox.north, row / rows);
  const north = lerp(bbox.south, bbox.north, (row + 1) / rows);

  for (let col = 0; col < cols; col += 1) {
    const west = lerp(bbox.west, bbox.east, col / cols);
    const east = lerp(bbox.west, bbox.east, (col + 1) / cols);
    const id = `r${row}c${col}`;

    patches.push({
      id,
      row,
      col,
      south: round(south),
      west: round(west),
      north: round(north),
      east: round(east),
      url: `./data/osm-patches/${id}.xml`,
      landTint: tints[(row + col) % tints.length]
    });
  }
}

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../data/stockholm-patches.json", import.meta.url),
  `${JSON.stringify({ bbox, rows, cols, patches }, null, 2)}\n`
);
console.log(`Wrote ${patches.length} patches to manifest`);

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function round(value) {
  return Number(value.toFixed(7));
}
