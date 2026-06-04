import React, { useEffect, useRef, useState } from "react";
import { districts } from "../data.js";
import { districtById, distance } from "../gameLogic.js";

const width = 1400;
const height = 1000;
const tileSize = 256;
const initialZoom = 12;
const center = { lat: 59.325, lon: 18.055 };
const tileHost = "https://a.basemaps.cartocdn.com/rastertiles/dark_nolabels";

export function CanvasMap({ game, metrics, onDistrictClick }) {
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const clockRef = useRef(0);
  const previousFrameRef = useRef(performance.now());
  const gameRef = useRef(game);
  const metricsRef = useRef(metrics);
  const tileCacheRef = useRef(new Map());
  const dragRef = useRef(null);
  const [viewport, setViewport] = useState(() => ({
    zoom: initialZoom,
    centerPixel: lonLatToPixel(center.lon, center.lat, initialZoom),
  }));
  const viewportRef = useRef(viewport);

  useEffect(() => {
    gameRef.current = game;
    metricsRef.current = metrics;
  }, [game, metrics]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    function render() {
      const now = performance.now();
      if (!gameRef.current.paused) clockRef.current += (now - previousFrameRef.current) / 1000;
      previousFrameRef.current = now;

      draw(ctx, gameRef.current, metricsRef.current, clockRef.current, tileCacheRef.current, viewportRef.current);
      frameRef.current = requestAnimationFrame(render);
    }

    render();
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  function handleClick(event) {
    if (dragRef.current?.dragged) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
    };
    const hit = nearestVisibleDistrict(point, viewportRef.current);
    if (hit.d <= 48) onDistrictClick(hit.district);
  }

  function handlePointerDown(event) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      centerPixel: viewportRef.current.centerPixel,
      dragged: false,
    };
  }

  function handlePointerMove(event) {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    const dx = (event.clientX - drag.x) * scaleX;
    const dy = (event.clientY - drag.y) * scaleY;
    if (Math.hypot(dx, dy) > 4) drag.dragged = true;
    setViewport((current) => ({
      ...current,
      centerPixel: {
        x: drag.centerPixel.x - dx,
        y: drag.centerPixel.y - dy,
      },
    }));
  }

  function handlePointerUp(event) {
    if (dragRef.current?.id === event.pointerId) {
      window.setTimeout(() => {
        dragRef.current = null;
      }, 0);
    }
  }

  function handleWheel(event) {
    event.preventDefault();
    zoomMap(event.deltaY < 0 ? 1 : -1);
  }

  function zoomMap(direction) {
    setViewport((current) => {
      const nextZoom = Math.max(10, Math.min(14, current.zoom + direction));
      if (nextZoom === current.zoom) return current;
      const centerLonLat = pixelToLonLat(current.centerPixel.x, current.centerPixel.y, current.zoom);
      return {
        zoom: nextZoom,
        centerPixel: lonLatToPixel(centerLonLat.lon, centerLonLat.lat, nextZoom),
      };
    });
  }

  function resetView() {
    setViewport({
      zoom: initialZoom,
      centerPixel: lonLatToPixel(center.lon, center.lat, initialZoom),
    });
  }

  return (
    <div className="map-canvas-wrap">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      />
      <div className="map-controls" aria-label="Map controls">
        <button type="button" onClick={() => zoomMap(1)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoomMap(-1)} aria-label="Zoom out">-</button>
        <button type="button" onClick={resetView}>Center</button>
      </div>
      <div className="map-attribution">
        © OpenStreetMap contributors © CARTO
      </div>
    </div>
  );
}

function draw(ctx, game, metrics, trainClock, tileCache, viewport) {
  ctx.clearRect(0, 0, width, height);
  drawTiles(ctx, tileCache, viewport);
  drawMapTone(ctx);
  drawRouteBackplates(ctx, game, viewport);
  drawLines(ctx, game, viewport);
  drawBuildPreview(ctx, game, viewport);
  drawDistricts(ctx, game, metrics, viewport);
  drawTrains(ctx, game, trainClock, viewport);
  drawVignette(ctx);
}

