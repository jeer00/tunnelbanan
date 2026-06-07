# 3D Map Data

The 3D city source data lives outside this app in `../3dmap/data`. This app should not serve those raw OSM XML files directly. They are large, tag-heavy source files meant for preprocessing.

Runtime map data is generated into `public/map`:

- `manifest.json`: small index loaded once by the client.
- `patches/*.json`: independent streamed chunks containing projected building and road arrays, plus a per-patch elevation grid.

Generate the runtime files with:

```sh
npm run map:build
```

The build script fetches AWS Terrarium elevation tiles (zoom 13) and samples a 9x9 height grid per patch, so the renderer can drape buildings, roads, the basemap, stations, and routes on the local terrain.

The client-side loading boundary is `src/map/patchStore.ts`. The renderer calls `loadManifest()` once and `loadNearWorldPoint()` as the camera target changes. The renderer owns GPU resources created from loaded patches and should dispose those resources when a patch leaves the visible/cache radius.

## Patch Format

Each patch file is intentionally compact:

```ts
{
  buildings: Array<{ h: number; p: number[] }>;
  roads: Array<{ k: string; p: number[] }>;
  elevation: { n: number; values: number[] };
}
```

`p` is a flattened `[x, z, x, z, ...]` list in local Web Mercator world coordinates. Building height is stored as `h` in meters.

`elevation.values` is a row-major `n*n` grid of elevation in meters (real-world height above sea level, before exaggeration). The current build samples a 17x17 grid per patch and applies two passes of 3x3 box filtering for smoothness. The renderer uses bilinear sampling over the grid plus a constant `TERRAIN_EXAGGERATION` (1.8) to place features on the local terrain. Buildings use a flat base at the patch-local average terrain height (matching the reference renderer) so walls stay vertical.

## Why This Shape

The browser should stream prepared geometry, not parse OSM XML. The source XML patches are about 192 MB before any runtime processing. The generated files remove nodes, unused tags, and non-rendered features, and split the city into independent chunks that can be fetched only when needed. Elevation is pre-baked per patch so the renderer does not need to fetch or decode Terrarium tiles at runtime.
