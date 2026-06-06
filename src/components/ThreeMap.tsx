import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { districts } from "../data";
import { aggregateDemandAreas } from "../demandData";
import { assignedTrainsets, districtById } from "../gameLogic";
import { createMapProjection } from "../map/projection";
import { MapPatchStore } from "../map/patchStore";
import type { MapPatchData } from "../map/types";
import type { District, GameState, Line, MapOverlay, Metrics } from "../types";

type ThreeMapProps = {
  game: GameState;
  metrics: Metrics;
  mapOverlay: MapOverlay;
  onDistrictClick: (district: District) => void;
};

type PatchRenderRecord = {
  group: THREE.Group;
  data: MapPatchData;
};

type StationScreenTarget = {
  district: District;
  position: THREE.Vector3;
};

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
const stockholmBbox = {
  south: 59.296,
  west: 17.99,
  north: 59.365,
  east: 18.16,
};
const basemapBbox = {
  south: stockholmBbox.south - 0.055,
  west: stockholmBbox.west - 0.09,
  north: stockholmBbox.north + 0.055,
  east: stockholmBbox.east + 0.09,
};
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
const overlayValueSets: Record<Exclude<MapOverlay, "none">, number[]> = {
  homes: aggregateDemandAreas.map((area) => area.residents).sort((a, b) => a - b),
  jobs: aggregateDemandAreas.map((area) => area.jobs).sort((a, b) => a - b),
  demand: aggregateDemandAreas
    .map((area) => commuteDemandValue(area.residents, area.jobs))
    .sort((a, b) => a - b),
};
const visualTrainCars = 3;
const visualCarStride = 95;
const visualCarScale = 0.55;
const visualTrainSpeed = 42;
const visualTrainHeight = 58;

