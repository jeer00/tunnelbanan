import React, { useEffect, useMemo, useRef, useState } from "react";
import { colors, initialGameState } from "./data";
import {
  applyStationCost,
  applyTrackCost,
  bankruptcyThreshold,
  clearBanner,
  constrainedTrackPoint,
  constrainedTrackPointFromNode,
  createInitialState,
  daysPerMonth,
  dismissUnlockNotification,
  getAllUnlockIds,
  getGoalDefinition,
  getMetrics,
  getUnlockDefinition,
  getUnlockThreshold,
  lineById,
  makeId,
  monthLengthMs,
  nextUnlockToEarn,
  recordConstructionCost,
  recordMonth,
  restartGame,
  restoreSnapshot,
  saveGame,
  serviceQualityOptions,
  setServiceSettings,
  stationById,
  stationPlacementCost,
  togglePause,
  trackNodeCost,
  UNLOCK_DEFINITIONS,
  withSnapshot,
} from "./gameLogic";
import type { BuildMode, GameState, GeoPoint, GoalKind, Line, MapOverlay, PanelId, SnapHint, Station, TrackTool } from "./types";
import logoUrl from "./logo-app.png";

const ThreeMap = React.lazy(() =>
  import("./components/ThreeMap").then((module) => ({ default: module.ThreeMap })),
);

const mapOverlayLabels: Record<MapOverlay, string> = {
  none: "None",
  homes: "Homes",
  jobs: "Jobs",
  demand: "Demand",
  flows: "Flows",
  unmet: "Unmet",
};

const modeLabels: Record<BuildMode, string> = {
  track: "Track",
  station: "Station",
  select: "Select",
};

const modeHints: Record<BuildMode, string> = {
  track: "Drag on the map to draw track. Click a node to set it as anchor. Esc cancels the current line.",
  station: "Click on the map to drop a station (snaps to nearest line). Drag to lay several in a row.",
  select: "Click a station or node to inspect, rename, or delete it.",
};

const panelLabels: Record<PanelId, string> = {
  build: "Build",
  economy: "Economy",
  network: "Network",
  goals: "Goals",
  data: "Data",
  service: "Service",
};

const trackToolLabels: Record<TrackTool, string> = {
  straight: "Straight",
  softCurve: "Soft curve",
  broadCurve: "Broad curve",
};

