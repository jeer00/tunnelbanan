# 3D Map Data

The 3D city source data lives outside this app in `../3dmap/data`. This app should not serve those raw OSM XML files directly. They are large, tag-heavy source files meant for preprocessing.

Runtime map data is generated into `public/map`:

- `manifest.json`: small index loaded once by the client.
- `patches/*.json`: independent streamed chunks containing projected building and road arrays.

Generate the runtime files with:

```sh
npm run map:build
```

The client-side loading boundary is `src/map/patchStore.ts`. A future Three.js renderer should call `loadManifest()` once and `loadNearWorldPoint()` as the camera target changes. The renderer owns GPU resources created from loaded patches and should dispose those resources when a patch leaves the visible/cache radius.

## Patch Format

Each patch file is intentionally compact:

```ts
{
  buildings: Array<{ h: number; p: number[] }>;
  roads: Array<{ k: string; p: number[] }>;
}
```

`p` is a flattened `[x, z, x, z, ...]` list in local Web Mercator world coordinates. Building height is stored as `h` in meters. Terrain height is not baked yet; the first renderer pass can place geometry on a flat plane, then a later pass can add a terrain height grid and apply it when building GPU buffers.

## Why This Shape

The browser should stream prepared geometry, not parse OSM XML. The source XML patches are about 192 MB before any runtime processing. The generated files remove nodes, unused tags, and non-rendered features, and split the city into independent chunks that can be fetched only when needed.