export function ThreeMap({ game, metrics, mapOverlay, onDistrictClick }: ThreeMapProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const gameLayerRef = useRef<THREE.Group | null>(null);
  const trainLayerRef = useRef<THREE.Group | null>(null);
  const cityLayerRef = useRef<THREE.Group | null>(null);
  const basemapLayerRef = useRef<THREE.Group | null>(null);
  const stationPickablesRef = useRef<THREE.Object3D[]>([]);
  const stationTargetsRef = useRef<StationScreenTarget[]>([]);
  const stationPositionsRef = useRef(new Map<string, THREE.Vector3>());
  const dragRef = useRef({ x: 0, y: 0, moved: false });
  const trainModelRef = useRef<THREE.Group | null>(null);
  const trainModelVersionRef = useRef(0);
  const gameRef = useRef(game);
  const metricsRef = useRef(metrics);
  const mapOverlayRef = useRef(mapOverlay);
  const onDistrictClickRef = useRef(onDistrictClick);
  const patchStoreRef = useRef(new MapPatchStore({ maxCachedPatches: 14 }));
  const renderedPatchesRef = useRef(new Map<string, PatchRenderRecord>());
  const frameRef = useRef<number | null>(null);
  const lastPatchSyncRef = useRef(0);
  const clockRef = useRef(0);
  const [status, setStatus] = useState("Loading 3D map data...");

  useEffect(() => {
    gameRef.current = game;
    metricsRef.current = metrics;
    renderGameLayer();
  }, [game, metrics]);

  useEffect(() => {
    onDistrictClickRef.current = onDistrictClick;
  }, [onDistrictClick]);

  useEffect(() => {
    mapOverlayRef.current = mapOverlay;
    rebuildRenderedPatches();
  }, [mapOverlay]);

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
      LEFT: THREE.MOUSE.PAN,
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

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(7600, 6200, 1, 1),
      cityBaseMaterial,
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.2;
    ground.renderOrder = -20;
    scene.add(ground);

    const basemapLayer = new THREE.Group();
    basemapLayer.name = "basemap-layer";
    basemapLayerRef.current = basemapLayer;
    scene.add(basemapLayer);
    loadBasemapTiles(basemapLayer).catch((error) => {
      setStatus(error instanceof Error ? error.message : "Could not load map background");
    });

    const cityLayer = new THREE.Group();
    cityLayer.name = "city-layer";
    cityLayerRef.current = cityLayer;
    scene.add(cityLayer);

    const gameLayer = new THREE.Group();
    gameLayer.name = "game-layer";
    gameLayerRef.current = gameLayer;
    scene.add(gameLayer);

    const trainLayer = new THREE.Group();
    trainLayer.name = "train-layer";
    trainLayerRef.current = trainLayer;
    scene.add(trainLayer);

    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(host);
    resize();
    renderGameLayer();

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("click", handleClick);
    loadTrainModel();

    let previous = performance.now();
    function animate(now: number) {
      const delta = Math.min(0.05, (now - previous) / 1000);
      previous = now;
      clockRef.current += gameRef.current.paused ? 0 : delta;
      controls.update();
      renderTrainLayer();
      syncPatches(now);
      renderer.render(scene, camera);
      frameRef.current = requestAnimationFrame(animate);
    }
    frameRef.current = requestAnimationFrame(animate);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("click", handleClick);
      controls.dispose();
      if (basemapLayerRef.current) disposeGroup(basemapLayerRef.current);
      disposeGroup(cityLayer, false);
      disposeGroup(gameLayer);
      if (trainLayerRef.current) disposeGroup(trainLayerRef.current);
      if (trainModelRef.current) disposeGroup(trainModelRef.current, true, true);
      ground.geometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
      gameLayerRef.current = null;
      trainLayerRef.current = null;
      cityLayerRef.current = null;
      basemapLayerRef.current = null;
      stationPickablesRef.current = [];
      stationTargetsRef.current = [];
      stationPositionsRef.current.clear();
      renderedPatchesRef.current.clear();
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
  }

  function handlePointerMove(event: PointerEvent) {
    const drag = dragRef.current;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 8) {
      drag.moved = true;
    }
  }

  function handleClick(event: MouseEvent) {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) return;
    if (dragRef.current.moved) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    const hit = nearestStationTarget(point, rect, camera, stationTargetsRef.current);
    if (hit) onDistrictClickRef.current(hit);
  }

  async function syncPatches(now: number) {
    const controls = controlsRef.current;
    const cityLayer = cityLayerRef.current;
    if (!controls || !cityLayer || now - lastPatchSyncRef.current < 700) return;
    lastPatchSyncRef.current = now;

    try {
      const records = await patchStoreRef.current.loadNearWorldPoint(controls.target, 1);
      const activeIds = new Set(patchStoreRef.current.getCachedPatches().map((record) => record.meta.id));

      for (const record of records) {
        if (renderedPatchesRef.current.has(record.meta.id)) continue;
        const group = createPatchGroup(record.meta.id, record.data, mapOverlayRef.current);
        renderedPatchesRef.current.set(record.meta.id, { group, data: record.data });
        cityLayer.add(group);
      }

      for (const [id, record] of renderedPatchesRef.current) {
        if (activeIds.has(id)) continue;
        cityLayer.remove(record.group);
        disposeGroup(record.group, false);
        renderedPatchesRef.current.delete(id);
      }

      const buildingCount = patchStoreRef.current
        .getCachedPatches()
        .reduce((sum, record) => sum + record.meta.buildings, 0);
      setStatus(`${renderedPatchesRef.current.size} map patches, ${buildingCount.toLocaleString()} buildings`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load 3D map data");
    }
  }

  function renderGameLayer() {
    const gameLayer = gameLayerRef.current;
    const scene = sceneRef.current;
    if (!gameLayer || !scene) return;

    disposeGroup(gameLayer);
    gameLayer.clear();
    stationPickablesRef.current = [];
    stationTargetsRef.current = [];

    const manifestLike = { center: { lat: 59.3305, lon: 18.075 }, worldScale: 0.25 };
    const projection = createMapProjection(manifestLike);
    const stationPositions = new Map<string, THREE.Vector3>();

    for (const district of districts) {
      const p = projection.project(district.lon, district.lat);
      stationPositions.set(district.id, new THREE.Vector3(p.x, 22, p.z));
    }
    stationPositionsRef.current = stationPositions;

    for (const line of gameRef.current.lines) {
      const segments = routeSegments(line);
      for (const [fromId, toId] of segments) {
        const from = stationPositions.get(fromId);
        const to = stationPositions.get(toId);
        if (!from || !to) continue;
        gameLayer.add(createCylinderBetween(from, to, 4.2, line.color, 0.82));
      }
    }

    drawBuildPreview(gameLayer, stationPositions);
    drawStations(gameLayer, stationPositions);
    renderTrainLayer();
  }

  function rebuildRenderedPatches() {
    const cityLayer = cityLayerRef.current;
    if (!cityLayer) return;

    for (const [id, record] of renderedPatchesRef.current) {
      const nextGroup = createPatchGroup(id, record.data, mapOverlayRef.current);
      cityLayer.remove(record.group);
      disposeGroup(record.group, false);
      cityLayer.add(nextGroup);
      renderedPatchesRef.current.set(id, { ...record, group: nextGroup });
    }
  }

  function loadTrainModel() {
    const loader = new GLTFLoader();
    loader.load(
      "/models/train-c20.glb",
      (gltf) => {
        trainModelRef.current = optimizeTrainModel(gltf.scene);
        trainPrototypeCache.clear();
        trainModelVersionRef.current += 1;
        clearTrainLayer();
        renderGameLayer();
      },
      undefined,
      (error) => {
        console.warn("Could not load optimized C20 GLB train model", error);
      },
    );
  }

  function drawBuildPreview(gameLayer: THREE.Group, stationPositions: Map<string, THREE.Vector3>) {
    const current = gameRef.current;
    const line = current.lines[current.activeLine];
    const selected = current.selected ? districtById(current.selected) : null;
    if (!line || !selected || current.mode !== "station" || line.stations.includes(selected.id)) return;

    const anchorId = line.anchor && line.stations.includes(line.anchor) ? line.anchor : line.stations.at(-1);
    const from = anchorId ? stationPositions.get(anchorId) : null;
    const to = stationPositions.get(selected.id);
    if (!from || !to) return;

    const preview = createCylinderBetween(from, to, 2.4, line.color, 0.34);
    preview.userData.preview = true;
    gameLayer.add(preview);
  }

  function renderTrainLayer() {
    const trainLayer = trainLayerRef.current;
    if (!trainLayer) return;

    const current = gameRef.current;
    const clock = clockRef.current;
    const stationPositions = stationPositionsRef.current;
    let carIndex = 0;

    for (const line of current.lines) {
      const owned = assignedTrainsets(line);
      if (line.stations.length < 2 || !owned) continue;

      const curve = buildLineCurve(line, stationPositions);
      if (!curve) continue;
      const total = curve.getLength();
      if (!total) continue;

      const lead = routeCurvePhase(curve, total, clock * visualTrainSpeed);
      if (!lead) continue;

      for (let slot = 0; slot < visualTrainCars; slot += 1) {
        const car = getCarAt(trainLayer, carIndex, line.color, trainModelVersionRef.current);
        car.visible = true;
        const carPoint = carPointAtOffset(curve, total, lead, slot * visualCarStride);
        if (!carPoint) {
          car.visible = false;
          continue;
        }
        car.position.copy(carPoint.position).setY(visualTrainHeight);
        const lookAt = carPoint.position.clone().add(carPoint.tangent.multiplyScalar(18));
        car.lookAt(lookAt.x, visualTrainHeight, lookAt.z);
        carIndex += 1;
      }
    }

    while (trainLayer.children.length > carIndex) {
      const child = trainLayer.children.pop();
      if (child) disposeGroup(child);
    }
  }

  function getCarAt(trainLayer: THREE.Group, index: number, lineColor: string, modelVersion: number) {
    const existing = trainLayer.children[index];
    if (
      existing &&
      existing.userData.lineColor === lineColor &&
      existing.userData.modelVersion === modelVersion
    ) {
      existing.scale.setScalar(visualCarScale);
      return existing;
    }

    if (existing) {
      trainLayer.remove(existing);
      disposeGroup(existing);
    }

    const car = createTrainCarMesh(trainModelRef.current, lineColor);
    car.scale.setScalar(visualCarScale);
    car.userData.lineColor = lineColor;
    car.userData.modelVersion = modelVersion;
    trainLayer.children.splice(index, 0, car);
    car.parent = trainLayer;
    return car;
  }

  function clearTrainLayer() {
    const trainLayer = trainLayerRef.current;
    if (!trainLayer) return;
    disposeGroup(trainLayer);
    trainLayer.clear();
  }

  function drawStations(gameLayer: THREE.Group, stationPositions: Map<string, THREE.Vector3>) {
    const current = gameRef.current;
    const currentMetrics = metricsRef.current;
    const sphere = new THREE.SphereGeometry(9, 16, 10);

    for (const district of districts) {
      const position = stationPositions.get(district.id);
      if (!position) continue;

      const served = currentMetrics.served.has(district.id);
      const active = current.selected === district.id;
      const anchor = current.lines[current.activeLine]?.anchor === district.id;
      const color = active ? 0xffffff : served ? 0xf4f6f4 : 0x9da8aa;
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: active ? 0xffffff : served ? 0x25343a : 0x000000,
        emissiveIntensity: active ? 0.42 : 0.18,
        roughness: 0.45,
      });
      const marker = new THREE.Mesh(sphere, material);
      marker.position.copy(position);
      marker.scale.setScalar(anchor ? 1.5 : served ? 1.15 : 0.92);
      marker.userData.district = district;
      stationPickablesRef.current.push(marker);
      stationTargetsRef.current.push({ district, position: position.clone() });
      gameLayer.add(marker);

      const label = createStationLabel(district.name, {
        active,
        served,
        color: active ? "#ffffff" : served ? "#f4f6f4" : "rgba(224, 232, 232, .84)",
      });
      label.position.copy(position).add(new THREE.Vector3(0, active ? 58 : 46, 0));
      stationTargetsRef.current.push({ district, position: label.position.clone() });
      label.renderOrder = 50;
      gameLayer.add(label);
    }
  }

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

  return (
    <div className="map-canvas-wrap three-map-wrap" ref={hostRef}>
      <div className="map-controls" aria-label="3D map controls">
        <button type="button" onClick={() => zoom(1)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoom(-1)} aria-label="Zoom out">-</button>
        <button type="button" onClick={resetView}>Center</button>
      </div>
      <div className="map-attribution">
        {status} · © OpenStreetMap contributors
      </div>
      {mapOverlay !== "none" && (
        <div className="map-legend" aria-label={`${mapOverlay} heatmap legend`}>
          <span>{overlayLabel(mapOverlay)}</span>
          <i />
          <strong>High</strong>
        </div>
      )}
    </div>
  );
}

