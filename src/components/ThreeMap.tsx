import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { aggregateDemandAreas } from "../demandData";
import { createMapProjection } from "../map/projection";
import { MapPatchStore } from "../map/patchStore";
import type { MapPatchData, MapPatchMeta, PatchElevation } from "../map/types";
import type { BuildMode, GameState, GeoPoint, MapOverlay, Metrics, SnapHint, TrackTool } from "../types";

type FlowParticle = {
  t: number;
  speed: number;
  meshIndex: number;
};

type LineFlowState = {
  color: THREE.Color;
  worldPath: THREE.Vector3[];
  segmentLengths: number[];
  totalLength: number;
  particles: FlowParticle[];
  pointCloud: THREE.Points;
  positions: Float32Array;
  particleCount: number;
};

type PassengerFlowState = {
  lines: Map<string, LineFlowState>;
  lastTime: number;
};

type ThreeMapProps = {
  game: GameState;
  metrics: Metrics;
  mapOverlay: MapOverlay;
  mode: BuildMode;
  activeLineColor: string;
  trackNodeCost: number;
  stationPlacementCost: number;
  onMapClick: (point: { lat: number; lon: number }) => void;
  onMapDrawStart: (point: { lat: number; lon: number }, snap: SnapHint | null) => void;
  onMapDrawSample: (point: { lat: number; lon: number }, snap: SnapHint | null) => void;
  onMapDrawEnd: () => void;
  onMapDrawAbort: () => void;
  onMapDrawUndo: () => void;
  onStationClick: (stationId: string) => void;
  onTrackNodeClick: (lineId: string, index: number) => void;
};

type PatchRenderRecord = {
  group: THREE.Group;
  data: MapPatchData;
  meta: MapPatchMeta;
};

type PatchBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

type TerrainEntry = {
  bounds: PatchBounds;
  data: PatchElevation;
};

const basemapTextureCache = new Map<string, THREE.Texture>();

const cityBaseMaterial = new THREE.MeshStandardMaterial({
  color: 0x071018,
  roughness: 0.9,
  metalness: 0.05,
});
const buildingWallMaterial = new THREE.MeshStandardMaterial({
  color: 0x6f725f,
  roughness: 0.86,
  metalness: 0.04,
});
const buildingRoofMaterial = new THREE.MeshStandardMaterial({
  color: 0xa9a078,
  roughness: 0.9,
  metalness: 0.02,
});
const heatmapBuildingMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.72,
  metalness: 0.03,
  emissive: 0x21140a,
  emissiveIntensity: 0.18,
});
const roadMaterial = new THREE.LineBasicMaterial({
  color: 0x63c8df,
  transparent: true,
  opacity: 0.48,
});

const basemapTileHost = "https://basemaps.cartocdn.com/dark_all";
const basemapZoom = 14;
const basemapSubdivisions = 12;
const stockholmBbox = {
  south: 59.296,
  west: 17.99,
  north: 59.365,
  east: 18.16,
};
const basemapBbox = stockholmBbox;

const TERRAIN_EXAGGERATION = 1.8;
const TERRAIN_MIN = -8;
const TERRAIN_MAX = 120;
const ROUTE_LIFT = 22;
const STATION_LIFT = 78;
const ROAD_LIFT = 1.4;
const BUILDING_BASE_LIFT = 0;
const basemapDrapeOffset = 0.3;
const STATION_SNAP_RADIUS = 110;
const LINE_SNAP_RADIUS = 80;
const MIN_TRACK_DISTANCE = 38;
const STATION_COVER_RADIUS_KM = 1.25;

function stationDemand(station: GeoPoint) {
  let homes = 0;
  let jobs = 0;
  for (const area of aggregateDemandAreas) {
    const center = {
      lat: (area.bounds.south + area.bounds.north) / 2,
      lon: (area.bounds.west + area.bounds.east) / 2,
    };
    const dx = station.lat - center.lat;
    const dy = station.lon - center.lon;
    const approxKm = Math.sqrt(dx * dx * 111 * 111 + dy * dy * 111 * 111);
    if (approxKm <= STATION_COVER_RADIUS_KM) {
      homes += area.residents;
      jobs += area.jobs;
    }
  }
  return { homes, jobs };
}

function flowColorFor(station: GeoPoint, overlay: MapOverlay): number | null {
  if (overlay !== "flows") return null;
  const { homes, jobs } = stationDemand(station);
  if (homes === 0 && jobs === 0) return 0x6b7280;
  if (homes > jobs * 1.2) return 0x4a9eff;
  if (jobs > homes * 1.2) return 0xff9a3c;
  return 0xa87fff;
}
const stockholmProjection = createMapProjection({
  center: {
    lat: (stockholmBbox.south + stockholmBbox.north) / 2,
    lon: (stockholmBbox.west + stockholmBbox.east) / 2,
  },
  worldScale: 0.25,
});
const aggregateDemandAreasWorld = aggregateDemandAreas.map((area) => {
  const northWest = stockholmProjection.project(area.bounds.west, area.bounds.north);
  const southEast = stockholmProjection.project(area.bounds.east, area.bounds.south);
  return {
    ...area,
    minX: Math.min(northWest.x, southEast.x),
    maxX: Math.max(northWest.x, southEast.x),
    minZ: Math.min(northWest.z, southEast.z),
    maxZ: Math.max(northWest.z, southEast.z),
  };
});
const overlayValueSets: Record<Exclude<MapOverlay, "none" | "flows">, number[]> = {
  homes: aggregateDemandAreas.map((area) => area.residents).sort((a, b) => a - b),
  jobs: aggregateDemandAreas.map((area) => area.jobs).sort((a, b) => a - b),
  demand: aggregateDemandAreas
    .map((area) => commuteDemandValue(area.residents, area.jobs))
    .sort((a, b) => a - b),
  unmet: aggregateDemandAreas
    .map((area) => Math.abs(area.residents - area.jobs))
    .sort((a, b) => a - b),
};

class TerrainContext {
  private readonly entries = new Map<string, TerrainEntry>();

  upsert(id: string, meta: MapPatchMeta, data: PatchElevation) {
    const nw = stockholmProjection.project(meta.west, meta.north);
    const se = stockholmProjection.project(meta.east, meta.south);
    this.entries.set(id, {
      bounds: {
        minX: Math.min(nw.x, se.x),
        maxX: Math.max(nw.x, se.x),
        minZ: Math.min(nw.z, se.z),
        maxZ: Math.max(nw.z, se.z),
      },
      data,
    });
  }

  remove(id: string) {
    this.entries.delete(id);
  }

  has(id: string) {
    return this.entries.has(id);
  }

  clear() {
    this.entries.clear();
  }

  sampleAt(x: number, z: number): number | null {
    for (const entry of this.entries.values()) {
      const { bounds, data } = entry;
      if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) continue;
      return samplePatchElevation(data, bounds, x, z);
    }
    return null;
  }
}

function samplePatchElevation(data: PatchElevation, bounds: PatchBounds, x: number, z: number): number {
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  if (spanX <= 0 || spanZ <= 0) return 0;
  const u = (x - bounds.minX) / spanX;
  const v = (z - bounds.minZ) / spanZ;
  const last = data.n - 1;
  const gx = THREE.MathUtils.clamp(u, 0, 1) * last;
  const gz = THREE.MathUtils.clamp(v, 0, 1) * last;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const x1 = Math.min(x0 + 1, last);
  const z1 = Math.min(z0 + 1, last);
  const tx = gx - x0;
  const tz = gz - z0;
  const stride = data.n;
  const p00 = data.values[z0 * stride + x0];
  const p10 = data.values[z0 * stride + x1];
  const p01 = data.values[z1 * stride + x0];
  const p11 = data.values[z1 * stride + x1];
  const a = THREE.MathUtils.lerp(p00, p10, tx);
  const b = THREE.MathUtils.lerp(p01, p11, tx);
  const meters = THREE.MathUtils.lerp(a, b, tz);
  const clamped = THREE.MathUtils.clamp(meters, TERRAIN_MIN, TERRAIN_MAX);
  return clamped * TERRAIN_EXAGGERATION;
}

function patchBounds(meta: MapPatchMeta): PatchBounds {
  const nw = stockholmProjection.project(meta.west, meta.north);
  const se = stockholmProjection.project(meta.east, meta.south);
  return {
    minX: Math.min(nw.x, se.x),
    maxX: Math.max(nw.x, se.x),
    minZ: Math.min(nw.z, se.z),
    maxZ: Math.max(nw.z, se.z),
  };
}

function sampleTerrainForPatch(
  bounds: PatchBounds,
  data: MapPatchData,
  x: number,
  z: number,
): number {
  if (
    x < bounds.minX ||
    x > bounds.maxX ||
    z < bounds.minZ ||
    z > bounds.maxZ
  ) {
    return 0;
  }
  return samplePatchElevation(data.elevation, bounds, x, z);
}

