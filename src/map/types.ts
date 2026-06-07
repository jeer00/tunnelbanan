export type MapPoint = {
  x: number;
  z: number;
};

export type MapPatchMeta = {
  id: string;
  row: number;
  col: number;
  south: number;
  west: number;
  north: number;
  east: number;
  center: MapPoint;
  url: string;
  buildings: number;
  roads: number;
};

export type MapManifest = {
  version: number;
  projection: "local-web-mercator";
  worldScale: number;
  center: {
    lat: number;
    lon: number;
  };
  bbox: {
    south: number;
    west: number;
    north: number;
    east: number;
  };
  rows: number;
  cols: number;
  patches: MapPatchMeta[];
};

export type BuildingFeature = {
  h: number;
  t?: string; // r=residential, c=commercial, i=industrial, u=public/landmark, d=default
  s?: number; // 0-255 per-building shade variation
  p: number[];
};

export type RoadFeature = {
  k: string;
  p: number[];
};

export type PatchElevation = {
  n: number;
  values: number[];
};

export type MapPatchData = {
  buildings: BuildingFeature[];
  roads: RoadFeature[];
  elevation: PatchElevation;
};
