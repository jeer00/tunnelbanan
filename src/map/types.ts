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
  p: number[];
};

export type RoadFeature = {
  k: string;
  p: number[];
};

export type MapPatchData = {
  buildings: BuildingFeature[];
  roads: RoadFeature[];
};