export function ThreeMap({
  game,
  metrics,
  mapOverlay,
  mode,
  activeLineColor,
  trackNodeCost,
  stationPlacementCost,
  onMapClick,
  onMapDrawStart,
  onMapDrawSample,
  onMapDrawEnd,
  onMapDrawAbort,
  onMapDrawUndo,
  onStationClick,
  onTrackNodeClick,
}: ThreeMapProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cityLayerRef = useRef<THREE.Group | null>(null);
  const routeLayerRef = useRef<THREE.Group | null>(null);
  const routePreviewLayerRef = useRef<THREE.Group | null>(null);
  const stationLayerRef = useRef<THREE.Group | null>(null);
  const passengerFlowLayerRef = useRef<THREE.Group | null>(null);
  const routePickablesRef = useRef<THREE.Object3D[]>([]);
  const stationPickablesRef = useRef<THREE.Object3D[]>([]);
  const basemapLayerRef = useRef<THREE.Group | null>(null);
  const pressedKeysRef = useRef(new Set<string>());
  const mapOverlayRef = useRef(mapOverlay);
  const patchStoreRef = useRef(new MapPatchStore({ maxCachedPatches: 40 }));
  const renderedPatchesRef = useRef(new Map<string, PatchRenderRecord>());
  const terrainRef = useRef(new TerrainContext());
  const frameRef = useRef<number | null>(null);
  const lastPatchSyncRef = useRef(0);
  const dragRef = useRef({ x: 0, y: 0, moved: false });
  const gameRef = useRef(game);
  const drawingRef = useRef<{
    active: boolean;
    pointerId: number;
    mode: BuildMode | null;
    lastSample: { lat: number; lon: number } | null;
  }>({
    active: false,
    pointerId: -1,
    mode: null,
    lastSample: null,
  });
  const snapRef = useRef<SnapHint | null>(null);
  const pointerScreenRef = useRef<{ x: number; y: number } | null>(null);
  const [drawPreview, setDrawPreview] = useState<{
    text: string;
    cost: number;
    distanceKm: number;
    snap: SnapHint | null;
    x: number;
    y: number;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const modeRef = useRef(mode);
  const onMapClickRef = useRef(onMapClick);
  const onMapDrawStartRef = useRef(onMapDrawStart);
  const onMapDrawSampleRef = useRef(onMapDrawSample);
  const onMapDrawEndRef = useRef(onMapDrawEnd);
  const onMapDrawAbortRef = useRef(onMapDrawAbort);
  const onMapDrawUndoRef = useRef(onMapDrawUndo);
  const onTrackNodeClickRef = useRef(onTrackNodeClick);
  const trackNodeCostRef = useRef(trackNodeCost);
  const stationPlacementCostRef = useRef(stationPlacementCost);
  const [status, setStatus] = useState("Loading 3D map data...");

  useEffect(() => {
    trackNodeCostRef.current = trackNodeCost;
  }, [trackNodeCost]);

  useEffect(() => {
    stationPlacementCostRef.current = stationPlacementCost;
  }, [stationPlacementCost]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    onMapDrawStartRef.current = onMapDrawStart;
  }, [onMapDrawStart]);

  useEffect(() => {
    onMapDrawSampleRef.current = onMapDrawSample;
  }, [onMapDrawSample]);

  useEffect(() => {
    onMapDrawEndRef.current = onMapDrawEnd;
  }, [onMapDrawEnd]);

  useEffect(() => {
    onMapDrawAbortRef.current = onMapDrawAbort;
  }, [onMapDrawAbort]);

  useEffect(() => {
    onMapDrawUndoRef.current = onMapDrawUndo;
  }, [onMapDrawUndo]);

  useEffect(() => {
    onTrackNodeClickRef.current = onTrackNodeClick;
  }, [onTrackNodeClick]);

  useEffect(() => {
    mapOverlayRef.current = mapOverlay;
    rebuildRenderedPatches();
  }, [mapOverlay]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.mouseButtons = {
      LEFT: mode === "track" ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.DOLLY,
    };
  }, [mode]);

  useEffect(() => {
    rebuildRouteLayer();
  }, [game.lines, game.activeLineId, game.selectedTrackNode]);

  useEffect(() => {
    rebuildStationLayer();
  }, [game.stations, game.selectedStationId, mapOverlay]);

  useEffect(() => {
    rebuildPassengerFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.lines, metrics.riders, metrics.servedTrips]);

  const flowStateRef = useRef<PassengerFlowState>({
    lines: new Map(),
    lastTime: 0,
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x071018);
    scene.fog = new THREE.FogExp2(0x071018, 0.00034);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(46, 1, 8, 9000);
    camera.position.set(0, 1260, -1360);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMappingExposure = 1.08;
    host.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.43;
    controls.minDistance = 120;
    controls.maxDistance = 4200;
    controls.mouseButtons = {
      LEFT: mode === "track" ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.DOLLY,
    };
    controls.touches = {
      ONE: THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_ROTATE,
    };
    controlsRef.current = controls;

    const hemi = new THREE.HemisphereLight(0xe8f3ff, 0x364026, 1.4);
    const sun = new THREE.DirectionalLight(0xffffff, 4.2);
    sun.position.set(460, 900, -300);
    scene.add(hemi, sun);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 7400, 1, 1), cityBaseMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -22;
    ground.renderOrder = -20;
    scene.add(ground);

    const basemapLayer = new THREE.Group();
    basemapLayer.name = "basemap-layer";
    basemapLayerRef.current = basemapLayer;
    scene.add(basemapLayer);
    loadBasemapTiles(basemapLayer, terrainRef.current).catch((error) => {
      setStatus(error instanceof Error ? error.message : "Could not load map background");
    });

    const cityLayer = new THREE.Group();
    cityLayer.name = "city-layer";
    cityLayerRef.current = cityLayer;
    scene.add(cityLayer);

    const routeLayer = new THREE.Group();
    routeLayer.name = "route-layer";
    routeLayerRef.current = routeLayer;
    scene.add(routeLayer);

    const routePreviewLayer = new THREE.Group();
    routePreviewLayer.name = "route-preview-layer";
    routePreviewLayerRef.current = routePreviewLayer;
    scene.add(routePreviewLayer);

    const stationLayer = new THREE.Group();
    stationLayer.name = "station-layer";
    stationLayerRef.current = stationLayer;
    scene.add(stationLayer);

    const passengerFlowLayer = new THREE.Group();
    passengerFlowLayer.name = "passenger-flow-layer";
    passengerFlowLayerRef.current = passengerFlowLayer;
    scene.add(passengerFlowLayer);
    rebuildRouteLayer();
    rebuildStationLayer();

    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(host);
    resize();

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointercancel", handlePointerUp);
    renderer.domElement.addEventListener("mousemove", handleHoverMove);
    renderer.domElement.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    function animate(now: number) {
      applyKeyboardPan();
      controls.update();
      syncPatches(now);
      updatePassengerFlow(now);
      renderer.render(scene, camera);
      frameRef.current = requestAnimationFrame(animate);
    }
    frameRef.current = requestAnimationFrame(animate);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointercancel", handlePointerUp);
      renderer.domElement.removeEventListener("mousemove", handleHoverMove);
      renderer.domElement.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      controls.dispose();
      if (basemapLayerRef.current) disposeGroup(basemapLayerRef.current);
      basemapTextureCache.clear();
      if (cityLayerRef.current) disposeGroup(cityLayerRef.current, false);
      if (routeLayerRef.current) disposeGroup(routeLayerRef.current);
      if (routePreviewLayerRef.current) disposeGroup(routePreviewLayerRef.current);
      if (stationLayerRef.current) disposeGroup(stationLayerRef.current);
      if (passengerFlowLayerRef.current) disposeGroup(passengerFlowLayerRef.current);
      ground.geometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
      cityLayerRef.current = null;
      routeLayerRef.current = null;
      routePreviewLayerRef.current = null;
      stationLayerRef.current = null;
      passengerFlowLayerRef.current = null;
      routePickablesRef.current = [];
      stationPickablesRef.current = [];
      basemapLayerRef.current = null;
      renderedPatchesRef.current.clear();
      terrainRef.current.clear();
    };
  }, []);

  function resize() {
    const host = hostRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    if (!host || !camera || !renderer) return;

    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function handlePointerDown(event: PointerEvent) {
    dragRef.current = { x: event.clientX, y: event.clientY, moved: false };
    if (event.button !== 0) return;

    const currentMode = modeRef.current;

    if (currentMode === "track") {
      const node = pickTrackNode(event);
      if (node) {
        suppressClickRef.current = true;
        onTrackNodeClickRef.current(node.lineId, node.index);
        const start = mapPointFromPointer(event);
        if (start) {
          drawingRef.current = {
            active: true,
            pointerId: event.pointerId,
            mode: "track",
            lastSample: null,
          };
          const controls = controlsRef.current;
          if (controls) controls.enabled = false;
          try {
            (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
          } catch {
            // Pointer capture is optional; drawing still works without it.
          }
          const snap = findSnapTarget(start, gameRef.current.activeLineId);
          snapRef.current = snap;
          updateRoutePreview(lastTrackAnchor(), snap ? snap.point : start, snap);
          const game = gameRef.current;
          const line = game.lines.find((candidate) => candidate.id === game.activeLineId);
          const nodeCount = line?.path.length ?? 0;
          setDrawPreview(buildDrawPreview(snap ? snap.point : start, snap, "track", Math.max(1, nodeCount), 0));
        }
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 240);
        return;
      }
    }

    if (currentMode !== "track" && currentMode !== "station") return;

    const start = mapPointFromPointer(event);
    if (!start) return;

    const snap = currentMode === "track" || currentMode === "station"
      ? findSnapTarget(start, currentMode === "track" ? gameRef.current.activeLineId : null)
      : null;
    snapRef.current = snap;
    const usedStart = snap ? snap.point : start;

    drawingRef.current = {
      active: true,
      pointerId: event.pointerId,
      mode: currentMode,
      lastSample: usedStart,
    };
    const controls = controlsRef.current;
    if (controls) controls.enabled = false;
    try {
      (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is optional; drawing still works without it.
    }
    suppressClickRef.current = true;

    if (currentMode === "station") {
      onMapDrawStartRef.current(usedStart, snap);
      drawingRef.current.lastSample = usedStart;
      setDrawPreview(buildDrawPreview(usedStart, snap, currentMode, 1, 0));
      return;
    }

    onMapDrawStartRef.current(usedStart, snap);
    drawingRef.current.lastSample = usedStart;
    updateRoutePreview(null, usedStart, snap);
    setDrawPreview(buildDrawPreview(usedStart, snap, "track", 1, 0));
  }

  function buildDrawPreview(
    endPoint: GeoPoint,
    snap: SnapHint | null,
    mode: BuildMode,
    newNodes: number,
    newDistance: number,
  ) {
    if (mode !== "track" && mode !== "station") return null;
    const cost = mode === "track"
      ? Math.round(newNodes * trackNodeCostRef.current)
      : Math.round(newNodes * stationPlacementCostRef.current);
    const screen = pointerScreenRef.current || { x: 0, y: 0 };
    const isStation = mode === "station";
    const text = isStation
      ? `${newNodes} station${newNodes === 1 ? "" : "s"} · −${cost} mkr`
      : `${newNodes} node${newNodes === 1 ? "" : "s"} · ${newDistance.toFixed(0)}m · −${cost} mkr`;
    return {
      text,
      cost,
      distanceKm: newDistance / 1000,
      snap,
      x: screen.x,
      y: screen.y,
    };
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented || isTypingTarget(event.target)) return;
    if (event.key === "Escape") {
      const drawing = drawingRef.current;
      if (drawing.active) {
        drawingRef.current = { active: false, pointerId: -1, mode: null, lastSample: null };
        clearRoutePreview();
        if (controlsRef.current) controlsRef.current.enabled = true;
        onMapDrawAbortRef.current();
        suppressClickRef.current = false;
        onMapDrawEndRef.current();
      }
      return;
    }
    const key = event.key.toLowerCase();
    if (!["w", "a", "s", "d"].includes(key)) return;
    pressedKeysRef.current.add(key);
    event.preventDefault();
  }

  function handleKeyUp(event: KeyboardEvent) {
    pressedKeysRef.current.delete(event.key.toLowerCase());
  }

  function applyKeyboardPan() {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls || pressedKeysRef.current.size === 0) return;

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) forward.set(0, 0, 1);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const move = new THREE.Vector3();
    const keys = pressedKeysRef.current;
    if (keys.has("w")) move.add(forward);
    if (keys.has("s")) move.sub(forward);
    if (keys.has("d")) move.add(right);
    if (keys.has("a")) move.sub(right);
    if (move.lengthSq() < 0.0001) return;

    const distance = camera.position.distanceTo(controls.target);
    const speed = Math.max(8, Math.min(42, distance * 0.018));
    move.normalize().multiplyScalar(speed);
    camera.position.add(move);
    controls.target.add(move);
  }

  function handlePointerMove(event: PointerEvent) {
    pointerScreenRef.current = { x: event.clientX, y: event.clientY };
    const drag = dragRef.current;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) {
      drag.moved = true;
    }
    const drawing = drawingRef.current;
    if (!drawing.active || drawing.pointerId !== event.pointerId) return;
    if (drawing.mode !== modeRef.current) return;
    event.preventDefault();
    drag.moved = true;

    const current = mapPointFromPointer(event);
    if (!current) return;

    const snap = drawing.mode === "track" || drawing.mode === "station"
      ? findSnapTarget(current, drawing.mode === "track" ? gameRef.current.activeLineId : null)
      : null;
    snapRef.current = snap;
    const usedCurrent = snap ? snap.point : current;

    const last = drawing.lastSample;
    const minStep = drawing.mode === "station" ? 80 : 6;
    if (!last || distanceMetersApprox(last, usedCurrent) >= minStep) {
      if (last) {
        onMapDrawSampleRef.current(usedCurrent, snap);
      } else {
        onMapDrawStartRef.current(usedCurrent, snap);
      }
      drawing.lastSample = usedCurrent;
    }

    if (drawing.mode === "track") {
      const anchorPoint = lastTrackAnchor();
      updateRoutePreview(anchorPoint, usedCurrent, snap);
      const anchorWorld = anchorPoint ? stockholmProjection.project(anchorPoint.lon, anchorPoint.lat) : null;
      const end = stockholmProjection.project(usedCurrent.lon, usedCurrent.lat);
      const endVec = new THREE.Vector3(end.x, 0, end.z);
      const distance = anchorWorld
        ? endVec.distanceTo(new THREE.Vector3(anchorWorld.x, 0, anchorWorld.z))
        : 0;
      const game = gameRef.current;
      const line = game.lines.find((candidate) => candidate.id === game.activeLineId);
      const nodeCount = line?.path.length ?? 0;
      setDrawPreview(buildDrawPreview(usedCurrent, snap, "track", Math.max(1, nodeCount), distance));
    } else if (drawing.mode === "station") {
      const game = gameRef.current;
      const line = game.lines.find((candidate) => candidate.id === game.activeLineId);
      const stationCount = line?.stationIds.length ?? 0;
      setDrawPreview(buildDrawPreview(usedCurrent, snap, "station", Math.max(1, stationCount + 1), 0));
    }
  }

  function handlePointerUp(event: PointerEvent) {
    const drawing = drawingRef.current;
    if (drawing.active && drawing.pointerId === event.pointerId) {
      const wasTrack = drawing.mode === "track";
      const moved = dragRef.current.moved;
      const usedSnap = snapRef.current;
      drawingRef.current = { active: false, pointerId: -1, mode: null, lastSample: null };
      snapRef.current = null;
      clearRoutePreview();
      setDrawPreview(null);
      const controls = controlsRef.current;
      if (controls) controls.enabled = true;
      try {
        (event.currentTarget as HTMLElement | null)?.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore browsers that do not hold pointer capture here.
      }
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 240);

      if (wasTrack && !moved) {
        const point = mapPointFromPointer(event);
        if (point) {
          const snap = findSnapTarget(point, gameRef.current.activeLineId);
          onMapDrawStartRef.current(snap ? snap.point : point, snap);
        }
      }
      onMapDrawEndRef.current();
      return;
    }

    if (dragRef.current.moved) return;
    const stationId = pickStation(event);
    if (stationId) {
      onStationClick(stationId);
      return;
    }
    const node = pickTrackNode(event);
    if (node) {
      onTrackNodeClickRef.current(node.lineId, node.index);
      return;
    }
    const point = mapPointFromPointer(event);
    if (point && modeRef.current === "select") onMapClickRef.current(point);
  }

  function lastTrackAnchor() {
    const game = gameRef.current;
    const line = game.lines.find((candidate) => candidate.id === game.activeLineId);
    if (!line || !line.path.length) return null;
    const selected = game.selectedTrackNode;
    if (selected && selected.lineId === line.id && selected.index >= 0 && selected.index < line.path.length) {
      return line.path[selected.index];
    }
    return line.path[line.path.length - 1];
  }

  function handleHoverMove(event: MouseEvent) {
    pointerScreenRef.current = { x: event.clientX, y: event.clientY };
    if (drawingRef.current.active) return;
    const currentMode = modeRef.current;
    if (currentMode === "track") {
      const cursor = mapPointFromPointer(event);
      if (!cursor) return;
      const snap = findSnapTarget(cursor, gameRef.current.activeLineId);
      const target = snap ? snap.point : cursor;
      updateRoutePreview(lastTrackAnchor(), target, snap);
      const game = gameRef.current;
      const line = game.lines.find((candidate) => candidate.id === game.activeLineId);
      const anchor = lastTrackAnchor();
      const anchorWorld = anchor ? stockholmProjection.project(anchor.lon, anchor.lat) : null;
      const end = stockholmProjection.project(target.lon, target.lat);
      const endVec = new THREE.Vector3(end.x, 0, end.z);
      const distance = anchorWorld
        ? endVec.distanceTo(new THREE.Vector3(anchorWorld.x, 0, anchorWorld.z))
        : 0;
      const nodeCount = line?.path.length ?? 0;
      setDrawPreview(buildDrawPreview(target, snap, "track", Math.max(1, nodeCount), distance));
    } else if (currentMode === "station") {
      const cursor = mapPointFromPointer(event);
      if (!cursor) return;
      const layer = routePreviewLayerRef.current;
      if (!layer) return;
      const snap = findSnapTarget(cursor, null);
      const target = snap ? snap.point : cursor;
      clearRoutePreview();
      const world = stockholmProjection.project(target.lon, target.lat);
      const y = (terrainRef.current.sampleAt(world.x, world.z) ?? 0) + ROUTE_LIFT;
      const color = snap ? "#ffd86b" : "#f4f7fb";
      layer.add(createSnapMarker(new THREE.Vector3(world.x, y, world.z), 9, color, 18));
      setDrawPreview(buildDrawPreview(target, snap, "station", 1, 0));
    } else {
      clearRoutePreview();
      setDrawPreview(null);
    }
  }

  function handleClick(event: MouseEvent) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
    }
  }

  function handleContextMenu(event: MouseEvent) {
    event.preventDefault();
    if (modeRef.current !== "track") return;
    const game = gameRef.current;
    const line = game.lines.find((candidate) => candidate.id === game.activeLineId);
    if (!line || !line.path.length) return;
    onMapDrawUndoRef.current();
  }

  function pickTrackNode(event: MouseEvent | PointerEvent) {
    const raycaster = raycasterFromPointer(event);
    if (!raycaster) return null;
    const routeHits = raycaster.intersectObjects(routePickablesRef.current, true);
    const nodeHit = routeHits.find((hit) => hit.object.userData.trackNode);
    return (nodeHit?.object.userData.trackNode as { lineId: string; index: number } | undefined) || null;
  }

  function pickStation(event: MouseEvent | PointerEvent) {
    const raycaster = raycasterFromPointer(event);
    if (!raycaster) return null;
    const stationHits = raycaster.intersectObjects(stationPickablesRef.current, true);
    const hit = stationHits.find((candidate) => candidate.object.userData.stationId);
    return (hit?.object.userData.stationId as string | undefined) || null;
  }

  function findSnapTarget(rawPoint: GeoPoint, excludeLineId: string | null): SnapHint | null {
    const game = gameRef.current;
    const raw = stockholmProjection.project(rawPoint.lon, rawPoint.lat);
    const rawVec = new THREE.Vector3(raw.x, 0, raw.z);
    // Priority 1: stations
    let bestStation: { dist: number; ref: string; point: GeoPoint } | null = null;
    for (const station of game.stations) {
      const w = stockholmProjection.project(station.lon, station.lat);
      const v = new THREE.Vector3(w.x, 0, w.z);
      const d = rawVec.distanceTo(v);
      if (d < STATION_SNAP_RADIUS && (!bestStation || d < bestStation.dist)) {
        bestStation = { dist: d, ref: station.id, point: station };
      }
    }
    if (bestStation) return { kind: "station", point: bestStation.point, ref: bestStation.ref };
    // Priority 2: other lines' endpoints
    let bestEndpoint: { dist: number; ref: string; point: GeoPoint } | null = null;
    for (const line of game.lines) {
      if (line.id === excludeLineId) continue;
      if (line.path.length === 0) continue;
      const first = line.path[0];
      const last = line.path[line.path.length - 1];
      const f = stockholmProjection.project(first.lon, first.lat);
      const l = stockholmProjection.project(last.lon, last.lat);
      const fv = new THREE.Vector3(f.x, 0, f.z);
      const lv = new THREE.Vector3(l.x, 0, l.z);
      const fd = rawVec.distanceTo(fv);
      const ld = rawVec.distanceTo(lv);
      if (fd < LINE_SNAP_RADIUS && (!bestEndpoint || fd < bestEndpoint.dist)) {
        bestEndpoint = { dist: fd, ref: line.id, point: first };
      }
      if (ld < LINE_SNAP_RADIUS && (!bestEndpoint || ld < bestEndpoint.dist)) {
        bestEndpoint = { dist: ld, ref: line.id, point: last };
      }
    }
    if (bestEndpoint) return { kind: "line-endpoint", point: bestEndpoint.point, ref: bestEndpoint.ref };
    // Priority 3: other lines' segments
    let bestSeg: { dist: number; ref: string; point: GeoPoint } | null = null;
    for (const line of game.lines) {
      if (line.id === excludeLineId) continue;
      if (line.path.length < 2) continue;
      for (let i = 1; i < line.path.length; i += 1) {
        const f = stockholmProjection.project(line.path[i - 1].lon, line.path[i - 1].lat);
        const t = stockholmProjection.project(line.path[i].lon, line.path[i].lat);
        const from = new THREE.Vector3(f.x, 0, f.z);
        const to = new THREE.Vector3(t.x, 0, t.z);
        const seg = to.clone().sub(from);
        const lenSq = seg.lengthSq();
        if (lenSq < 1) continue;
        const tt = Math.max(0, Math.min(1, rawVec.clone().sub(from).dot(seg) / lenSq));
        const proj = from.clone().add(seg.multiplyScalar(tt));
        const d = rawVec.distanceTo(proj);
        if (d < LINE_SNAP_RADIUS && (!bestSeg || d < bestSeg.dist)) {
          const lonLat = stockholmProjection.unproject(proj.x, proj.z);
          bestSeg = { dist: d, ref: line.id, point: { lat: lonLat.lat, lon: lonLat.lon } };
        }
      }
    }
    if (bestSeg) return { kind: "line-segment", point: bestSeg.point, ref: bestSeg.ref };
    return null;
  }

  function trackNodeGeoPoint(node: { lineId: string; index: number }) {
    const line = gameRef.current.lines.find((candidate) => candidate.id === node.lineId);
    return line?.path[node.index] || null;
  }

  function mapPointFromPointer(event: MouseEvent | PointerEvent) {
    const raycaster = raycasterFromPointer(event);
    if (!raycaster) return null;

    const basemap = basemapLayerRef.current;
    if (basemap) {
      const hits = raycaster.intersectObjects(basemap.children, true);
      if (hits.length) {
        const hit = hits[0].point;
        const lonLat = stockholmProjection.unproject(hit.x, hit.z);
        return { lat: lonLat.lat, lon: lonLat.lon };
      }
    }

    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(ground, hit)) return null;
    const lonLat = stockholmProjection.unproject(hit.x, hit.z);
    return { lat: lonLat.lat, lon: lonLat.lon };
  }

  function raycasterFromPointer(event: MouseEvent | PointerEvent) {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) return null;

    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    return raycaster;
  }

  function updateRoutePreview(start: GeoPoint | null, end: GeoPoint, snap: SnapHint | null = null) {
    const layer = routePreviewLayerRef.current;
    if (!layer) return;
    clearRoutePreview();
    const terrain = terrainRef.current;
    const endWorld = stockholmProjection.project(end.lon, end.lat);
    const endY = (terrain.sampleAt(endWorld.x, endWorld.z) ?? 0) + ROUTE_LIFT;
    const endPoint = new THREE.Vector3(endWorld.x, endY, endWorld.z);
    const snapColor = snap?.kind === "station" ? "#ffd86b" : snap ? "#7ad7ff" : activeLineColor;
    const snapRadius = snap ? 11 : 9;
    if (start) {
      const startWorld = stockholmProjection.project(start.lon, start.lat);
      const startY = (terrain.sampleAt(startWorld.x, startWorld.z) ?? 0) + ROUTE_LIFT;
      const startPoint = new THREE.Vector3(startWorld.x, startY, startWorld.z);
      const points = [startPoint, endPoint];
      layer.add(createDashedRouteStrip(points, 10, snapColor, 0.9, 18, 14));
      layer.add(createRouteStroke(points, snapColor, 0.7, 19));
      layer.add(createSnapMarker(endPoint, snapRadius, snapColor, 21));
      if (snap) layer.add(createSnapHalo(endPoint, snapRadius, snapColor, 20));
      return;
    }
    layer.add(createSnapMarker(endPoint, snapRadius, snapColor, 18));
    if (snap) layer.add(createSnapHalo(endPoint, snapRadius, snapColor, 17));
  }

  function clearRoutePreview() {
    const layer = routePreviewLayerRef.current;
    if (!layer) return;
    disposeGroup(layer);
    layer.clear();
  }

  async function syncPatches(now: number) {
    const controls = controlsRef.current;
    const cityLayer = cityLayerRef.current;
    if (!controls || !cityLayer || now - lastPatchSyncRef.current < 700) return;
    lastPatchSyncRef.current = now;

    try {
      const records = await patchStoreRef.current.loadAll();
      const terrain = terrainRef.current;
      let terrainChanged = false;
      const seenIds = new Set<string>();

      for (const record of records) {
        seenIds.add(record.meta.id);
        const isNew = !terrain.has(record.meta.id);
        terrain.upsert(record.meta.id, record.meta, record.data.elevation);
        if (isNew) terrainChanged = true;
        if (renderedPatchesRef.current.has(record.meta.id)) continue;
        const group = createPatchGroup(record.meta.id, record.data, record.meta, mapOverlayRef.current, terrain);
        renderedPatchesRef.current.set(record.meta.id, { group, data: record.data, meta: record.meta });
        cityLayer.add(group);
      }

      for (const [id, record] of renderedPatchesRef.current) {
        if (seenIds.has(id)) continue;
        terrainChanged = true;
        terrain.remove(id);
        cityLayer.remove(record.group);
        disposeGroup(record.group, false);
        renderedPatchesRef.current.delete(id);
      }

      if (terrainChanged) {
        if (basemapLayerRef.current) rebuildBasemapMeshes(basemapLayerRef.current, terrain);
        rebuildRouteLayer();
        rebuildStationLayer();
      }

      const buildingCount = records.reduce((sum, record) => sum + record.meta.buildings, 0);
      setStatus(`${renderedPatchesRef.current.size} map patches, ${buildingCount.toLocaleString()} buildings`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load 3D map data");
    }
  }

  function rebuildRenderedPatches() {
    const cityLayer = cityLayerRef.current;
    if (!cityLayer) return;

    for (const [id, record] of renderedPatchesRef.current) {
      const terrain = terrainRef.current;
      terrain.upsert(id, record.meta, record.data.elevation);
      const nextGroup = createPatchGroup(id, record.data, record.meta, mapOverlayRef.current, terrain);
      cityLayer.remove(record.group);
      disposeGroup(record.group, false);
      cityLayer.add(nextGroup);
      renderedPatchesRef.current.set(id, { ...record, group: nextGroup });
    }
  }

  function rebuildRouteLayer() {
      const routeLayer = routeLayerRef.current;
    if (!routeLayer) return;

    disposeGroup(routeLayer);
    routeLayer.clear();
    routePickablesRef.current = [];
    for (const line of game.lines) {
      if (line.path.length < 2) continue;
      const route = createRouteMesh(
        line.path,
        line.color,
        line.id === game.activeLineId,
        game.selectedTrackNode?.lineId === line.id ? game.selectedTrackNode.index : null,
        line.trackTool,
        line.segmentTools,
        line.id,
        terrainRef.current,
      );
      if (route) {
        routeLayer.add(route.group);
        routePickablesRef.current.push(...route.pickables);
      }
    }
  }

  function rebuildStationLayer() {
    const stationLayer = stationLayerRef.current;
    if (!stationLayer) return;

    disposeGroup(stationLayer);
    stationLayer.clear();
    stationPickablesRef.current = [];
    for (const station of game.stations) {
      const flow = flowColorFor(station, mapOverlay);
      const marker = createStationMarker(station, station.id === game.selectedStationId, terrainRef.current, flow);
      stationLayer.add(marker);
      stationPickablesRef.current.push(marker);
    }
  }

  function rebuildPassengerFlow() {
    const layer = passengerFlowLayerRef.current;
    if (!layer) return;
    disposeGroup(layer);
    layer.clear();
    const state = flowStateRef.current;
    state.lines.clear();

    if (game.gameOver) return;

    const servedPerLine = computeServedTripsPerLine(game);
    const totalServed = Array.from(servedPerLine.values()).reduce((a, b) => a + b, 0) || 1;
    const maxParticles = 60;
    const terrain = terrainRef.current;

    for (const line of game.lines) {
      if (line.path.length < 2) continue;
      const served = servedPerLine.get(line.id) || 0;
      if (served <= 0) continue;
      const particleCount = Math.max(2, Math.min(maxParticles, Math.round((served / totalServed) * maxParticles * game.lines.length)));

      const worldPath: THREE.Vector3[] = [];
      let totalLength = 0;
      const segmentLengths: number[] = [];
      for (let i = 0; i < line.path.length; i += 1) {
        const p = line.path[i];
        const proj = stockholmProjection.project(p.lon, p.lat);
        const elevation = sampleTerrainElevation(terrain, p);
        worldPath.push(new THREE.Vector3(proj.x, elevation + 6, proj.z));
        if (i > 0) {
          const segLen = worldPath[i].distanceTo(worldPath[i - 1]);
          segmentLengths.push(segLen);
          totalLength += segLen;
        }
      }
      if (totalLength <= 0) continue;

      const positions = new Float32Array(particleCount * 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color: new THREE.Color(line.color),
        size: 6,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(geometry, material);
      points.renderOrder = 12;
      layer.add(points);

      const speedBase = 0.04 + (line.frequency <= 6 ? 0.02 : 0);
      const particles: FlowParticle[] = [];
      for (let i = 0; i < particleCount; i += 1) {
        particles.push({ t: i / particleCount, speed: speedBase * (0.85 + Math.random() * 0.3), meshIndex: i });
      }
      const lineColor = new THREE.Color(line.color);
      state.lines.set(line.id, {
        color: lineColor,
        worldPath,
        segmentLengths,
        totalLength,
        particles,
        pointCloud: points,
        positions,
        particleCount,
      });
    }
  }

  function updatePassengerFlow(now: number) {
    const state = flowStateRef.current;
    if (state.lines.size === 0) return;
    const lastTime = state.lastTime || now;
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    state.lastTime = now;

    for (const flow of state.lines.values()) {
      const { worldPath, segmentLengths, totalLength, particles, positions } = flow;
      if (worldPath.length < 2) continue;
      for (const p of particles) {
        p.t += p.speed * dt;
        if (p.t > 1) p.t -= 1;
        const targetDistance = p.t * totalLength;
        let acc = 0;
        let segIndex = 0;
        for (let i = 0; i < segmentLengths.length; i += 1) {
          if (acc + segmentLengths[i] >= targetDistance) {
            segIndex = i;
            break;
          }
          acc += segmentLengths[i];
          segIndex = i;
        }
        const segLen = segmentLengths[segIndex] || 1;
        const localT = segLen > 0 ? Math.max(0, Math.min(1, (targetDistance - acc) / segLen)) : 0;
        const a = worldPath[segIndex];
        const b = worldPath[segIndex + 1];
        if (!a || !b) continue;
        const x = a.x + (b.x - a.x) * localT;
        const y = a.y + (b.y - a.y) * localT;
        const z = a.z + (b.z - a.z) * localT;
        positions[p.meshIndex * 3] = x;
        positions[p.meshIndex * 3 + 1] = y;
        positions[p.meshIndex * 3 + 2] = z;
      }
      const attr = flow.pointCloud.geometry.attributes.position as THREE.BufferAttribute;
      attr.needsUpdate = true;
    }
  }

  return (
    <div className={`map-canvas-wrap three-map-wrap mode-${mode}`} ref={hostRef}>
      <div className="map-controls" aria-label="3D map controls">
        <button type="button" onClick={() => zoom(1)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoom(-1)} aria-label="Zoom out">-</button>
        <button type="button" onClick={resetView}>Center</button>
      </div>
      <div className="map-attribution">{status} · © OpenStreetMap contributors</div>
      {mapOverlay !== "none" && (
        <div className="map-legend" aria-label={`${mapOverlay} heatmap legend`}>
          <span>{overlayLabel(mapOverlay)}</span>
          <i />
          <strong>High</strong>
        </div>
      )}
      {drawPreview && (mode === "track" || mode === "station") && (
        <div
          className={`draw-tooltip ${drawPreview.snap ? "snapped" : ""}`}
          style={{ transform: `translate(${drawPreview.x + 18}px, ${drawPreview.y - 14}px)` }}
          aria-live="polite"
        >
          <span className="draw-tooltip-text">{drawPreview.text}</span>
          {drawPreview.snap && (
            <span className={`draw-tooltip-snap snap-${drawPreview.snap.kind}`}>
              {drawPreview.snap.kind === "station" ? "Snap to station" : drawPreview.snap.kind === "line-endpoint" ? "Connect to line" : "Cross line"}
            </span>
          )}
          {mode === "track" && (
            <span className="draw-tooltip-hint">Right-click to undo · Esc to cancel</span>
          )}
        </div>
      )}
    </div>
  );

  function resetView() {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    camera.position.set(0, 1260, -1360);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function zoom(direction: number) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const offset = camera.position.clone().sub(controls.target);
    offset.multiplyScalar(direction > 0 ? 0.78 : 1.22);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }
}

function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tagName = element.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || element.isContentEditable;
}