export default function App() {
  const [game, setGame] = useState<GameState>(createInitialState);
  const [mapOverlay, setMapOverlay] = useState<MapOverlay>("none");
  const [activePanel, setActivePanel] = useState<PanelId | null>("build");
  const metrics = useMemo(() => getMetrics(game), [game]);
  const activeLine = lineById(game.lines, game.activeLineId);
  const selectedStation = stationById(game.stations, game.selectedStationId);

  useEffect(() => {
    saveGame(game);
  }, [game]);

  const [gameSpeed, setGameSpeed] = useState<1 | 2 | 4>(1);
  const tickBarRef = useRef<HTMLDivElement | null>(null);
  const tickLabelRef = useRef<HTMLSpanElement | null>(null);
  const accumulatorRef = useRef(0);
  const lastFrameRef = useRef(Date.now());
  const monthRef = useRef(game.month);
  const lastLiveUpdateRef = useRef(0);
  const gameRef = useRef(game);
  const [liveBudget, setLiveBudget] = useState(game.budget);
  const [liveFraction, setLiveFraction] = useState(0);
  monthRef.current = game.month;
  gameRef.current = game;

  useEffect(() => {
    if (game.gameOver || game.tickPaused) {
      if (tickBarRef.current) tickBarRef.current.style.transform = "scaleX(0)";
      if (tickLabelRef.current) tickLabelRef.current.textContent = "Paused";
      setLiveBudget(game.budget);
      setLiveFraction(0);
      accumulatorRef.current = 0;
      return undefined;
    }
    const interval = monthLengthMs() / gameSpeed;
    lastFrameRef.current = Date.now();

    let rafId = 0;
    function tick() {
      const now = Date.now();
      const delta = now - lastFrameRef.current;
      lastFrameRef.current = now;
      // Cap delta so a long stall (tab switch) doesn't fast-forward months.
      const cappedDelta = Math.min(delta, 250);
      accumulatorRef.current += (cappedDelta / interval) * gameSpeed;

      if (accumulatorRef.current >= 1) {
        const monthsToFire = Math.floor(accumulatorRef.current);
        accumulatorRef.current -= monthsToFire;
        for (let i = 0; i < monthsToFire; i += 1) {
          setGame((current) => {
            if (current.gameOver || current.tickPaused) return current;
            return recordMonth(current);
          });
        }
      }

      const acc = Math.min(1, accumulatorRef.current);
      if (tickBarRef.current) tickBarRef.current.style.transform = `scaleX(${acc})`;
      if (tickLabelRef.current) {
        const remaining = Math.max(0, (1 - accumulatorRef.current) * interval) / 1000;
        const wholeMonth = monthRef.current;
        const day = Math.floor(accumulatorRef.current * daysPerMonth()) + 1;
        tickLabelRef.current.textContent = `Day ${day}/${daysPerMonth()} · M${wholeMonth} · next in ${remaining.toFixed(1)}s`;
      }

      // Throttled live display update (every ~80ms) so budget ticks smoothly
      if (now - lastLiveUpdateRef.current > 80) {
        const current = gameRef.current;
        if (!current.gameOver) {
          const m = getMetrics(current);
          setLiveBudget(Math.round(current.budget + m.netIncome * acc));
          setLiveFraction(acc);
        }
        lastLiveUpdateRef.current = now;
      }

      rafId = window.requestAnimationFrame(tick);
    }
    rafId = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(rafId);
  }, [game.gameOver, game.tickPaused, gameSpeed]);

  useEffect(() => {
    if (!game.bannerMessage) return undefined;
    const id = window.setTimeout(() => {
      setGame((current) => clearBanner(current));
    }, 4500);
    return () => window.clearTimeout(id);
  }, [game.bannerMessage]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePauseNow();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const liveGoals = useMemo(() => {
    return game.goals.map((goal) => {
      if (goal.status !== "active") return goal;
      const def = getGoalDefinition(goal.id as GoalKind);
      const computed = def.compute(game, metrics);
      return { ...goal, current: computed.current, target: computed.target, progressLabel: computed.label };
    });
  }, [game, metrics]);

  const activeGoal = liveGoals.find((goal) => goal.status === "active") || null;
  const completedGoalCount = liveGoals.filter((goal) => goal.status === "complete").length;

  function patchGame(updater: (draft: GameState) => GameState) {
    setGame((current) => updater(structuredClone(current)));
  }

  function togglePauseNow() {
    setGame((current) => {
      if (current.gameOver) return current;
      return togglePause(current);
    });
  }

  function createLine() {
    patchGame((draft) => {
      draft = withSnapshot(draft);
      const lineNumber = draft.lines.length + 1;
      const line: Line = {
        id: makeId("line"),
        name: `Line ${lineNumber}`,
        color: colors[(lineNumber - 1) % colors.length],
        trackTool: "softCurve",
        segmentTools: [],
        path: [],
        stationIds: [],
        frequency: 7,
      };
      draft.lines.push(line);
      draft.activeLineId = line.id;
      draft.selectedTrackNode = null;
      draft.mode = "track";
      draft.hint = `${line.name} created. Drag on the map to draw track.`;
      return draft;
    });
  }

  function handleMapDrawStart(point: GeoPoint, snap: SnapHint | null) {
    if (game.mode === "track") addTrackSample(point, snap);
    else if (game.mode === "station") addStationSample(point, snap);
  }

  function handleMapDrawSample(point: GeoPoint, snap: SnapHint | null) {
    if (game.mode === "track") addTrackSample(point, snap);
    else if (game.mode === "station") addStationSample(point, snap);
  }

  function handleMapDrawEnd() {
    chargeSessionCosts();
    resetDrawSession();
  }

  function handleMapDrawAbort() {
    resetDrawSession();
    patchGame((draft) => ({
      ...draft,
      hint: "Drawing cancelled.",
    }));
  }

  function handleMapDrawUndo() {
    patchGame((draft) => {
      if (draft.gameOver) return draft;
      const line = lineById(draft.lines, draft.activeLineId);
      if (!line || !line.path.length) return draft;
      draft = withSnapshot(draft);
      const active = lineById(draft.lines, draft.activeLineId)!;
      active.path.pop();
      active.segmentTools.pop();
      if (draft.selectedTrackNode?.lineId === active.id && draft.selectedTrackNode.index >= active.path.length) {
        draft.selectedTrackNode = active.path.length ? { lineId: active.id, index: active.path.length - 1 } : null;
      }
      draft.hint = `${active.name} · removed last node.`;
      if (drawSessionRef.current.lineId === active.id) {
        drawSessionRef.current = { ...drawSessionRef.current, startPathLength: active.path.length };
      }
      return draft;
    });
  }

  function handleMapClick(point: { lat: number; lon: number }) {
    if (game.mode === "select") {
      patchGame((draft) => ({ ...draft, selectedStationId: null, selectedTrackNode: null }));
    }
  }

  const drawSessionRef = React.useRef<{
    lineId: string | null;
    captured: boolean;
    startPathLength: number;
    startStationCount: number;
  }>({
    lineId: null,
    captured: false,
    startPathLength: 0,
    startStationCount: 0,
  });

  function resetDrawSession() {
    drawSessionRef.current = { lineId: null, captured: false, startPathLength: 0, startStationCount: 0 };
  }

  function chargeSessionCosts() {
    const session = drawSessionRef.current;
    if (!session.captured || !session.lineId) return;
    const line = lineById(game.lines, session.lineId);
    if (!line) return;
    if (game.mode === "track") {
      const newNodes = line.path.length - session.startPathLength;
      if (newNodes > 0) {
        patchGame((draft) => {
          let next = applyTrackCost(draft, newNodes);
          next = recordConstructionCost(next, newNodes * trackNodeCost());
          return next;
        });
      }
    } else if (game.mode === "station") {
      const newStations = line.stationIds.length - session.startStationCount;
      if (newStations > 0) {
        patchGame((draft) => {
          let next = applyStationCost(draft, newStations);
          next = recordConstructionCost(next, newStations * stationPlacementCost());
          return next;
        });
      }
    }
  }

  function addTrackSample(point: GeoPoint, snap: SnapHint | null = null) {
    patchGame((draft) => {
      const line = ensureActiveLine(draft);
      // If snapped to an existing station, auto-attach the station to the line and end the line there.
      if (snap?.kind === "station") {
        const station = draft.stations.find((s) => s.id === snap.ref);
        if (station && !line.stationIds.includes(station.id)) {
          const isNewSession = drawSessionRef.current.lineId !== line.id || !drawSessionRef.current.captured;
          const snapshotted = isNewSession ? withSnapshot(draft) : draft;
          if (isNewSession) {
            drawSessionRef.current = {
              lineId: line.id,
              captured: true,
              startPathLength: line.path.length,
              startStationCount: line.stationIds.length,
            };
          }
          if (line.path.length < 2) {
            const ok = applyTrackPoint(snapshotted, line, station);
            if (ok && !line.stationIds.includes(station.id)) line.stationIds.push(station.id);
            snapshotted.selectedTrackNode = { lineId: line.id, index: line.path.length - 1 };
            snapshotted.hint = `${line.name} → ${station.name} attached. Keep dragging to extend.`;
            return snapshotted;
          }
          const end = applyTrackPoint(snapshotted, line, station);
          if (end && !line.stationIds.includes(station.id)) line.stationIds.push(station.id);
          snapshotted.selectedTrackNode = { lineId: line.id, index: line.path.length - 1 };
          snapshotted.hint = `${line.name} → ${station.name} attached.`;
          return snapshotted;
        }
      }
      const selectedNode = draft.selectedTrackNode?.lineId === line.id ? draft.selectedTrackNode : null;
      const wouldAdd = selectedNode
        ? constrainedTrackPointFromNode(line, point, selectedNode.index) !== null
        : constrainedTrackPoint(line, point) !== null;
      const isNewSession = drawSessionRef.current.lineId !== line.id || !drawSessionRef.current.captured;
      if (isNewSession) {
        const snapshotted = withSnapshot(draft);
        drawSessionRef.current = {
          lineId: line.id,
          captured: true,
          startPathLength: line.path.length,
          startStationCount: line.stationIds.length,
        };
        if (!wouldAdd) {
          snapshotted.hint = "Track point too close to the previous one. Drag farther.";
          return snapshotted;
        }
        applyTrackPoint(snapshotted, line, point);
        snapshotted.selectedTrackNode = { lineId: line.id, index: line.path.length - 1 };
        snapshotted.hint = line.path.length === 1
          ? `${line.name} started (−${trackNodeCost()} mkr/node).`
          : `${line.name} · ${line.path.length} nodes`;
        return snapshotted;
      }
      if (!wouldAdd) {
        draft.hint = "Track point too close to the previous one. Drag farther.";
        return draft;
      }
      applyTrackPoint(draft, line, point);
      draft.selectedTrackNode = { lineId: line.id, index: line.path.length - 1 };
      draft.hint = `${line.name} · ${line.path.length} nodes`;
      return draft;
    });
  }

  function ensureActiveLine(draft: GameState) {
    let active = lineById(draft.lines, draft.activeLineId);
    if (active) return active;
    const lineNumber = draft.lines.length + 1;
    active = {
      id: makeId("line"),
      name: `Line ${lineNumber}`,
      color: colors[(lineNumber - 1) % colors.length],
      trackTool: "softCurve",
      segmentTools: [],
      path: [],
      stationIds: [],
      frequency: 7,
    };
    draft.lines.push(active);
    draft.activeLineId = active.id;
    return active;
  }

  function applyTrackPoint(draft: GameState, line: Line, point: GeoPoint) {
    const selectedNode = draft.selectedTrackNode?.lineId === line.id ? draft.selectedTrackNode : null;
    const nextPoint = selectedNode
      ? constrainedTrackPointFromNode(line, point, selectedNode.index)
      : constrainedTrackPoint(line, point);
    if (!nextPoint) return false;
    if (!selectedNode || selectedNode.index >= line.path.length - 1) {
      line.path.push(nextPoint);
      line.segmentTools[line.path.length - 2] = line.trackTool;
      draft.selectedTrackNode = { lineId: line.id, index: line.path.length - 1 };
    } else if (selectedNode.index <= 0) {
      line.path.unshift(nextPoint);
      line.segmentTools.unshift(line.trackTool);
      draft.selectedTrackNode = { lineId: line.id, index: 0 };
    } else {
      line.path.splice(selectedNode.index + 1, 0, nextPoint);
      line.segmentTools.splice(selectedNode.index, 0, line.trackTool);
      draft.selectedTrackNode = { lineId: line.id, index: selectedNode.index + 1 };
    }
    return true;
  }

  function selectTrackNode(lineId: string, index: number) {
    patchGame((draft) => {
      const line = lineById(draft.lines, lineId);
      if (!line) return draft;
      return withSnapshot({
        ...draft,
        activeLineId: lineId,
        selectedTrackNode: { lineId, index },
        selectedStationId: null,
        mode: "track",
        hint: index === 0
          ? `${line.name} · editing from the first node.`
          : index === line.path.length - 1
            ? `${line.name} · editing from the last node.`
            : `${line.name} · editing from node ${index + 1}. Drag on the map to extend.`,
      });
    });
    setActivePanel("build");
  }

  function addStationSample(point: GeoPoint, snap: SnapHint | null = null) {
    patchGame((draft) => {
      const line = ensureActiveLine(draft);
      // If the user dropped on an existing station while in station mode, ignore the duplicate.
      if (snap?.kind === "station") {
        const existing = draft.stations.find((s) => s.id === snap.ref);
        if (existing) {
          if (!line.stationIds.includes(existing.id)) line.stationIds.push(existing.id);
          draft.selectedStationId = existing.id;
          draft.hint = `${existing.name} attached to ${line.name}.`;
          return draft;
        }
      }
      const placement = stationPlacementPoint(line, point);
      if (!placement) {
        draft.hint = `Click closer to ${line.name} to place a station.`;
        return draft;
      }
      const isNewSession = drawSessionRef.current.lineId !== line.id || !drawSessionRef.current.captured;
      if (isNewSession) {
        const snapshotted = withSnapshot(draft);
        drawSessionRef.current = {
          lineId: line.id,
          captured: true,
          startPathLength: line.path.length,
          startStationCount: line.stationIds.length,
        };
        placeStation(snapshotted, line, placement);
        return snapshotted;
      }
      placeStation(draft, line, placement);
      return draft;
    });
  }

  function placeStation(draft: GameState, line: Line, placement: { point: GeoPoint; snapped: boolean }) {
    const station: Station = {
      id: makeId("station"),
      name: `Station ${draft.stations.length + 1}`,
      lat: placement.point.lat,
      lon: placement.point.lon,
    };
    draft.stations.push(station);
    line.stationIds.push(station.id);
    if (line.path.length === 0) line.path.push(placement.point);
    draft.selectedStationId = station.id;
    draft.selectedTrackNode = null;
    draft.hint = placement.snapped
      ? `${station.name} snapped onto ${line.name}.`
      : `${station.name} added to ${line.name}.`;
  }

  function selectStation(stationId: string) {
    patchGame((draft) => ({
      ...draft,
      selectedStationId: stationId,
      selectedTrackNode: null,
      mode: "select",
      hint: `${stationById(draft.stations, stationId)?.name || "Station"} selected.`,
    }));
    setActivePanel("build");
  }

  function renameStation(name: string) {
    patchGame((draft) => {
      const station = stationById(draft.stations, draft.selectedStationId);
      if (!station) return draft;
      station.name = name || "Unnamed station";
      draft.hint = `${station.name} renamed.`;
      return draft;
    });
  }

  function deleteStation() {
    if (!selectedStation) return;
    patchGame((draft) => {
      draft = withSnapshot(draft);
      const id = draft.selectedStationId;
      const name = stationById(draft.stations, id)?.name || "Station";
      draft.stations = draft.stations.filter((station) => station.id !== id);
      draft.lines = draft.lines.map((line) => ({
        ...line,
        stationIds: line.stationIds.filter((stationId) => stationId !== id),
      }));
      draft.selectedStationId = null;
      draft.hint = `${name} deleted.`;
      return draft;
    });
  }

  function updateActiveLine(updates: Partial<Line>) {
    patchGame((draft) => {
      const line = lineById(draft.lines, draft.activeLineId);
      if (!line) return draft;
      Object.assign(line, updates);
      draft.hint = `${line.name} updated.`;
      return draft;
    });
  }

  function removeLastTrackPoint() {
    if (!activeLine?.path.length) return;
    patchGame((draft) => {
      draft = withSnapshot(draft);
      const line = lineById(draft.lines, draft.activeLineId);
      if (!line) return draft;
      line.path.pop();
      line.segmentTools.pop();
      if (draft.selectedTrackNode?.lineId === line.id && draft.selectedTrackNode.index >= line.path.length) {
        draft.selectedTrackNode = line.path.length ? { lineId: line.id, index: line.path.length - 1 } : null;
      }
      draft.hint = `${line.name} track point removed.`;
      return draft;
    });
  }

  function deleteActiveLine() {
    if (!activeLine) return;
    patchGame((draft) => {
      draft = withSnapshot(draft);
      const name = lineById(draft.lines, draft.activeLineId)?.name || "Line";
      draft.lines = draft.lines.filter((line) => line.id !== draft.activeLineId);
      draft.activeLineId = draft.lines[0]?.id || null;
      draft.selectedStationId = null;
      draft.selectedTrackNode = null;
      draft.hint = `${name} deleted.`;
      return removeOrphanStations(draft);
    });
  }

  function appendSelectedStationToLine() {
    if (!selectedStation || !activeLine) return;
    patchGame((draft) => {
      draft = withSnapshot(draft);
      const line = lineById(draft.lines, draft.activeLineId);
      if (!line || line.stationIds.includes(selectedStation.id)) return draft;
      line.stationIds.push(selectedStation.id);
      draft.hint = `${selectedStation.name} added to ${line.name}.`;
      return draft;
    });
  }

  function setMode(mode: BuildMode) {
    resetDrawSession();
    patchGame((draft) => ({
      ...draft,
      mode,
      selectedTrackNode: mode === "track" ? draft.selectedTrackNode : null,
      selectedStationId: mode === "select" ? draft.selectedStationId : null,
      hint: modeHints[mode],
    }));
  }

  function updateService(patch: Parameters<typeof setServiceSettings>[1]) {
    setGame((current) => setServiceSettings(current, patch));
  }

  function dismissUnlock(id: string) {
    setGame((current) => dismissUnlockNotification(current, id as never));
  }

  const nextUnlock = useMemo(() => nextUnlockToEarn(game), [game]);

  function updateSelectedSectionTool(tool: TrackTool) {
    if (!activeLine || !game.selectedTrackNode || game.selectedTrackNode.lineId !== activeLine.id) return;
    const index = game.selectedTrackNode.index;
    if (index >= activeLine.path.length - 1) return;
    patchGame((draft) => {
      const line = lineById(draft.lines, draft.activeLineId);
      if (!line) return draft;
      line.segmentTools[index] = tool;
      line.trackTool = tool;
      draft.hint = `${line.name} section after node ${index + 1} set to ${trackToolLabels[tool]}.`;
      return draft;
    });
  }

  function undo() {
    patchGame((draft) => restoreSnapshot(draft));
  }

  function reset() {
    const fresh = restartGame();
    setGame(fresh);
    setActivePanel("build");
    setLiveBudget(fresh.budget);
    setLiveFraction(0);
    accumulatorRef.current = 0;
    lastFrameRef.current = Date.now();
    lastLiveUpdateRef.current = 0;
    if (tickBarRef.current) tickBarRef.current.style.transform = "scaleX(0)";
    if (tickLabelRef.current) {
      const monthLen = monthLengthMs() / 1000;
      tickLabelRef.current.textContent = `Day 1/${daysPerMonth()} · M${fresh.month} · next in ${monthLen.toFixed(1)}s`;
    }
  }

  return (
    <main className="map-app-shell">
      <div className={`tick-bar ${game.tickPaused ? "paused" : "playing"} ${game.gameOver ? "gameover" : ""}`} aria-hidden={!!game.gameOver}>
        <div className="tick-bar-fill" ref={tickBarRef} />
      </div>
      <div className={`tick-label ${game.tickPaused ? "paused" : ""}`}>
        <span ref={tickLabelRef}>{game.tickPaused ? "Paused" : "Day 1/30 · M1 · next in 0.0s"}</span>
      </div>

      <section className="map-area full-map" aria-label="Stockholm game map">
        <React.Suspense fallback={<div className="map-loading">Loading 3D map...</div>}>
          <ThreeMap
            game={game}
            mapOverlay={mapOverlay}
            metrics={metrics}
            mode={game.mode}
            activeLineColor={activeLine?.color || "#41a85f"}
            trackNodeCost={trackNodeCost()}
            stationPlacementCost={stationPlacementCost()}
            onMapClick={handleMapClick}
            onMapDrawStart={handleMapDrawStart}
            onMapDrawSample={handleMapDrawSample}
            onMapDrawEnd={handleMapDrawEnd}
            onMapDrawAbort={handleMapDrawAbort}
            onMapDrawUndo={handleMapDrawUndo}
            onStationClick={selectStation}
            onTrackNodeClick={selectTrackNode}
          />
        </React.Suspense>
      </section>

      <header className="floating-topbar">
        <div className="brand compact-brand">
          <div className="brand-lockup">
            <img className="brand-logo" src={logoUrl} alt="" aria-hidden="true" />
            <div>
              <p className="kicker">Stockholm network</p>
              <h1>Subwayer</h1>
            </div>
          </div>
        </div>
        <div className="topbar-metrics">
          <Metric label="Day" value={`${Math.floor(liveFraction * daysPerMonth()) + 1}/${daysPerMonth()} · M${game.month}`} />
          <Metric label="Budget" value={`${liveBudget} mkr`} />
          <Metric label="Riders" value={metrics.riders.toLocaleString("en-US")} />
          <Metric label="Net" value={`${metrics.netIncome} mkr`} />
          <Metric label="Score" value={metrics.score.toLocaleString("en-US")} />
        </div>
        <div className="topbar-actions">
          <div className="speed-selector" role="group" aria-label="Game speed">
            {([1, 2, 4] as const).map((speed) => (
              <button
                key={speed}
                className={gameSpeed === speed ? "active" : ""}
                type="button"
                disabled={!!game.gameOver}
                onClick={() => setGameSpeed(speed)}
                aria-pressed={gameSpeed === speed}
                title={`${speed}× speed`}
              >
                {speed}×
              </button>
            ))}
          </div>
          <button
            className={`play-pause ${game.tickPaused ? "paused" : "playing"}`}
            type="button"
            disabled={!!game.gameOver}
            onClick={togglePauseNow}
            aria-pressed={game.tickPaused}
            aria-label={game.tickPaused ? "Resume game" : "Pause game"}
            title="Space"
          >
            {game.tickPaused ? (
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor" /></svg>
            ) : (
              <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="2.5" width="3" height="11" fill="currentColor" /><rect x="9.5" y="2.5" width="3" height="11" fill="currentColor" /></svg>
            )}
            <span>{game.tickPaused ? "Resume" : "Pause"}</span>
          </button>
          <button className="danger" type="button" onClick={reset}>Reset</button>
        </div>
      </header>

      <nav className="floating-nav" aria-label="Management panels">
        {(Object.keys(panelLabels) as PanelId[]).map((panel) => (
          <button
            className={activePanel === panel ? "active" : ""}
            key={panel}
            type="button"
            onClick={() => setActivePanel(activePanel === panel ? null : panel)}
          >
            {panelLabels[panel]}
          </button>
        ))}
      </nav>

      {activePanel && (
        <aside className="floating-panel" aria-label={`${panelLabels[activePanel]} panel`}>
          {activePanel === "build" && (
            <>
              <PanelHead title="Build" detail={modeLabels[game.mode]} />
              <div className="segmented" role="group" aria-label="Build mode">
                {(Object.keys(modeLabels) as BuildMode[]).map((mode) => (
                  <button
                    className={game.mode === mode ? "active" : ""}
                    key={mode}
                    type="button"
                    onClick={() => setMode(mode)}
                  >
                    {modeLabels[mode]}
                  </button>
                ))}
              </div>
              <div className="panel-section">
                <PanelHead title="Data layer" detail={mapOverlayLabels[mapOverlay]} />
                <div className="segmented overlay-segmented" role="group" aria-label="Map data layer">
                  {(Object.keys(mapOverlayLabels) as MapOverlay[]).map((overlay) => (
                    <button
                      className={mapOverlay === overlay ? "active" : ""}
                      key={overlay}
                      type="button"
                      onClick={() => setMapOverlay(overlay)}
                    >
                      {mapOverlayLabels[overlay]}
                    </button>
                  ))}
                </div>
              </div>
              {activeGoal && (
                <div className="goal-card status-active panel-section">
                  <div className="goal-card-head">
                    <strong>Goal {completedGoalCount + 1}/{liveGoals.length} · {getGoalDefinition(activeGoal.id as GoalKind).title}</strong>
                    <span className="goal-status-pill goal-pill-active">+{getGoalDefinition(activeGoal.id as GoalKind).reward} mkr</span>
                  </div>
                  <p className="goal-desc">{getGoalDefinition(activeGoal.id as GoalKind).description}</p>
                  <div className="goal-progress" aria-label={`${activeGoal.current}/${activeGoal.target}`}>
                    <div className="goal-progress-fill" style={{ width: `${Math.min(100, Math.round((activeGoal.current / activeGoal.target) * 100))}%` }} />
                  </div>
                  <div className="goal-progress-meta">
                    <span>{activeGoal.progressLabel || `${activeGoal.current}/${activeGoal.target}`}</span>
                  </div>
                </div>
              )}
              <div className="button-row">
                <button className="primary" type="button" onClick={createLine}>New line</button>
                <button type="button" disabled={!game.history.length} onClick={undo}>Undo</button>
              </div>

              <div className="panel-section">
                <PanelHead title="Active line" detail={activeLine ? `${activeLine.path.length} track nodes` : "None"} />
                {activeLine ? (
                  <>
                    <label className="field">
                      <span>Line name</span>
                      <input type="text" value={activeLine.name} onChange={(event) => updateActiveLine({ name: event.target.value })} />
                    </label>
                    <label className="field range-field">
                      <span>Frequency <strong>{activeLine.frequency} min</strong></span>
                      <input type="range" min="3" max="14" value={activeLine.frequency} onChange={(event) => updateActiveLine({ frequency: Number(event.target.value) })} />
                    </label>
                    <div className="tool-buttons" role="group" aria-label="Default curve">
                      {(Object.keys(trackToolLabels) as TrackTool[]).map((tool) => (
                        <button
                          className={activeLine.trackTool === tool ? "active" : ""}
                          key={tool}
                          type="button"
                          onClick={() => updateActiveLine({ trackTool: tool })}
                        >
                          {trackToolLabels[tool]}
                        </button>
                      ))}
                    </div>
                    <div className="draw-rules">
                      <span>
                        {game.mode === "track"
                          ? `Track ready · ${trackRuleText(activeLine.trackTool)}`
                          : game.mode === "station"
                            ? "Stations snap to the active line"
                            : "Pick stations or nodes from the map"}
                      </span>
                      <span>{activeLine.path.length} nodes, {activeLine.stationIds.length} stations</span>
                    </div>
                    {game.selectedTrackNode?.lineId === activeLine.id ? (
                      <div className="node-card">
                        <strong>Node {game.selectedTrackNode.index + 1}</strong>
                        <span>
                          {game.selectedTrackNode.index === 0
                            ? "Beginning anchor"
                            : game.selectedTrackNode.index === activeLine.path.length - 1
                              ? "End anchor"
                              : "Insertion anchor"}
                        </span>
                        {game.selectedTrackNode.index < activeLine.path.length - 1 && (
                          <>
                            <small>Curve section after this node</small>
                            <div className="tool-buttons compact-tools" role="group" aria-label="Section curve">
                              {(Object.keys(trackToolLabels) as TrackTool[]).map((tool) => (
                                <button
                                  className={(activeLine.segmentTools[game.selectedTrackNode.index] || activeLine.trackTool) === tool ? "active" : ""}
                                  key={tool}
                                  type="button"
                                  onClick={() => updateSelectedSectionTool(tool)}
                                >
                                  {trackToolLabels[tool]}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="empty-state">Click a track node to set it as the drawing anchor. Then drag on the map to extend from there.</div>
                    )}
                    <div className="swatches" aria-label="Line color">
                      {colors.map((color) => (
                        <button
                          aria-label={`Use ${color}`}
                          className={activeLine.color === color ? "active" : ""}
                          key={color}
                          style={{ "--swatch": color } as React.CSSProperties}
                          type="button"
                          onClick={() => updateActiveLine({ color })}
                        />
                      ))}
                    </div>
                    <div className="button-row">
                      <button type="button" disabled={!activeLine.path.length} onClick={removeLastTrackPoint}>Remove node</button>
                      <button className="danger" type="button" onClick={deleteActiveLine}>Delete line</button>
                    </div>
                  </>
                ) : (
                  <div className="empty-state">Create a line, then drag on the map to draw its route. Use Station mode to place stops on the line.</div>
                )}
              </div>

              <div className="panel-section">
                <PanelHead title="Station" detail={selectedStation ? "Selected" : "None"} />
                {selectedStation ? (
                  <>
                    <label className="field">
                      <span>Station name</span>
                      <input type="text" value={selectedStation.name} onChange={(event) => renameStation(event.target.value)} />
                    </label>
                    <div className="button-row">
                      <button type="button" disabled={!activeLine || activeLine.stationIds.includes(selectedStation.id)} onClick={appendSelectedStationToLine}>
                        Add to line
                      </button>
                      <button className="danger" type="button" onClick={deleteStation}>Delete</button>
                    </div>
                  </>
                ) : (
                  <div className="empty-state">Switch to Station mode and click on or near the active line. Drag to lay several stations in a row. Existing stations can be selected and renamed here.</div>
                )}
              </div>
            </>
          )}

          {activePanel === "economy" && (
            <>
              <PanelHead title="Economy" detail={`Day ${Math.floor(liveFraction * daysPerMonth()) + 1}/${daysPerMonth()} · M${game.month} · ${gameSpeed}×`} />
              <MiniChart data={game.economyHistory} />
              <div className="finance-grid">
                <div><span>Revenue</span><strong>{metrics.monthlyRevenue} mkr</strong></div>
                <div><span>Ops</span><strong>{metrics.operatingCost} mkr</strong></div>
                <div><span>Net/cycle</span><strong>{metrics.netIncome} mkr</strong></div>
                <div><span>Served trips</span><strong>{metrics.servedTrips.toLocaleString("en-US")} / {metrics.totalTrips.toLocaleString("en-US")}</strong></div>
                <div><span>Flow coverage</span><strong>{metrics.flowCoverage}%</strong></div>
                <div><span>Unmet trips</span><strong>{metrics.unmetDemand.toLocaleString("en-US")}</strong></div>
              </div>
              <div className="finance-grid panel-section">
                <div><span>Station cost</span><strong>{stationPlacementCost()} mkr</strong></div>
                <div><span>Track cost</span><strong>{trackNodeCost()} mkr / node</strong></div>
                <div><span>Cycle length</span><strong>{(monthLengthMs() / 1000).toFixed(1)}s</strong></div>
                <div><span>Bankrupt at</span><strong>{bankruptcyThreshold()} mkr</strong></div>
              </div>
              <div className="button-row">
                <button type="button" onClick={togglePauseNow} disabled={!!game.gameOver}>
                  {game.tickPaused ? "Resume" : "Pause"}
                </button>
                <div className="speed-selector" role="group" aria-label="Game speed">
                  {([1, 2, 4] as const).map((speed) => (
                    <button
                      key={speed}
                      className={gameSpeed === speed ? "active" : ""}
                      type="button"
                      disabled={!!game.gameOver}
                      onClick={() => setGameSpeed(speed)}
                      aria-pressed={gameSpeed === speed}
                    >
                      {speed}×
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {activePanel === "network" && (
            <>
              <PanelHead title="Network" detail={`${metrics.routeLengthKm} km`} />
              <div className="line-list">
                {game.lines.length ? game.lines.map((line) => (
                  <button
                    className={line.id === game.activeLineId ? "planner-line active" : "planner-line"}
                    key={line.id}
                    style={{ "--line-color": line.color } as React.CSSProperties}
                    type="button"
                    onClick={() => {
                      resetDrawSession();
                      patchGame((draft) => ({
                        ...draft,
                        activeLineId: line.id,
                        selectedTrackNode: null,
                        selectedStationId: null,
                        mode: "track",
                        hint: `${line.name} active. Drag on the map to extend it.`,
                      }));
                    }}
                  >
                    <i />
                    <span>{line.name}</span>
                    <small>{line.stationIds.length}</small>
                  </button>
                )) : <div className="empty-state">No lines yet. Use New line above to start.</div>}
              </div>
              <div className="finance-grid panel-section">
                <div><span>Stations</span><strong>{metrics.stationCount}</strong></div>
                <div><span>Lines</span><strong>{metrics.lineCount}</strong></div>
                <div><span>Coverage</span><strong>{metrics.coverage}%</strong></div>
                <div><span>Interchanges</span><strong>{metrics.interchangeCount}</strong></div>
              </div>
            </>
          )}

          {activePanel === "goals" && (
            <>
              <PanelHead title="Goals" detail={`${completedGoalCount}/${liveGoals.length} complete`} />
              <div className="goals-list">
                {liveGoals.map((goal) => {
                  const def = getGoalDefinition(goal.id as GoalKind);
                  const ratio = goal.target > 0 ? Math.min(1, goal.current / goal.target) : 0;
                  return (
                    <div key={goal.id} className={`goal-card status-${goal.status}`}>
                      <div className="goal-card-head">
                        <strong>{def.title}</strong>
                        <span className={`goal-status-pill goal-pill-${goal.status}`}>
                          {goal.status === "complete"
                            ? "Done"
                            : goal.status === "active"
                              ? "Active"
                              : "Locked"}
                        </span>
                      </div>
                      <p className="goal-desc">{def.description}</p>
                      <div className="goal-progress" aria-label={`${goal.current}/${goal.target}`}>
                        <div className="goal-progress-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
                      </div>
                      <div className="goal-progress-meta">
                        <span>{goal.progressLabel || `${goal.current}/${goal.target}`}</span>
                        <span>+{def.reward} mkr</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="empty-state">
                Reach each goal to unlock the next. Stay profitable long enough to keep the budget above {bankruptcyThreshold()} mkr — bankruptcy ends the game.
              </div>
            </>
          )}

          {activePanel === "data" && (
            <>
              <PanelHead title="Data Layers" detail={mapOverlayLabels[mapOverlay]} />
              <div className="segmented overlay-segmented" role="group" aria-label="Map filter">
                {(Object.keys(mapOverlayLabels) as MapOverlay[]).map((overlay) => (
                  <button
                    className={mapOverlay === overlay ? "active" : ""}
                    key={overlay}
                    type="button"
                    onClick={() => setMapOverlay(overlay)}
                  >
                    {mapOverlayLabels[overlay]}
                  </button>
                ))}
              </div>
              <div className="empty-state">Homes/jobs/demand are aggregate area data. Building colors are only a visual fill, not house-level data.</div>
            </>
          )}

          {activePanel === "service" && (
            <>
              <PanelHead title="Service" detail={`Score ${metrics.score.toLocaleString("en-US")}`} />
              <p className="empty-state">Tune ticket price, train frequency, and service quality. Changes apply next month-tick. Watch the news ticker for events that affect demand.</p>

              <div className="panel-section">
                <label className="field range-field">
                  <span>Ticket price <strong>{game.serviceSettings.ticketPrice.toFixed(3)} mkr / trip</strong></span>
                  <input
                    type="range"
                    min="0.001"
                    max="0.01"
                    step="0.0005"
                    value={game.serviceSettings.ticketPrice}
                    onChange={(e) => updateService({ ticketPrice: Number(e.target.value) })}
                  />
                </label>
                <small className="field-hint">Lower = more riders, higher = more revenue per rider. Price elasticity applies.</small>
              </div>

              <div className="panel-section">
                <label className="field range-field">
                  <span>Train frequency <strong>every {Math.round(60 / game.serviceSettings.trainFrequency)} min</strong></span>
                  <input
                    type="range"
                    min="1"
                    max={game.unlocks.signaling ? 20 : (game.unlocks.doubleTrack ? 12 : 8)}
                    step="1"
                    value={game.serviceSettings.trainFrequency}
                    onChange={(e) => updateService({ trainFrequency: Number(e.target.value) })}
                  />
                </label>
                <small className="field-hint">
                  {game.unlocks.signaling
                    ? "Signaling unlocked — up to 20 trains/hour."
                    : game.unlocks.doubleTrack
                      ? "Double-track unlocked — up to 12 trains/hour."
                      : "Up to 8 trains/hour. Unlock Double-track or Signaling for more."}
                </small>
              </div>

              <div className="panel-section">
                <PanelHead title="Service quality" detail={serviceQualityOptions()[game.serviceSettings.serviceQuality as "basic" | "comfortable" | "premium"].label} />
                <div className="segmented" role="group" aria-label="Service quality">
                  {(Object.keys(serviceQualityOptions()) as Array<keyof typeof serviceQualityOptions extends never ? never : "basic" | "comfortable" | "premium">).map((q) => {
                    const opt = serviceQualityOptions()[q as "basic" | "comfortable" | "premium"];
                    return (
                      <button
                        key={q}
                        className={game.serviceSettings.serviceQuality === q ? "active" : ""}
                        type="button"
                        onClick={() => updateService({ serviceQuality: q as "basic" | "comfortable" | "premium" })}
                      >
                        <strong>{opt.label}</strong>
                        <small>×{opt.ridership} riders · ×{opt.cost} ops</small>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="panel-section">
                <PanelHead title="Unlocks" detail={nextUnlock ? `${metrics.score.toLocaleString("en-US")} / ${nextUnlock.threshold.toLocaleString("en-US")}` : "All unlocked"} />
                <div className="unlock-list">
                  {getAllUnlockIds().map((id) => {
                    const def = getUnlockDefinition(id);
                    const threshold = getUnlockThreshold(id);
                    const earned = game.unlocks[id];
                    const progress = earned ? 1 : Math.min(1, metrics.score / threshold);
                    return (
                      <div key={id} className={`unlock-row ${earned ? "earned" : ""}`}>
                        <div className="unlock-row-head">
                          <strong>{def.icon} {def.title}</strong>
                          <span>{earned ? "Unlocked" : `${metrics.score.toLocaleString("en-US")} / ${threshold.toLocaleString("en-US")}`}</span>
                        </div>
                        <p className="unlock-desc">{def.description}</p>
                        <div className="goal-progress" aria-label={`${id} progress`}>
                          <div className="goal-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </aside>
      )}

      <div className="floating-hint">
        <strong>{game.hint}</strong>
        <span>{activeLine ? `${activeLine.name} active` : "No active line"}</span>
      </div>

      {game.bannerMessage && !game.gameOver && (
        <div className="banner-toast" role="status" aria-live="polite">
          <span>{game.bannerMessage}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setGame((current) => clearBanner(current))}>×</button>
        </div>
      )}

      {game.unlockNotifications.length > 0 && !game.gameOver && (
        <div className="unlock-toast-stack" role="status" aria-live="polite">
          {game.unlockNotifications.slice(-3).map((n) => {
            const def = UNLOCK_DEFINITIONS[n.id];
            return (
              <div key={n.id} className="unlock-toast">
                <span className="unlock-toast-icon">{def.icon}</span>
                <div>
                  <strong>Unlocked: {n.title}</strong>
                  <small>{n.description}</small>
                </div>
                <button type="button" aria-label="Dismiss" onClick={() => dismissUnlock(n.id)}>×</button>
              </div>
            );
          })}
        </div>
      )}

      {game.events.length > 0 && !game.gameOver && (
        <div className="news-ticker" role="status" aria-live="polite">
          {game.events.map((evt) => (
            <div key={evt.id} className={`news-item news-${evt.type}`}>
              <span className="news-tag">
                {evt.type === "demand-spike" ? "📈" : evt.type === "season" ? "🌦" : evt.type === "development" ? "🏗" : "⚠"}
              </span>
              <span><strong>{evt.title}</strong> · {evt.message}</span>
              <span className="news-duration">{evt.duration}d</span>
            </div>
          ))}
        </div>
      )}

      {game.newsTicker.length > 0 && !game.gameOver && (
        <details className="news-history">
          <summary>News history ({game.newsTicker.length})</summary>
          <ul>
            {[...game.newsTicker].reverse().slice(0, 12).map((entry) => (
              <li key={entry.id}>M{entry.month} · {entry.message}</li>
            ))}
          </ul>
        </details>
      )}

      {game.gameOver && (
        <div className="gameover-overlay" role="dialog" aria-modal="true" aria-labelledby="gameover-title">
          <div className="gameover-card">
            <p className="kicker">Game over</p>
            <h2 id="gameover-title">Bankrupt</h2>
            <div className="finance-grid">
              <div><span>Day</span><strong>{`${daysPerMonth()}/${daysPerMonth()} · M${game.gameOver.month}`}</strong></div>
              <div><span>Budget</span><strong>{Math.round(game.gameOver.budget)} mkr</strong></div>
              <div><span>Riders</span><strong>{metrics.riders.toLocaleString("en-US")}</strong></div>
              <div><span>Score</span><strong>{metrics.score.toLocaleString("en-US")}</strong></div>
            </div>
            <p className="empty-state">{game.gameOver.message}</p>
            <div className="button-row">
              <button className="primary" type="button" onClick={reset}>Try again</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function removeOrphanStations(game: GameState) {
  const used = new Set(game.lines.flatMap((line) => line.stationIds));
  game.stations = game.stations.filter((station) => used.has(station.id));
  return game;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PanelHead({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      <span>{detail}</span>
    </div>
  );
}

function trackRuleText(tool: TrackTool) {
  if (tool === "straight") return "45 deg snap, firm turns";
  if (tool === "broadCurve") return "15 deg snap, broad turns";
  return "30 deg snap, balanced turns";
}

function stationPlacementPoint(line: Line, point: { lat: number; lon: number }) {
  if (line.path.length < 2) return { point, snapped: false };

  let best: { point: { lat: number; lon: number }; distance: number } | null = null;
  const target = geoToLocalMeters(point);
  for (let i = 1; i < line.path.length; i += 1) {
    const from = geoToLocalMeters(line.path[i - 1]);
    const to = geoToLocalMeters(line.path[i]);
    const candidate = closestPointOnSegment(target, from, to);
    const distance = Math.hypot(target.x - candidate.x, target.y - candidate.y);
    if (!best || distance < best.distance) {
      best = { point: localMetersToGeo(candidate), distance };
    }
  }

  if (!best || best.distance > 180) return null;
  return { point: best.point, snapped: true };
}

function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const aMeters = geoToLocalMeters(a);
  const bMeters = geoToLocalMeters(b);
  return Math.hypot(aMeters.x - bMeters.x, aMeters.y - bMeters.y);
}

function geoToLocalMeters(point: { lat: number; lon: number }) {
  const referenceLat = 59.33;
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = Math.cos((referenceLat * Math.PI) / 180) * 111320;
  return {
    x: point.lon * metersPerDegreeLon,
    y: point.lat * metersPerDegreeLat,
  };
}

function localMetersToGeo(point: { x: number; y: number }) {
  const referenceLat = 59.33;
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = Math.cos((referenceLat * Math.PI) / 180) * 111320;
  return {
    lon: point.x / metersPerDegreeLon,
    lat: point.y / metersPerDegreeLat,
  };
}

function closestPointOnSegment(
  point: { x: number; y: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return from;
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
  return {
    x: from.x + dx * t,
    y: from.y + dy * t,
  };
}

function MiniChart({ data }: { data: GameState["economyHistory"] }) {
  const rows = data.length ? data : [{ month: 1, day: 30, revenue: 0, operatingCost: 0, netIncome: 0 }];
  const values = rows.flatMap((row) => [row.revenue, row.operatingCost, row.netIncome]);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const range = max - min || 1;
  const series: Array<[keyof typeof rows[number], string]> = [
    ["revenue", "#41a85f"],
    ["operatingCost", "#ef5b50"],
    ["netIncome", "#f0d24e"],
  ];

  function point(row: typeof rows[number], index: number, key: keyof typeof rows[number]) {
    const x = rows.length === 1 ? 0 : (index / (rows.length - 1)) * 100;
    const y = 100 - ((Number(row[key] || 0) - min) / range) * 86 - 7;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }

  return (
    <div className="chart-card">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1={100 - ((0 - min) / range) * 86 - 7} x2="100" y2={100 - ((0 - min) / range) * 86 - 7} />
        {series.map(([key, color]) => (
          <polyline key={key} points={rows.map((row, index) => point(row, index, key)).join(" ")} style={{ stroke: color }} />
        ))}
      </svg>
    </div>
  );
}