function createPatchGroup(id: string, data: MapPatchData, overlay: MapOverlay) {
  const group = new THREE.Group();
  group.name = `map-patch:${id}`;

  const buildings = createBuildings(data, overlay);
  if (buildings) group.add(buildings);

  const roads = createRoads(data);
  if (roads) group.add(roads);

  return group;
}

async function loadBasemapTiles(layer: THREE.Group) {
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
      loads.push(loadBasemapTile(loader, layer, tileX, tileY, basemapZoom));
    }
  }

  await Promise.all(loads);
}

function loadBasemapTile(
  loader: THREE.TextureLoader,
  layer: THREE.Group,
  tileX: number,
  tileY: number,
  zoom: number,
) {
  const url = `${basemapTileHost}/${zoom}/${tileX}/${tileY}@2x.png`;
  return new Promise<void>((resolve) => {
    loader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.generateMipmaps = true;

        const mesh = createBasemapTileMesh(tileX, tileY, zoom, texture);
        layer.add(mesh);
        resolve();
      },
      undefined,
      () => resolve(),
    );
  });
}

function createBasemapTileMesh(tileX: number, tileY: number, zoom: number, texture: THREE.Texture) {
  const nw = tileToLonLat(tileX, tileY, zoom);
  const ne = tileToLonLat(tileX + 1, tileY, zoom);
  const se = tileToLonLat(tileX + 1, tileY + 1, zoom);
  const sw = tileToLonLat(tileX, tileY + 1, zoom);
  const nwWorld = stockholmProjection.project(nw.lon, nw.lat);
  const neWorld = stockholmProjection.project(ne.lon, ne.lat);
  const seWorld = stockholmProjection.project(se.lon, se.lat);
  const swWorld = stockholmProjection.project(sw.lon, sw.lat);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        nwWorld.x, 0.1, nwWorld.z,
        swWorld.x, 0.1, swWorld.z,
        neWorld.x, 0.1, neWorld.z,
        seWorld.x, 0.1, seWorld.z,
      ],
      3,
    ),
  );
  geometry.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute(
      [
        0, 1,
        0, 0,
        1, 1,
        1, 0,
      ],
      2,
    ),
  );
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0xffffff,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -10;
  return mesh;
}