function createStationMarker(
  station: GeoPoint & { id: string; name: string },
  selected: boolean,
  terrain: TerrainContext,
  flowColor: number | null = null,
) {
  const world = stockholmProjection.project(station.lon, station.lat);
  const baseY = (terrain.sampleAt(world.x, world.z) ?? 0) + STATION_LIFT;
  const group = new THREE.Group();
  group.position.set(world.x, baseY, world.z);
  group.userData.stationId = station.id;

  const pinColor = selected
    ? 0xffffff
    : flowColor !== null
      ? flowColor
      : 0xf4f7fb;
  const pin = new THREE.Mesh(
    new THREE.CylinderGeometry(selected ? 12 : 9, selected ? 12 : 9, selected ? 7 : 5, 32),
    new THREE.MeshBasicMaterial({
      color: pinColor,
      transparent: false,
      depthTest: false,
      depthWrite: false,
    }),
  );
  pin.renderOrder = 31;
  pin.userData.stationId = station.id;

  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(selected ? 6 : 4.5, selected ? 6 : 4.5, selected ? 8 : 6, 28),
    new THREE.MeshBasicMaterial({
      color: selected ? 0x2fbf71 : 0x111820,
      depthTest: false,
      depthWrite: false,
    }),
  );
  core.position.y = 4;
  core.renderOrder = 32;
  core.userData.stationId = station.id;

  const label = createStationLabelSprite(station.name, selected);
  label.position.set(0, selected ? 34 : 30, 0);
  label.userData.stationId = station.id;

  group.add(pin, core, label);
  return group;
}

