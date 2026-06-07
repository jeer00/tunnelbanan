import type { MapManifest, MapPatchData, MapPatchMeta } from "./types";

type PatchRecord = {
  meta: MapPatchMeta;
  data: MapPatchData;
  lastUsed: number;
};

export class MapPatchStore {
  private readonly baseUrl: string;
  private readonly maxCachedPatches: number;
  private manifestPromise: Promise<MapManifest> | null = null;
  private patchesById = new Map<string, PatchRecord>();
  private loadingById = new Map<string, Promise<PatchRecord>>();
  private tick = 0;

  constructor({ baseUrl = "/map/", maxCachedPatches = 16 } = {}) {
    this.baseUrl = baseUrl;
    this.maxCachedPatches = maxCachedPatches;
  }

  async loadManifest() {
    if (!this.manifestPromise) {
      this.manifestPromise = fetchJson<MapManifest>(`${this.baseUrl}manifest.json`);
    }
    return this.manifestPromise;
  }

  async loadPatch(meta: MapPatchMeta) {
    const cached = this.patchesById.get(meta.id);
    if (cached) {
      cached.lastUsed = ++this.tick;
      return cached;
    }

    const loading = this.loadingById.get(meta.id);
    if (loading) return loading;

    const promise = fetchJson<MapPatchData>(`${this.baseUrl}${meta.url}`).then((data) => {
      const record = { meta, data, lastUsed: ++this.tick };
      this.patchesById.set(meta.id, record);
      this.loadingById.delete(meta.id);
      this.trimCache();
      return record;
    });

    this.loadingById.set(meta.id, promise);
    return promise;
  }

  async loadNearWorldPoint(point: { x: number; z: number }, radius = 1) {
    const manifest = await this.loadManifest();
    const centerPatch = nearestPatch(manifest.patches, point);
    if (!centerPatch) return [];

    const wanted = manifest.patches.filter(
      (patch) =>
        Math.abs(patch.row - centerPatch.row) <= radius &&
        Math.abs(patch.col - centerPatch.col) <= radius,
    );

    return Promise.all(wanted.map((patch) => this.loadPatch(patch)));
  }

  async loadAll() {
    const manifest = await this.loadManifest();
    return Promise.all(manifest.patches.map((patch) => this.loadPatch(patch)));
  }

  getCachedPatches() {
    return [...this.patchesById.values()];
  }

  private trimCache() {
    if (this.patchesById.size <= this.maxCachedPatches) return;

    const sorted = [...this.patchesById.values()].sort((a, b) => a.lastUsed - b.lastUsed);
    for (const record of sorted.slice(0, this.patchesById.size - this.maxCachedPatches)) {
      this.patchesById.delete(record.meta.id);
    }
  }
}

function nearestPatch(patches: MapPatchMeta[], point: { x: number; z: number }) {
  let best: MapPatchMeta | null = null;
  let bestDistance = Infinity;

  for (const patch of patches) {
    const distance = Math.hypot(patch.center.x - point.x, patch.center.z - point.z);
    if (distance < bestDistance) {
      best = patch;
      bestDistance = distance;
    }
  }

  return best;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} failed with ${response.status}`);
  return response.json() as Promise<T>;
}
