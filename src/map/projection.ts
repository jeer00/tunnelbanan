import type { MapManifest } from "./types";

const earthRadius = 6378137;

export function createMapProjection(manifest: Pick<MapManifest, "center" | "worldScale">) {
  const origin = lonLatToMercator(manifest.center.lon, manifest.center.lat);

  return {
    project(lon: number, lat: number) {
      const point = lonLatToMercator(lon, lat);
      return {
        x: (point.x - origin.x) * manifest.worldScale,
        z: -(point.y - origin.y) * manifest.worldScale,
      };
    },
    unproject(x: number, z: number) {
      return mercatorToLonLat(
        x / manifest.worldScale + origin.x,
        -z / manifest.worldScale + origin.y,
      );
    },
  };
}

function lonLatToMercator(lon: number, lat: number) {
  const lambda = degToRad(lon);
  const phi = degToRad(lat);
  return {
    x: earthRadius * lambda,
    y: earthRadius * Math.log(Math.tan(Math.PI / 4 + phi / 2)),
  };
}

function mercatorToLonLat(x: number, y: number) {
  return {
    lon: radToDeg(x / earthRadius),
    lat: radToDeg(2 * Math.atan(Math.exp(y / earthRadius)) - Math.PI / 2),
  };
}

function degToRad(value: number) {
  return (value * Math.PI) / 180;
}

function radToDeg(value: number) {
  return (value * 180) / Math.PI;
}