function createStationLabelSprite(name: string, selected: boolean) {
  const fontSize = 25;
  const paddingX = 18;
  const paddingY = 10;
  const measureCanvas = document.createElement("canvas");
  const measureContext = measureCanvas.getContext("2d")!;
  measureContext.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
  const textWidth = Math.ceil(measureContext.measureText(name).width);
  const width = Math.max(92, textWidth + paddingX * 2);
  const height = 46;
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const context = canvas.getContext("2d")!;
  context.scale(2, 2);
  context.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = selected ? "rgba(244, 247, 251, 0.96)" : "rgba(7, 16, 24, 0.82)";
  roundedRect(context, 0.5, 0.5, width - 1, height - 1, 7);
  context.fill();
  context.strokeStyle = selected ? "rgba(47, 191, 113, 0.95)" : "rgba(244, 247, 251, 0.2)";
  context.lineWidth = selected ? 2 : 1;
  roundedRect(context, 0.5, 0.5, width - 1, height - 1, 7);
  context.stroke();
  context.fillStyle = selected ? "#071018" : "#f4f7fb";
  context.fillText(name, width / 2, height / 2, width - paddingX * 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width * 0.68, height * 0.68, 1);
  sprite.renderOrder = 33;
  return sprite;
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function createRouteMesh(
  path: GeoPoint[],
  color: string,
  active: boolean,
  selectedNodeIndex: number | null,
  tool: TrackTool,
  segmentTools: TrackTool[],
  lineId: string,
  terrain: TerrainContext,
) {
  const rawPoints = path.map((point) => {
    const world = stockholmProjection.project(point.lon, point.lat);
    const y = (terrain.sampleAt(world.x, world.z) ?? 0) + ROUTE_LIFT;
    return new THREE.Vector3(world.x, y, world.z);
  });
  const points = smoothWorldPoints(rawPoints, tool, segmentTools);
  if (points.length < 2) return null;

  const group = new THREE.Group();
  const pickables: THREE.Object3D[] = [];
  group.add(createRouteStrip(points, active ? 18 : 15, "#020407", 0.82, 6));
  group.add(createRouteStrip(points, active ? 10 : 8, color, 0.96, 7));
  group.add(createRouteStroke(points, color, active ? 1 : 0.78, 8));

  // Direction arrows spaced along the smoothed curve
  const arrowSpacing = 360;
  let distanceAccum = 0;
  let lastArrowAt = 0;
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    const tangent = to.clone().sub(from);
    const segLen = tangent.length();
    if (segLen < 1e-3) continue;
    const dir = tangent.clone().normalize();
    let cursor = 0;
    while (cursor < segLen) {
      const remaining = segLen - cursor;
      const untilNext = arrowSpacing - (distanceAccum + cursor - lastArrowAt);
      if (untilNext <= 0 && remaining > 24) {
        const tAlong = cursor / segLen;
        const arrowPos = from.clone().add(tangent.clone().multiplyScalar(tAlong));
        const arrow = createArrowHead(arrowPos, dir, color, 14, 9);
        group.add(arrow);
        lastArrowAt = distanceAccum + cursor;
      }
      cursor += 24;
    }
    distanceAccum += segLen;
  }
  // End arrow
  const endTangent = points[points.length - 1].clone().sub(points[points.length - 2]).normalize();
  const endArrow = createArrowHead(points[points.length - 1], endTangent, color, 22, 9);
  group.add(endArrow);

  rawPoints.forEach((point, index) => {
    const node = createTrackNodeMesh(point, color, active, selectedNodeIndex === index, index, path.length, lineId);
    group.add(node);
    pickables.push(node);
  });
  return { group, pickables };
}