function drawTiles(ctx, tileCache, viewport) {
  const origin = {
    x: viewport.centerPixel.x - width / 2,
    y: viewport.centerPixel.y - height / 2,
  };
  const minTileX = Math.floor(origin.x / tileSize);
  const maxTileX = Math.floor((origin.x + width) / tileSize);
  const minTileY = Math.floor(origin.y / tileSize);
  const maxTileY = Math.floor((origin.y + height) / tileSize);

  ctx.fillStyle = "#10151b";
  ctx.fillRect(0, 0, width, height);

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const image = getTile(tileCache, tileX, tileY, viewport.zoom);
      const x = Math.round(tileX * tileSize - origin.x);
      const y = Math.round(tileY * tileSize - origin.y);
      if (image.complete && image.naturalWidth > 0) {
        ctx.drawImage(image, x, y, tileSize, tileSize);
      } else {
        ctx.fillStyle = "#121820";
        ctx.fillRect(x, y, tileSize, tileSize);
      }
    }
  }
}

function getTile(tileCache, tileX, tileY, zoom) {
  const maxTiles = 2 ** zoom;
  const wrappedX = ((tileX % maxTiles) + maxTiles) % maxTiles;
  const key = `${zoom}/${wrappedX}/${tileY}`;
  if (tileCache.has(key)) return tileCache.get(key);

  const image = new Image();
  image.src = `${tileHost}/${zoom}/${wrappedX}/${tileY}.png`;
  tileCache.set(key, image);
  return image;
}

function drawMapTone(ctx) {
  ctx.fillStyle = "rgba(4, 8, 14, .2)";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(58, 191, 206, .12)";
  ctx.lineWidth = 1;
  for (let x = -40; x < width + 40; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 210, height);
    ctx.stroke();
  }
}

function drawRouteBackplates(ctx, game, viewport) {
  game.lines.forEach((line) => {
    if (line.stations.length < 2) return;
    ctx.strokeStyle = "rgba(0, 0, 0, .7)";
    ctx.lineWidth = 13;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    strokeLinePath(ctx, line, viewport);
  });
}

function drawLines(ctx, game, viewport) {
  game.lines.forEach((line, lineIndex) => {
    if (line.stations.length < 2) return;
    ctx.strokeStyle = line.color;
    ctx.lineWidth = lineIndex === game.activeLine ? 7 : 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = line.color;
    ctx.shadowBlur = lineIndex === game.activeLine ? 12 : 5;
    strokeLinePath(ctx, line, viewport);
    ctx.shadowBlur = 0;
  });
}

function strokeLinePath(ctx, line, viewport) {
  routeSegments(line).forEach(([fromId, toId]) => {
    const from = screenDistrict(districtById(fromId), viewport);
    const to = screenDistrict(districtById(toId), viewport);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  });
}