function createBuildings(data: MapPatchData, overlay: MapOverlay) {
  const vertices: number[] = [];
  const colors: number[] = [];
  const roofIndices: number[] = [];
  const wallIndices: number[] = [];
  const overlayEnabled = overlay !== "none";

  for (const building of data.buildings) {
    const pointCount = building.p.length / 2;
    if (pointCount < 3) continue;

    const baseIndex = vertices.length / 3;
    const height = building.h * 1.45;
    const contour: THREE.Vector2[] = [];
    const overlayColor = overlayEnabled ? buildingOverlayColor(building.p, overlay) : null;

    for (let i = 0; i < building.p.length; i += 2) {
      const x = building.p[i];
      const z = building.p[i + 1];
      vertices.push(x, 0, z);
      contour.push(new THREE.Vector2(x, z));
      if (overlayColor) colors.push(overlayColor.wall.r, overlayColor.wall.g, overlayColor.wall.b);
    }
    for (let i = 0; i < building.p.length; i += 2) {
      vertices.push(building.p[i], height, building.p[i + 1]);
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
  const roof = heatColor(Math.min(1, normalized * visualVariance));
  const wall = roof.clone().multiplyScalar(value > 0 ? 0.66 : 0.48);
  return { roof, wall };
}

function normalizedOverlayValue(value: number, overlay: Exclude<MapOverlay, "none">) {
  const values = overlayValueSets[overlay];
  const min = values[0] || 0;
  const max = values.at(-1) || 1;
  if (max <= min) return 1;

  const linear = (value - min) / (max - min);
  const rank = values.findIndex((candidate) => candidate >= value);
  const percentile = rank < 0 ? 1 : rank / Math.max(1, values.length - 1);
  return Math.max(0, Math.min(1, linear * 0.38 + percentile * 0.62));
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

function overlayValue(residents: number, jobs: number, overlay: Exclude<MapOverlay, "none">) {
  if (overlay === "homes") return residents;
  if (overlay === "jobs") return jobs;
  return commuteDemandValue(residents, jobs);
}

function commuteDemandValue(residents: number, jobs: number) {
  return Math.round(residents * 0.58 + jobs * 0.82 + Math.sqrt(residents * jobs) * 0.32);
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

function createRoads(data: MapPatchData) {
  const vertices: number[] = [];

  for (const road of data.roads) {
    for (let i = 2; i < road.p.length; i += 2) {
      vertices.push(
        road.p[i - 2],
        1.2,
        road.p[i - 1],
        road.p[i],
        1.2,
        road.p[i + 1],
      );
    }
  }

  if (!vertices.length) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  return new THREE.LineSegments(geometry, roadMaterial);
}

function createCylinderBetween(from: THREE.Vector3, to: THREE.Vector3, radius: number, color: string, opacity: number) {
  const start = from.clone().setY(18);
  const end = to.clone().setY(18);
  const direction = end.clone().sub(start);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 10, 1);
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.2,
    roughness: 0.55,
    transparent: opacity < 1,
    opacity,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

const trainPrototypeCache = new Map<string, THREE.Group>();

function createTrainCarMesh(source: THREE.Group | null, lineColor: string) {
  let prototype = trainPrototypeCache.get(lineColor);
  if (!prototype) {
    prototype = source ? createOptimizedTrainPrototype(source, lineColor) : createTrainPrototype(lineColor);
    trainPrototypeCache.set(lineColor, prototype);
  }

  return prototype.clone(true);
}

function createOptimizedTrainPrototype(source: THREE.Group, lineColor: string) {
  const group = new THREE.Group();
  const car = source.clone(true);
  car.traverse((object) => {
    object.userData.sharedTrainAsset = true;
  });
  car.scale.set(1, 1, 1);
  group.add(car);
  group.traverse((object) => {
    object.userData.sharedTrainAsset = true;
  });
  return group;
}

function optimizeTrainModel(source: THREE.Object3D) {
  source.updateMatrixWorld(true);

  const buckets = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[] }>();
  source.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!material) return;

    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.deleteAttribute("skinIndex");
    geometry.deleteAttribute("skinWeight");
    geometry.deleteAttribute("morphTarget0");

    const key = material.uuid;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        material: optimizeTrainMaterial(material),
        geometries: [],
      };
      buckets.set(key, bucket);
    }
    bucket.geometries.push(geometry);
  });

  const group = new THREE.Group();
  for (const bucket of buckets.values()) {
    const merged = BufferGeometryUtils.mergeGeometries(bucket.geometries, false);
    bucket.geometries.forEach((geometry) => geometry.dispose());
    if (!merged) continue;
    if (!merged.getAttribute("normal")) merged.computeVertexNormals();
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.userData.sharedTrainAsset = true;
    group.add(mesh);
  }

  if (!group.children.length) return createTrainPrototype("#f4f6f4");

  normalizeTrainAxes(group);
  group.traverse((object) => {
    object.userData.sharedTrainAsset = true;
  });
  return group;
}