function createTrackNodeMesh(
  point: THREE.Vector3,
  color: string,
  active: boolean,
  selected: boolean,
  index: number,
  count: number,
  lineId: string,
) {
  const group = new THREE.Group();
  const nodeLift = selected ? 11 : 6;
  group.position.set(point.x, point.y + nodeLift + index * 0.02, point.z);
  group.userData.trackNode = { lineId, index };

  const endpoint = index === 0 || index === count - 1;
  const outerRadius = selected ? 22 : active || endpoint ? 15 : 10;
  const outer = new THREE.Mesh(
    new THREE.CylinderGeometry(outerRadius, outerRadius, selected ? 4 : 3, 32),
    new THREE.MeshBasicMaterial({
      color: selected ? 0xf4f7fb : 0x061015,
      transparent: !selected && !active,
      opacity: selected ? 1 : active ? 0.95 : 0.56,
      depthTest: false,
      depthWrite: false,
    }),
  );
  outer.renderOrder = 9;
  outer.userData.trackNode = { lineId, index };

  if (selected) {
    const halo = new THREE.Mesh(
      new THREE.CylinderGeometry(30, 30, 2, 36),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.28,
        depthTest: false,
        depthWrite: false,
      }),
    );
    halo.position.y = -1.2;
    halo.renderOrder = 8;
    halo.userData.trackNode = { lineId, index };
    group.add(halo);
  }

  const innerRadius = selected ? 11 : endpoint ? 8 : active ? 7 : 5;
  const inner = new THREE.Mesh(
    new THREE.CylinderGeometry(innerRadius, innerRadius, selected ? 6 : 4, 32),
    new THREE.MeshBasicMaterial({
      color,
      transparent: !selected && !active,
      opacity: selected || active ? 1 : 0.62,
      depthTest: false,
      depthWrite: false,
    }),
  );
  inner.position.y = 2.4;
  inner.renderOrder = 10;
  inner.userData.trackNode = { lineId, index };

  group.add(outer, inner);
  return group;
}