function drawBuildPreview(ctx, game, viewport) {
  const line = game.lines[game.activeLine];
  const selected = game.selected ? districtById(game.selected) : null;
  if (!selected || !line || game.mode !== "station" || line.stations.includes(selected.id)) return;
  const anchorId = line.anchor && line.stations.includes(line.anchor) ? line.anchor : line.stations.at(-1);
  const from = screenDistrict(districtById(anchorId), viewport);
  const to = screenDistrict(selected, viewport);
  ctx.save();
  ctx.strokeStyle = line.color;
  ctx.lineWidth = 4;
  ctx.setLineDash([12, 12]);
  ctx.shadowColor = line.color;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

function drawDistricts(ctx, game, metrics, viewport) {
  districts.forEach((district) => {
    const point = screenDistrict(district, viewport);
    const served = metrics.served.has(district.id);
    const active = game.selected === district.id;
    const anchor = game.lines[game.activeLine]?.anchor === district.id;
    const express = game.lines.some((line) => line.express.includes(district.id));
    const servingLines = game.lines.filter((line) => line.stations.includes(district.id));

    ctx.beginPath();
    ctx.fillStyle = served ? "#f4f6f4" : "rgba(244, 246, 244, .7)";
    ctx.strokeStyle = active ? "#ffffff" : served ? "#0b1014" : "rgba(10, 14, 18, .9)";
    ctx.lineWidth = active ? 4 : 2;
    ctx.shadowColor = active ? "#ffffff" : "rgba(0,0,0,.85)";
    ctx.shadowBlur = active ? 16 : 6;
    ctx.arc(point.x, point.y, served ? 7 : 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (express) {
      ctx.fillStyle = "#f4d24e";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    if (anchor) {
      ctx.strokeStyle = game.lines[game.activeLine].color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 15, 0, Math.PI * 2);
      ctx.stroke();
    }

    drawStationLabel(ctx, district, point, servingLines, served, active);
  });
}

function drawStationLabel(ctx, district, point, servingLines, served, active) {
  const x = point.x + 12;
  const y = point.y - 16;
  const label = district.name;
  const routeCount = Math.max(1, servingLines.length);
  ctx.font = "800 16px Inter, sans-serif";
  const labelWidth = Math.max(ctx.measureText(label).width + 18, routeCount * 32 + 10);

  ctx.save();
  ctx.textAlign = "left";
  ctx.fillStyle = active ? "rgba(255, 255, 255, .2)" : "rgba(7, 10, 14, .72)";
  ctx.strokeStyle = "rgba(0, 0, 0, .48)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - 6, y - 21, labelWidth, served ? 42 : 24, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = served ? "#f2f6f5" : "rgba(229, 235, 232, .78)";
  ctx.shadowColor = "#000";
  ctx.shadowBlur = 5;
  ctx.fillText(label, x, y - 4);
  ctx.shadowBlur = 0;

  if (served) {
    servingLines.forEach((line, index) => {
      const chipX = x + index * 30;
      ctx.fillStyle = line.color;
      ctx.beginPath();
      ctx.roundRect(chipX, y + 5, 25, 15, 5);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "800 10px Inter, sans-serif";
      ctx.fillText(line.name.replace(/[^A-ZÅÄÖa-zåäö0-9]/g, "").slice(0, 2).toUpperCase(), chipX + 5, y + 16);
    });
  }
  ctx.restore();
}

function drawTrains(ctx, game, trainClock, viewport) {
  game.lines.forEach((line) => {
    const segments = routeSegments(line);
    if (!segments.length) return;
    const owned = assignedTrainsets(line);
    if (!owned) return;
    segments.forEach(([fromId, toId], segmentIndex) => {
      const points = [screenDistrict(districtById(fromId), viewport), screenDistrict(districtById(toId), viewport)];
      const total = distance(points[0], points[1]);
      const trainCount = Math.max(1, Math.ceil(owned / segments.length));
      for (let train = 0; train < trainCount; train += 1) {
        const progress = ((trainClock * 55 + train * total / trainCount + segmentIndex * 43) % total);
        const pos = pointAlong(points, progress);
        ctx.fillStyle = "#f4f6f4";
        ctx.strokeStyle = line.color;
        ctx.lineWidth = 3;
        ctx.shadowColor = line.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.roundRect(pos.x - 11, pos.y - 6, 22, 12, 4);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    });
  });
}

function drawVignette(ctx) {
  const gradient = ctx.createRadialGradient(width * .5, height * .48, 180, width * .5, height * .48, 860);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(.7, "rgba(0,0,0,.08)");
  gradient.addColorStop(1, "rgba(0,0,0,.44)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function nearestVisibleDistrict(point, viewport) {
  return districts
    .map((district) => ({ district, d: distance(point, screenDistrict(district, viewport)) }))
    .sort((a, b) => a.d - b.d)[0];
}

function screenDistrict(district, viewport) {
  const stationPixel = lonLatToPixel(district.lon, district.lat, viewport.zoom);
  return {
    x: stationPixel.x - viewport.centerPixel.x + width / 2,
    y: stationPixel.y - viewport.centerPixel.y + height / 2,
  };
}

function lonLatToPixel(lon, lat, z) {
  const scale = tileSize * 2 ** z;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

function pixelToLonLat(x, y, z) {
  const scale = tileSize * 2 ** z;
  const lon = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lon, lat };
}

function pointAlong(points, target) {
  let travelled = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const len = distance(a, b);
    if (travelled + len >= target) {
      const t = (target - travelled) / len;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    travelled += len;
  }
  return points[0];
}

function routeSegments(line) {
  if (line.segments?.length) return line.segments;
  const segments = [];
  for (let i = 1; i < line.stations.length; i += 1) {
    segments.push([line.stations[i - 1], line.stations[i]]);
  }
  return segments;
}

function assignedTrainsets(line) {
  return Object.values(line.fleet || {}).reduce((sum, count) => sum + count, 0);
}