function normalizeTrainAxes(group: THREE.Group) {
  centerObject(group);
  let size = objectSize(group);

  if (size.y > size.x && size.y > size.z) {
    group.rotation.x = Math.PI / 2;
    group.updateMatrixWorld(true);
    centerObject(group);
    size = objectSize(group);
  }

  if (size.x > size.z) {
    group.rotation.y = Math.PI / 2;
    group.updateMatrixWorld(true);
    centerObject(group);
    size = objectSize(group);
  }

  const targetLength = 220;
  const currentLength = Math.max(1, size.z);
  const scale = targetLength / currentLength;
  group.scale.set(scale, scale, scale * 0.62);
}

function centerObject(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const center = new THREE.Vector3();
  box.getCenter(center);
  object.position.sub(center);
}

function objectSize(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  const size = new THREE.Vector3();
  new THREE.Box3().setFromObject(object).getSize(size);
  return size;
}

function optimizeTrainMaterial(material: THREE.Material) {
  const optimized = material.clone();
  const maybeMapped = optimized as THREE.Material & {
    map?: THREE.Texture;
    emissiveMap?: THREE.Texture;
    normalMap?: THREE.Texture;
    roughnessMap?: THREE.Texture;
    metalnessMap?: THREE.Texture;
  };
  for (const texture of [
    maybeMapped.map,
    maybeMapped.emissiveMap,
    maybeMapped.normalMap,
    maybeMapped.roughnessMap,
    maybeMapped.metalnessMap,
  ]) {
    if (!texture) continue;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
  }
  optimized.depthWrite = true;
  optimized.depthTest = true;
  optimized.needsUpdate = true;
  return optimized;
}