function createRouteStrip(points: THREE.Vector3[], width: number, color: string, opacity: number, renderOrder: number) {
  const half = width / 2;
  const vertices: number[] = [];
  const indices: number[] = [];
  const lefts: THREE.Vector3[] = [];
  const rights: THREE.Vector3[] = [];

  for (let i = 0; i < points.length; i += 1) {
    const previous = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const tangent = next.clone().sub(previous).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    lefts.push(points[i].clone().add(normal.clone().multiplyScalar(half)));
    rights.push(points[i].clone().add(normal.clone().multiplyScalar(-half)));
  }

  for (let i = 0; i < points.length; i += 1) {
    vertices.push(lefts[i].x, lefts[i].y, lefts[i].z, rights[i].x, rights[i].y, rights[i].z);
    if (i < points.length - 1) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = renderOrder;
  return mesh;
}

function createRouteStroke(points: THREE.Vector3[], color: string, opacity: number, renderOrder: number) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthTest: false,
    depthWrite: false,
  });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = renderOrder;
  return line;
}

function createDashedRouteStrip(points: THREE.Vector3[], width: number, color: string, opacity: number, renderOrder: number, dashWorldLength: number) {
  if (points.length < 2) return new THREE.Group();
  const half = width / 2;

  const vertices: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    const tangent = to.clone().sub(from);
    const segmentLength = tangent.length();
    if (segmentLength < 1e-3) continue;
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize().multiplyScalar(half);

    let cursor = 0;
    let on = true;
    while (cursor < segmentLength) {
      const step = Math.min(dashWorldLength, segmentLength - cursor);
      if (on) {
        const startPoint = from.clone().add(tangent.clone().multiplyScalar(cursor / segmentLength).multiplyScalar(segmentLength));
        const endPoint = from.clone().add(tangent.clone().multiplyScalar((cursor + step) / segmentLength).multiplyScalar(segmentLength));
        const a = startPoint.clone().add(normal);
        const b = endPoint.clone().add(normal);
        const c = endPoint.clone().sub(normal);
        const d = startPoint.clone().sub(normal);
        const base = vertices.length / 3;
        vertices.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      on = !on;
      cursor += step;
    }
  }

  if (!vertices.length) return new THREE.Group();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = renderOrder;
  return mesh;
}

function createSnapMarker(point: THREE.Vector3, radius: number, color: string, renderOrder: number) {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.85, radius, 36),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = renderOrder;
  group.add(ring);

  const core = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.35, 28),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.6,
      depthTest: false,
      depthWrite: false,
    }),
  );
  core.rotation.x = -Math.PI / 2;
  core.position.y = 0.1;
  core.renderOrder = renderOrder;
  group.add(core);

  group.position.copy(point);
  return group;
}

function createSnapHalo(point: THREE.Vector3, radius: number, color: string, renderOrder: number) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 1.6, radius * 2.0, 48),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.1;
  ring.renderOrder = renderOrder;
  ring.position.x += point.x;
  ring.position.z += point.z;
  ring.position.y += point.y;
  return ring;
}

function createArrowHead(point: THREE.Vector3, tangent: THREE.Vector3, color: string, size = 18, renderOrder = 12) {
  const group = new THREE.Group();
  const forward = tangent.clone().normalize();
  const shape = new THREE.Shape();
  shape.moveTo(size, 0);
  shape.lineTo(-size * 0.6, size * 0.55);
  shape.lineTo(-size * 0.4, 0);
  shape.lineTo(-size * 0.6, -size * 0.55);
  shape.lineTo(size, 0);
  const geometry = new THREE.ShapeGeometry(shape);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = renderOrder;
  const angle = Math.atan2(forward.z, forward.x);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = -angle;
  group.add(mesh);
  group.position.copy(point);
  group.position.y += 1.2;
  return group;
}

function distanceMetersApprox(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = Math.cos((a.lat * Math.PI) / 180) * 111320;
  const dLat = (b.lat - a.lat) * metersPerDegreeLat;
  const dLon = (b.lon - a.lon) * metersPerDegreeLon;
  return Math.hypot(dLat, dLon);
}