function createTrainPrototype(lineColor: string) {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x2f78ad,
    roughness: 0.44,
    metalness: 0.18,
  });
  const sideMaterial = new THREE.MeshStandardMaterial({
    color: 0xe7eef2,
    roughness: 0.5,
    metalness: 0.08,
  });
  const windowMaterial = new THREE.MeshStandardMaterial({
    color: 0x071018,
    emissive: 0x1b3441,
    emissiveIntensity: 0.45,
    roughness: 0.32,
  });
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: 0x9aa4a5,
    roughness: 0.65,
    metalness: 0.12,
  });
  const lineMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(lineColor),
    transparent: true,
    opacity: 0.85,
  });
  const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xfff1bc });

  const body = new THREE.Mesh(new THREE.BoxGeometry(18, 11, 48), bodyMaterial);
  const sideStripe = new THREE.Mesh(new THREE.BoxGeometry(18.4, 4.1, 35), sideMaterial);
  const windows = new THREE.Mesh(new THREE.BoxGeometry(18.8, 3.1, 28), windowMaterial);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(13, 2.1, 38), roofMaterial);
  const lineGlow = new THREE.Mesh(new THREE.BoxGeometry(20, 0.8, 42), lineMaterial);
  const frontLightLeft = new THREE.Mesh(new THREE.SphereGeometry(1.35, 8, 6), lightMaterial);
  const frontLightRight = new THREE.Mesh(new THREE.SphereGeometry(1.35, 8, 6), lightMaterial);

  sideStripe.position.set(0, 0.4, -1);
  windows.position.set(0, 3.1, -2);
  roof.position.set(0, 6.3, -1);
  lineGlow.position.set(0, -6.2, -1);
  frontLightLeft.position.set(-5.2, 0.5, -24.6);
  frontLightRight.position.set(5.2, 0.5, -24.6);

  group.add(body, sideStripe, windows, roof, lineGlow, frontLightLeft, frontLightRight);
  group.scale.set(4.9, 4.9, 2.2);
  group.traverse((object) => {
    object.userData.sharedTrainAsset = true;
  });
  return group;
}

function createStationLabel(
  text: string,
  options: { active: boolean; served: boolean; color: string },
) {
  const pixelRatio = 2;
  const fontSize = options.active ? 19 : options.served ? 16 : 14;
  const paddingX = 12;
  const paddingY = 7;
  const routeHeight = 0;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas labels are not supported.");

  context.font = `800 ${fontSize * pixelRatio}px Inter, sans-serif`;
  const textWidth = Math.ceil(context.measureText(text).width / pixelRatio);
  const width = Math.min(260, Math.max(72, textWidth + paddingX * 2));
  const height = fontSize + paddingY * 2 + routeHeight;
  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;

  context.scale(pixelRatio, pixelRatio);
  context.font = `800 ${fontSize}px Inter, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = options.active ? "rgba(255, 255, 255, .22)" : "rgba(5, 8, 12, .72)";
  roundedRect(context, 0.5, 0.5, width - 1, height - 1, 5);
  context.fill();
  context.strokeStyle = options.active ? "rgba(255, 255, 255, .56)" : "rgba(255, 255, 255, .12)";
  context.lineWidth = 1;
  roundedRect(context, 0.5, 0.5, width - 1, height - 1, 5);
  context.stroke();

  context.shadowColor = "#000";
  context.shadowBlur = 4;
  context.fillStyle = options.color;
  context.fillText(text, width / 2, height / 2, width - paddingX * 2);

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
  const scale = options.active ? 0.95 : options.served ? 0.78 : 0.68;
  sprite.scale.set(width * scale, height * scale, 1);
  return sprite;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
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

function nearestStationTarget(
  point: { x: number; y: number },
  rect: DOMRect,
  camera: THREE.PerspectiveCamera,
  targets: StationScreenTarget[],
) {
  let best: District | null = null;
  let bestDistance = Infinity;
  const projected = new THREE.Vector3();

  for (const target of targets) {
    projected.copy(target.position).project(camera);
    if (projected.z < -1 || projected.z > 1) continue;

    const x = ((projected.x + 1) / 2) * rect.width;
    const y = ((-projected.y + 1) / 2) * rect.height;
    const threshold = target.district.name.length > 13 ? 48 : 38;
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance < threshold && distance < bestDistance) {
      best = target.district;
      bestDistance = distance;
    }
  }

  return best;
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

function routeSegments(line: Line) {
  const segments: [string, string][] = [];
  for (let i = 1; i < line.stations.length; i += 1) {
    segments.push([line.stations[i - 1], line.stations[i]]);
  }
  return segments.length ? segments : line.segments || [];
}

function buildLineCurve(line: Line, stationPositions: Map<string, THREE.Vector3>) {
  const points = line.stations
    .map((stationId) => stationPositions.get(stationId))
    .filter((point): point is THREE.Vector3 => Boolean(point))
    .map((point) => point.clone());
  if (points.length < 2) return null;
  return new THREE.CatmullRomCurve3(points, false, "centripetal", 0.35);
}

function routeCurvePhase(curve: THREE.CatmullRomCurve3, total: number, distance: number) {
  if (!total) return null;
  const cycle = total * 2;
  const phase = ((distance % cycle) + cycle) % cycle;
  const reversing = phase > total;
  const target = reversing ? cycle - phase : phase;
  return { target, reversing };
}

function carPointAtOffset(
  curve: THREE.CatmullRomCurve3,
  total: number,
  lead: { target: number; reversing: boolean },
  offset: number,
) {
  if (!total) return null;
  const rawTarget = lead.reversing ? lead.target + offset : lead.target - offset;
  const target = Math.max(0, Math.min(total, rawTarget));
  const u = target / total;
  const position = curve.getPointAt(u);
  const tangent = curve.getTangentAt(u);
  if (lead.reversing) tangent.multiplyScalar(-1);
  return { position, tangent, u };
}

function disposeGroup(group: THREE.Object3D, disposeMaterials = true, disposeSharedAssets = false) {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh | THREE.LineSegments;
    if (mesh.userData.sharedTrainAsset && !disposeSharedAssets) return;
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