function smoothWorldPoints(points: THREE.Vector3[], tool: TrackTool, segmentTools: TrackTool[] = []) {
  if (points.length <= 2) return points;
  const smoothed: THREE.Vector3[] = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const cornerTool = segmentTools[i - 1] || tool;
    const samplesPerCorner = cornerTool === "straight" ? 1 : cornerTool === "broadCurve" ? 12 : 8;
    const curveFactor = cornerTool === "straight" ? 0 : cornerTool === "broadCurve" ? 0.46 : 0.32;
    if (!curveFactor) {
      smoothed.push(points[i]);
      continue;
    }
    const previous = points[i - 1];
    const current = points[i];
    const next = points[i + 1];
    const inDistance = current.distanceTo(previous);
    const outDistance = current.distanceTo(next);
    const radius = Math.min(inDistance, outDistance, 160) * curveFactor;
    const a = current.clone().add(previous.clone().sub(current).normalize().multiplyScalar(radius));
    const b = current.clone().add(next.clone().sub(current).normalize().multiplyScalar(radius));

    smoothed.push(a);
    for (let sample = 1; sample < samplesPerCorner; sample += 1) {
      const t = sample / samplesPerCorner;
      smoothed.push(quadraticPoint(a, current, b, t));
    }
    smoothed.push(b);
  }

  smoothed.push(points.at(-1)!);
  return smoothed;
}

function quadraticPoint(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, t: number) {
  const oneMinus = 1 - t;
  return new THREE.Vector3(
    oneMinus * oneMinus * a.x + 2 * oneMinus * t * b.x + t * t * c.x,
    oneMinus * oneMinus * a.y + 2 * oneMinus * t * b.y + t * t * c.y,
    oneMinus * oneMinus * a.z + 2 * oneMinus * t * b.z + t * t * c.z,
  );
}

function createPatchGroup(
  id: string,
  data: MapPatchData,
  meta: MapPatchMeta,
  overlay: MapOverlay,
  terrain: TerrainContext,
) {
  const group = new THREE.Group();
  group.name = `map-patch:${id}`;

  const buildings = createBuildings(data, meta, overlay, terrain);
  if (buildings) group.add(buildings);

  const roads = createRoads(data, meta, terrain);
  if (roads) group.add(roads);

  return group;
}

async function loadBasemapTiles(layer: THREE.Group, terrain: TerrainContext) {
  const nw = lonLatToTile(basemapBbox.west, basemapBbox.north, basemapZoom);
  const se = lonLatToTile(basemapBbox.east, basemapBbox.south, basemapZoom);
  const minX = Math.floor(nw.x);
  const maxX = Math.floor(se.x);
  const minY = Math.floor(nw.y);
  const maxY = Math.floor(se.y);
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");

  const loads: Promise<void>[] = [];
  for (let tileX = minX; tileX <= maxX; tileX += 1) {
    for (let tileY = minY; tileY <= maxY; tileY += 1) {
      loads.push(loadBasemapTile(loader, layer, tileX, tileY, basemapZoom, terrain));
    }
  }

  await Promise.all(loads);
}

function rebuildBasemapMeshes(layer: THREE.Group, terrain: TerrainContext) {
  disposeGroup(layer, false);
  const nw = lonLatToTile(basemapBbox.west, basemapBbox.north, basemapZoom);
  const se = lonLatToTile(basemapBbox.east, basemapBbox.south, basemapZoom);
  const minX = Math.floor(nw.x);
  const maxX = Math.floor(se.x);
  const minY = Math.floor(nw.y);
  const maxY = Math.floor(se.y);

  for (let tileX = minX; tileX <= maxX; tileX += 1) {
    for (let tileY = minY; tileY <= maxY; tileY += 1) {
      const texture = basemapTextureCache.get(basemapTextureKey(tileX, tileY, basemapZoom));
      if (!texture) continue;
      const mesh = createBasemapTileMesh(tileX, tileY, basemapZoom, texture, terrain);
      layer.add(mesh);
    }
  }
}

function basemapTextureKey(tileX: number, tileY: number, zoom: number) {
  return `${zoom}/${tileX}/${tileY}`;
}

function loadBasemapTile(
  loader: THREE.TextureLoader,
  layer: THREE.Group,
  tileX: number,
  tileY: number,
  zoom: number,
  terrain: TerrainContext,
) {
  const key = basemapTextureKey(tileX, tileY, zoom);
  if (basemapTextureCache.has(key)) {
    const texture = basemapTextureCache.get(key)!;
    const mesh = createBasemapTileMesh(tileX, tileY, zoom, texture, terrain);
    layer.add(mesh);
    return Promise.resolve();
  }

  const url = `${basemapTileHost}/${zoom}/${tileX}/${tileY}@2x.png`;
  return new Promise<void>((resolve) => {
    loader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.generateMipmaps = true;

        basemapTextureCache.set(key, texture);
        const mesh = createBasemapTileMesh(tileX, tileY, zoom, texture, terrain);
        layer.add(mesh);
        resolve();
      },
      undefined,
      () => resolve(),
    );
  });
}

function createBasemapTileMesh(
  tileX: number,
  tileY: number,
  zoom: number,
  texture: THREE.Texture,
  terrain: TerrainContext,
) {
  const nw = tileToLonLat(tileX, tileY, zoom);
  const ne = tileToLonLat(tileX + 1, tileY, zoom);
  const se = tileToLonLat(tileX + 1, tileY + 1, zoom);
  const sw = tileToLonLat(tileX, tileY + 1, zoom);
  const nwWorld = stockholmProjection.project(nw.lon, nw.lat);
  const neWorld = stockholmProjection.project(ne.lon, ne.lat);
  const seWorld = stockholmProjection.project(se.lon, se.lat);
  const swWorld = stockholmProjection.project(sw.lon, sw.lat);

  const subdiv = basemapSubdivisions;
  const vertices: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let j = 0; j <= subdiv; j += 1) {
    const v = j / subdiv;
    for (let i = 0; i <= subdiv; i += 1) {
      const u = i / subdiv;
      const lon = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(nw.lon, ne.lon, u),
        THREE.MathUtils.lerp(sw.lon, se.lon, u),
        v,
      );
      const lat = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(nw.lat, ne.lat, u),
        THREE.MathUtils.lerp(sw.lat, se.lat, u),
        v,
      );
      const p = stockholmProjection.project(lon, lat);
      const terrainY = terrain.sampleAt(p.x, p.z) ?? 0;
      vertices.push(p.x, terrainY + basemapDrapeOffset, p.z);
      uvs.push(u, 1 - v);
    }
  }

  for (let j = 0; j < subdiv; j += 1) {
    for (let i = 0; i < subdiv; i += 1) {
      const a = j * (subdiv + 1) + i;
      const b = a + 1;
      const c = a + (subdiv + 1);
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0xeaeaea,
    depthWrite: true,
    depthTest: true,
    fog: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -10;
  return mesh;
}

function createBuildings(
  data: MapPatchData,
  meta: MapPatchMeta,
  overlay: MapOverlay,
  terrain: TerrainContext,
) {
  const vertices: number[] = [];
  const colors: number[] = [];
  const roofIndices: number[] = [];
  const wallIndices: number[] = [];
  const overlayEnabled = overlay !== "none";
  const bounds = patchBounds(meta);

  for (const building of data.buildings) {
    const pointCount = building.p.length / 2;
    if (pointCount < 3) continue;

    const baseIndex = vertices.length / 3;
    const height = building.h * 1.45;
    const contour: THREE.Vector2[] = [];
    const overlayColor = overlayEnabled ? buildingOverlayColor(building.p, overlay) : null;
    let baseSum = 0;
    const xs: number[] = [];
    const zs: number[] = [];

    for (let i = 0; i < building.p.length; i += 2) {
      const x = building.p[i];
      const z = building.p[i + 1];
      baseSum += sampleTerrainForPatch(bounds, data, x, z);
      xs.push(x);
      zs.push(z);
      contour.push(new THREE.Vector2(x, z));
    }
    const baseY = baseSum / pointCount + BUILDING_BASE_LIFT;
    const topY = baseY + height;

    for (let i = 0; i < pointCount; i += 1) {
      vertices.push(xs[i], baseY, zs[i]);
      if (overlayColor) colors.push(overlayColor.wall.r, overlayColor.wall.g, overlayColor.wall.b);
    }
    for (let i = 0; i < pointCount; i += 1) {
      vertices.push(xs[i], topY, zs[i]);
      if (overlayColor) colors.push(overlayColor.roof.r, overlayColor.roof.g, overlayColor.roof.b);
    }

    const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const triangle of triangles) {
      roofIndices.push(
        baseIndex + pointCount + triangle[2],
        baseIndex + pointCount + triangle[1],
        baseIndex + pointCount + triangle[0],
      );
    }

    for (let i = 0; i < pointCount; i += 1) {
      const next = (i + 1) % pointCount;
      const a = baseIndex + i;
      const b = baseIndex + next;
      const c = baseIndex + pointCount + i;
      const d = baseIndex + pointCount + next;
      wallIndices.push(a, b, c, b, d, c);
    }
  }

  if (!vertices.length) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex([...roofIndices, ...wallIndices]);
  if (overlayEnabled) {
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  } else {
    geometry.clearGroups();
    geometry.addGroup(0, roofIndices.length, 0);
    geometry.addGroup(roofIndices.length, wallIndices.length, 1);
  }
  geometry.computeVertexNormals();

  return new THREE.Mesh(
    geometry,
    overlayEnabled ? heatmapBuildingMaterial : [buildingRoofMaterial, buildingWallMaterial],
  );
}

function createRoads(data: MapPatchData, meta: MapPatchMeta, terrain: TerrainContext) {
  const vertices: number[] = [];
  const bounds = patchBounds(meta);

  for (const road of data.roads) {
    for (let i = 2; i < road.p.length; i += 2) {
      const ax = road.p[i - 2];
      const az = road.p[i - 1];
      const bx = road.p[i];
      const bz = road.p[i + 1];
      const ay = sampleTerrainForPatch(bounds, data, ax, az) + ROAD_LIFT;
      const by = sampleTerrainForPatch(bounds, data, bx, bz) + ROAD_LIFT;
      vertices.push(ax, ay, az, bx, by, bz);
    }
  }

  if (!vertices.length) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  return new THREE.LineSegments(geometry, roadMaterial);
}

function buildingOverlayColor(points: number[], overlay: Exclude<MapOverlay, "none">) {
  const center = polygonCenter(points);
  const area = aggregateDemandAreasWorld
    .filter((candidate) =>
      center.x >= candidate.minX &&
      center.x <= candidate.maxX &&
      center.z >= candidate.minZ &&
      center.z <= candidate.maxZ
    )
    .sort((a, b) => (a.maxX - a.minX) * (a.maxZ - a.minZ) - (b.maxX - b.minX) * (b.maxZ - b.minZ))[0];
  const value = area ? overlayValue(area.residents, area.jobs, overlay) : 0;
  const normalized = value > 0 ? normalizedOverlayValue(value, overlay) : 0;
  const visualVariance = value > 0 ? 0.93 + deterministicNoise(center.x, center.z) * 0.12 : 1;
  let roof: THREE.Color;
  if ((overlay === "unmet" || overlay === "flows") && area) {
    // Red where homes >> jobs, blue where jobs >> homes
    const direction = area.residents > area.jobs ? 1 : -1;
    const imbalance = Math.abs(area.residents - area.jobs);
    const imbalanceNormalized = imbalance > 0
      ? Math.min(1, normalizedOverlayValue(imbalance, "unmet") * visualVariance)
      : 0;
    roof = overlay === "flows"
      ? flowColor(imbalanceNormalized, direction as 1 | -1)
      : unmetColor(imbalanceNormalized, direction as 1 | -1);
  } else {
    roof = heatColor(Math.min(1, normalized * visualVariance));
  }
  const wall = roof.clone().multiplyScalar(value > 0 ? 0.66 : 0.48);
  return { roof, wall };
}

function unmetColor(t: number, direction: 1 | -1) {
  // t: 0 (balanced) to 1 (extreme imbalance)
  // direction: 1 = homes-rich (red), -1 = jobs-rich (blue)
  if (direction > 0) {
    // red gradient: dark teal -> orange -> red
    const stops = [
      { at: 0, color: new THREE.Color(0x132124) },
      { at: 0.4, color: new THREE.Color(0xa44a2a) },
      { at: 0.8, color: new THREE.Color(0xe26d35) },
      { at: 1, color: new THREE.Color(0xff2a3d) },
    ];
    return sampleStops(stops, t);
  }
  // blue gradient: dark teal -> teal-blue -> deep blue
  const stops = [
    { at: 0, color: new THREE.Color(0x132124) },
    { at: 0.4, color: new THREE.Color(0x2a5a8a) },
    { at: 0.8, color: new THREE.Color(0x3d7eff) },
    { at: 1, color: new THREE.Color(0x4ac8ff) },
  ];
  return sampleStops(stops, t);
}

function flowColor(t: number, direction: 1 | -1) {
  // t: 0 (balanced) to 1 (extreme imbalance)
  // direction: 1 = homes-rich (purple/magenta = "where people leave"), -1 = jobs-rich (cyan = "where people arrive")
  if (direction > 0) {
    // magenta/purple gradient: dark teal -> deep purple -> bright magenta
    const stops = [
      { at: 0, color: new THREE.Color(0x132124) },
      { at: 0.4, color: new THREE.Color(0x5a2a8a) },
      { at: 0.8, color: new THREE.Color(0xa87fff) },
      { at: 1, color: new THREE.Color(0xe24cff) },
    ];
    return sampleStops(stops, t);
  }
  // cyan gradient: dark teal -> teal -> bright cyan
  const stops = [
    { at: 0, color: new THREE.Color(0x132124) },
    { at: 0.4, color: new THREE.Color(0x2a8a8a) },
    { at: 0.8, color: new THREE.Color(0x3ddfd0) },
    { at: 1, color: new THREE.Color(0x6bffe8) },
  ];
  return sampleStops(stops, t);
}

function sampleStops(stops: { at: number; color: THREE.Color }[], t: number) {
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t >= a.at && t <= b.at) {
      const localT = (t - a.at) / (b.at - a.at || 1);
      return a.color.clone().lerp(b.color, localT);
    }
  }
  return stops[stops.length - 1].color.clone();
}

function polygonCenter(points: number[]) {
  let x = 0;
  let z = 0;
  const count = points.length / 2 || 1;
  for (let i = 0; i < points.length; i += 2) {
    x += points[i];
    z += points[i + 1];
  }
  return { x: x / count, z: z / count };
}

function normalizedOverlayValue(value: number, overlay: Exclude<MapOverlay, "none">) {
  const values = overlayValueSets[overlay];
  if (!values || values.length === 0) return 0;
  const min = values[0] || 0;
  const max = values.at(-1) || 1;
  if (max <= min) return 1;

  const linear = (value - min) / (max - min);
  const rank = values.findIndex((candidate) => candidate >= value);
  const percentile = rank < 0 ? 1 : rank / Math.max(1, values.length - 1);
  return Math.max(0, Math.min(1, linear * 0.38 + percentile * 0.62));
}

function overlayValue(residents: number, jobs: number, overlay: Exclude<MapOverlay, "none">) {
  if (overlay === "homes") return residents;
  if (overlay === "jobs") return jobs;
  if (overlay === "flows") return 0;
  if (overlay === "unmet") return Math.abs(residents - jobs);
  return commuteDemandValue(residents, jobs);
}

function commuteDemandValue(residents: number, jobs: number) {
  return Math.round(residents * 0.58 + jobs * 0.82 + Math.sqrt(residents * jobs) * 0.32);
}

function sampleTerrainElevation(terrain: TerrainContext, point: GeoPoint): number {
  const proj = stockholmProjection.project(point.lon, point.lat);
  return terrain.sampleAt(proj.x, proj.z) ?? 0;
}

function computeServedTripsPerLine(game: GameState): Map<string, number> {
  const result = new Map<string, number>();
  if (!game.lines.length) return result;
  const stationHomes = new Map<string, number>();
  const stationJobs = new Map<string, number>();
  for (const station of game.stations) {
    let homes = 0;
    let jobs = 0;
    for (const area of aggregateDemandAreas) {
      const center = {
        lat: (area.bounds.south + area.bounds.north) / 2,
        lon: (area.bounds.west + area.bounds.east) / 2,
      };
      const distKm = haversineKm(station, center);
      if (distKm <= 1.25) {
        homes += area.residents;
        jobs += area.jobs;
      }
    }
    stationHomes.set(station.id, homes);
    stationJobs.set(station.id, jobs);
  }
  for (const line of game.lines) {
    let lineHomes = 0;
    let lineJobs = 0;
    for (const sid of line.stationIds) {
      lineHomes += stationHomes.get(sid) || 0;
      lineJobs += stationJobs.get(sid) || 0;
    }
    const served = Math.round(Math.min(lineHomes, lineJobs) * 0.3);
    result.set(line.id, served);
  }
  return result;
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const radius = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function deterministicNoise(x: number, z: number) {
  const value = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function heatColor(t: number) {
  const stops = [
    { at: 0, color: new THREE.Color(0x132124) },
    { at: 0.22, color: new THREE.Color(0x2d6f73) },
    { at: 0.48, color: new THREE.Color(0xf1c453) },
    { at: 0.73, color: new THREE.Color(0xe26d35) },
    { at: 1, color: new THREE.Color(0xd7263d) },
  ];
  const clamped = Math.max(0, Math.min(1, t));
  const upper = stops.find((stop) => stop.at >= clamped) ?? stops.at(-1)!;
  const lower = stops[Math.max(0, stops.indexOf(upper) - 1)];
  const span = upper.at - lower.at || 1;
  return lower.color.clone().lerp(upper.color, (clamped - lower.at) / span);
}

function overlayLabel(overlay: MapOverlay) {
  if (overlay === "homes") return "Homes";
  if (overlay === "jobs") return "Jobs";
  if (overlay === "demand") return "Demand";
  return "";
}

function lonLatToTile(lon: number, lat: number, zoom: number) {
  const latRad = (lat * Math.PI) / 180;
  const tiles = 2 ** zoom;
  return {
    x: ((lon + 180) / 360) * tiles,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * tiles,
  };
}

function tileToLonLat(x: number, y: number, zoom: number) {
  const tiles = 2 ** zoom;
  const lon = (x / tiles) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / tiles;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lon, lat };
}

function disposeGroup(group: THREE.Object3D, disposeMaterials = true) {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh | THREE.LineSegments;
    if ("geometry" in mesh && mesh.geometry) mesh.geometry.dispose();
    if (disposeMaterials && "material" in mesh && mesh.material) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        const mapped = material as THREE.Material & { map?: THREE.Texture };
        if (mapped.map) mapped.map.dispose();
        material.dispose();
      });
    }
  });
}
