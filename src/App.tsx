import React, { useEffect, useMemo, useState } from "react";
import { colors, districtTypes, initialGameState, specialEvents, trainTypes } from "./data";
import { assignedTrainsets, createInitialState, districtById, getMetrics, getObjectives, getUnlocks, requiredTrainsets, saveGame, segmentCost, withSnapshot } from "./gameLogic";
import type { ConstructionMethod, MapOverlay, TrainTypeId, Unlocks } from "./types";
import logoUrl from "./logo-app.png";

const ThreeMap = React.lazy(() =>
  import("./components/ThreeMap").then((module) => ({ default: module.ThreeMap })),
);

const modeLabels = {
  station: "Extend",
  express: "Express",
  remove: "Demolish",
};

const constructionLabels = {
  tunnel: "Deep tunnel",
  cutcover: "Cut and cover",
  surface: "Surface / bridge",
};

const mapOverlayLabels: Record<MapOverlay, string> = {
  none: "Normal",
  homes: "Homes",
  jobs: "Jobs",
  demand: "Demand",
};

const unlockLabels = {
  c20: "C20 trainsets",
  c30: "C30 trainsets",
  express: "Express stops",
  surface: "Surface builds",
  grants: "State grants",
  highFrequency: "3 min frequency",
};

export default function App() {
  const [game, setGame] = useState(createInitialState);
  const [construction, setConstruction] = useState<ConstructionMethod>("tunnel");
  const [mapOverlay, setMapOverlay] = useState<MapOverlay>("none");
  const [activeView, setActiveView] = useState("build");
  const metrics = useMemo(() => getMetrics(game), [game]);
  const unlocks = useMemo(() => getUnlocks(game, metrics), [game, metrics]);
  const activeLine = game.lines[game.activeLine];
  const selectedDistrict = game.selected ? districtById(game.selected) : null;
  const anchorId = activeLine?.anchor && activeLine.stations.includes(activeLine.anchor)
    ? activeLine.anchor
    : activeLine?.stations.at(-1);
  const anchorStop = anchorId ? districtById(anchorId) : null;
  const selectedOnActiveLine = selectedDistrict ? activeLine.stations.includes(selectedDistrict.id) : false;
  const selectedServedBy = selectedDistrict
    ? game.lines.filter((line) => line.stations.includes(selectedDistrict.id))
    : [];
  const selectedCost = selectedDistrict && anchorStop && !selectedOnActiveLine
    ? segmentCost(anchorStop, selectedDistrict, construction)
    : 0;
  const canUseConstruction = construction !== "surface" || unlocks.surface;
  const canExtend = Boolean(selectedDistrict && !selectedOnActiveLine && game.budget >= selectedCost && canUseConstruction);
  const nextRank = getRank(metrics.level);
  const lineStartCost = 280 + game.lines.length * 70;
  const canStartLine = game.budget >= lineStartCost;
  const activeAssignedTrains = assignedTrainsets(activeLine);
  const activeRequiredTrains = requiredTrainsets(activeLine);

  useEffect(() => {
    saveGame(game);
  }, [game]);

  function patchGame(updater) {
    setGame((current) => updater(structuredClone(current)));
  }

  function selectDistrict(district) {
    patchGame((draft) => {
      const line = draft.lines[draft.activeLine];
      line.anchor = line.anchor && line.stations.includes(line.anchor) ? line.anchor : line.stations.at(-1);
      draft.selected = district.id;

      if (line.stations.includes(district.id)) {
        line.anchor = district.id;
        draft.hint = `${district.name} is now the build start for ${line.name}. Select a target station to connect.`;
      } else {
        draft.hint = `${district.name} selected as target. Extend ${line.name} from ${districtById(line.anchor).name}.`;
      }

      return draft;
    });
  }

  function setMode(mode) {
    patchGame((draft) => ({
      ...draft,
      mode,
      hint: `${modeLabels[mode]} mode armed. Select a station, then confirm the action.`,
    }));
  }

  function spendTurn(draft, hint) {
    draft.actionCount = (draft.actionCount || 0) + 1;
    draft.hint = hint;
    return draft;
  }

  function applyUnlocks(draft, currentMetrics = getMetrics(draft)) {
    const nextUnlocks = getUnlocks(draft, currentMetrics);
    const newlyUnlocked = Object.entries(nextUnlocks)
      .filter(([key, value]) => value && !draft.unlocked?.[key])
      .map(([key]) => unlockLabels[key] || key);
    draft.unlocked = { ...(draft.unlocked || {}), ...nextUnlocks };
    if (newlyUnlocked.length) {
      draft.hint = `${draft.hint} New unlocks: ${newlyUnlocked.join(", ")}.`;
    }
    return draft;
  }

  function recordEconomy(draft, currentMetrics = getMetrics(draft)) {
    draft.economyHistory = [
      ...(draft.economyHistory || []),
      {
        month: draft.month || 1,
        budget: Math.round(draft.budget),
        revenue: currentMetrics.monthlyRevenue,
        operatingCost: currentMetrics.operatingCost,
        netIncome: currentMetrics.netIncome,
        support: currentMetrics.councilSupport,
        riders: currentMetrics.riders,
        unconstrainedRiders: currentMetrics.marketDemand,
        capacity: currentMetrics.dailyCapacity,
        utilization: currentMetrics.utilization,
        ticketPrice: draft.ticketPrice ?? 39,
        trainsets: currentMetrics.trainsets,
        eventCapacity: currentMetrics.eventCapacity,
      },
    ].slice(-18);
    return draft;
  }

  function updateTicketPrice(value) {
    patchGame((draft) => {
      draft.ticketPrice = Number(value);
      draft.hint = `Ticket price set to ${draft.ticketPrice} kr. Higher fares raise revenue per rider but reduce ridership and support.`;
      return draft;
    });
  }

  function extendLine() {
    if (!selectedDistrict) return;
    patchGame((draft) => {
      const line = draft.lines[draft.activeLine];
      line.anchor = line.anchor && line.stations.includes(line.anchor) ? line.anchor : line.stations.at(-1);
      if (line.stations.includes(selectedDistrict.id)) {
        line.anchor = selectedDistrict.id;
        draft.hint = `${selectedDistrict.name} is now the build start for ${line.name}. Select a target station.`;
        return draft;
      }

      const anchor = districtById(line.anchor);
      const cost = segmentCost(anchor, selectedDistrict, construction);
      if (draft.budget < cost) {
        draft.hint = `Not enough budget. ${selectedDistrict.name} needs ${cost} mkr.`;
        return draft;
      }

      draft = withSnapshot(draft);
      draft.lines[draft.activeLine].stations.push(selectedDistrict.id);
      draft.lines[draft.activeLine].segments = [...(line.segments || []), [line.anchor, selectedDistrict.id]];
      draft.lines[draft.activeLine].anchor = selectedDistrict.id;
      draft.budget -= cost;
      draft.mode = "station";
      return applyUnlocks(spendTurn(draft, `${line.name} connected ${anchor.name} to ${selectedDistrict.name} for ${cost} mkr.`));
    });
  }

  function buyTrain(type) {
    patchGame((draft) => {
      const train = trainTypes[type];
      if (!train) return draft;
      const currentUnlocks = getUnlocks(draft, getMetrics(draft));
      if (!isTrainUnlocked(type, currentUnlocks)) {
        draft.hint = `${train.label} trainsets unlock after: ${trainUnlockRequirement(type)}.`;
        return draft;
      }
      if (draft.budget < train.price) {
        draft.hint = `${train.label} trainset costs ${train.price} mkr.`;
        return draft;
      }

      draft = withSnapshot(draft);
      const line = draft.lines[draft.activeLine];
      line.fleet = { CX: 0, C20: 0, C30: 0, ...(line.fleet || {}) };
      line.fleet[type] += 1;
      draft.budget -= train.price;
      return applyUnlocks(spendTurn(draft, `Bought one ${train.label} trainset for ${line.name} (${train.price} mkr).`));
    });
  }

  function sellTrain(type) {
    patchGame((draft) => {
      const line = draft.lines[draft.activeLine];
      line.fleet = { CX: 0, C20: 0, C30: 0, ...(line.fleet || {}) };
      if (!line.fleet[type]) {
        draft.hint = `${line.name} has no ${type} trainsets to sell.`;
        return draft;
      }

      draft = withSnapshot(draft);
      line.fleet[type] -= 1;
      const refund = Math.round(trainTypes[type].price * 0.45);
      draft.budget += refund;
      return applyUnlocks(spendTurn(draft, `Sold one ${type} trainset for ${refund} mkr.`));
    });
  }

  function maybeCreateEvent(draft) {
    if (draft.activeEvent || (draft.month || 1) < (draft.nextEventMonth || 1)) return draft;
    const served = new Set(draft.lines.flatMap((line) => line.stations));
    const eligible = specialEvents.filter((event) => served.has(event.stationId) && served.has(event.destinationId));
    if (!eligible.length) return draft;
    const event = eligible[((draft.month || 1) + (draft.fundingRequests || 0)) % eligible.length];
    draft.activeEvent = { ...event, month: draft.month || 1 };
    draft.eventServices = [];
    draft.nextEventMonth = (draft.month || 1) + 5;
    draft.hint = `${draft.hint} Event alert: ${event.name}. Add shuttle trains in Events.`;
    return draft;
  }

  function assignedToEvent(lineIndex, type) {
    return (game.eventServices || [])
      .filter((service) => service.lineIndex === lineIndex && service.type === type)
      .reduce((sum, service) => sum + service.count, 0);
  }

  function assignEventTrain(lineIndex, type) {
    patchGame((draft) => {
      if (!draft.activeEvent) {
        draft.hint = "No active event needs extra trains.";
        return draft;
      }
      const line = draft.lines[lineIndex];
      const owned = line.fleet?.[type] || 0;
      const alreadyAssigned = (draft.eventServices || [])
        .filter((service) => service.lineIndex === lineIndex && service.type === type)
        .reduce((sum, service) => sum + service.count, 0);
      if (owned - alreadyAssigned <= 0) {
        draft.hint = `${line.name} has no spare ${type} trainsets to divert.`;
        return draft;
      }

      draft = withSnapshot(draft);
      const existing = draft.eventServices.find((service) => service.lineIndex === lineIndex && service.type === type);
      if (existing) existing.count += 1;
      else draft.eventServices.push({
        lineIndex,
        type,
        count: 1,
        fromId: draft.activeEvent.stationId,
        toId: draft.activeEvent.destinationId,
      });
      return spendTurn(draft, `Diverted one ${type} from ${line.name} to ${districtById(draft.activeEvent.stationId).name}-${districtById(draft.activeEvent.destinationId).name} shuttle.`);
    });
  }

  function resolveEvent() {
    patchGame((draft) => {
      if (!draft.activeEvent) return draft;
      draft = withSnapshot(draft);
      const current = getMetrics(draft);
      const handledShare = Math.min(1, current.eventCapacity / Math.max(1, draft.activeEvent.demand));
      const handled = Math.round(draft.activeEvent.demand * handledShare);
      const eventRevenue = Math.round((handled * (draft.ticketPrice || 39)) / 55000);
      const shuttleCost = (draft.eventServices || []).reduce((sum, service) => sum + service.count * 8, 0);
      const supportDelta = handledShare >= .9 ? draft.activeEvent.supportImpact : handledShare >= .6 ? 1 : -Math.round(draft.activeEvent.supportImpact * 1.4);
      draft.budget += eventRevenue - shuttleCost;
      draft.councilSupport = Math.max(5, Math.min(95, (draft.councilSupport ?? 50) + supportDelta));
      const eventName = draft.activeEvent.name;
      draft.activeEvent = null;
      draft.eventServices = [];
      return recordEconomy(spendTurn(draft, `${eventName} handled ${Math.round(handledShare * 100)}% of crowd. Revenue ${eventRevenue} mkr, shuttle cost ${shuttleCost} mkr, support ${supportDelta >= 0 ? "+" : ""}${supportDelta}.`), current);
    });
  }

  function toggleExpress() {
    if (!selectedDistrict) return;
    patchGame((draft) => {
      const line = draft.lines[draft.activeLine];
      if (!line.stations.includes(selectedDistrict.id)) {
        draft.hint = `Add ${selectedDistrict.name} to ${line.name} before upgrading it.`;
        return draft;
      }

      draft = withSnapshot(draft);
      const express = draft.lines[draft.activeLine].express;
      if (express.includes(selectedDistrict.id)) {
        draft.lines[draft.activeLine].express = express.filter((id) => id !== selectedDistrict.id);
        return applyUnlocks(spendTurn(draft, `${selectedDistrict.name} is now a local stop on ${line.name}.`));
      }

      if (draft.budget < 85) {
        draft.hint = "Not enough budget. Express upgrades cost 85 mkr.";
        return draft;
      }
      if (!getUnlocks(draft, getMetrics(draft)).express) {
        draft.hint = "Express service unlocks after one line connects homes and jobs.";
        return draft;
      }

      draft.lines[draft.activeLine].express.push(selectedDistrict.id);
      draft.budget -= 85;
      return applyUnlocks(spendTurn(draft, `${selectedDistrict.name} upgraded to express service for 85 mkr.`));
    });
  }

  function removeStop() {
    if (!selectedDistrict) return;
    patchGame((draft) => {
      const line = draft.lines[draft.activeLine];
      if (line.stations.length <= 1) {
        draft.hint = "A line must keep at least one station.";
        return draft;
      }
      if (!line.stations.includes(selectedDistrict.id)) {
        draft.hint = `${selectedDistrict.name} is not on ${line.name}.`;
        return draft;
      }

      draft = withSnapshot(draft);
      draft.lines[draft.activeLine].stations = line.stations.filter((id) => id !== selectedDistrict.id);
      draft.lines[draft.activeLine].express = line.express.filter((id) => id !== selectedDistrict.id);
      draft.lines[draft.activeLine].segments = (line.segments || []).filter(([from, to]) => from !== selectedDistrict.id && to !== selectedDistrict.id);
      draft.lines[draft.activeLine].anchor = draft.lines[draft.activeLine].stations.at(-1);
      draft.budget += 45;
      return applyUnlocks(spendTurn(draft, `Removed ${selectedDistrict.name} from ${line.name} and recovered 45 mkr.`));
    });
  }

  function addLine(startId = selectedDistrict?.id || "tcentralen") {
    patchGame((draft) => {
      const cost = 280 + draft.lines.length * 70;
      if (draft.budget < cost) {
        draft.hint = `A new line charter costs ${cost} mkr. Run profitable months or win funding first.`;
        return draft;
      }
      draft = withSnapshot(draft);
      const index = draft.lines.length;
      const station = districtById(startId);
      draft.budget -= cost;
      draft.lines.push({
        name: `Line ${index + 1}`,
        color: colors[index % colors.length],
        stations: [startId],
        segments: [],
        anchor: startId,
        frequency: 7,
        express: [],
      });
      draft.activeLine = index;
      draft.selected = startId;
      draft.mode = "station";
      return applyUnlocks(spendTurn(draft, `Started Line ${index + 1} at ${station.name} for ${cost} mkr. Pick the next station to extend.`));
    });
  }

  function updateLine(index, updates) {
    patchGame((draft) => {
      draft.lines[index] = { ...draft.lines[index], ...updates };
      draft.hint = `${draft.lines[index].name} settings updated.`;
      return draft;
    });
  }

  function selectLine(index) {
    patchGame((draft) => ({
      ...draft,
      activeLine: index,
      mode: "station",
      hint: `${draft.lines[index].name} is active. Click any station on this line to set the build start.`,
    }));
  }

  function undo() {
    patchGame((draft) => {
      const previous = draft.history.pop();
      if (!previous) return draft;
      const restored = JSON.parse(previous);
      draft.budget = restored.budget;
      draft.lines = restored.lines;
      draft.actionCount = restored.actionCount || 0;
      draft.month = restored.month || draft.month || 1;
      draft.politicalCapital = restored.politicalCapital ?? draft.politicalCapital ?? 0;
      draft.councilSupport = restored.councilSupport ?? draft.councilSupport ?? 50;
      draft.ticketPrice = restored.ticketPrice ?? draft.ticketPrice ?? 39;
      draft.fundingRequests = restored.fundingRequests || 0;
      draft.activeEvent = restored.activeEvent || null;
      draft.eventServices = restored.eventServices || [];
      draft.nextEventMonth = restored.nextEventMonth || draft.nextEventMonth || 1;
      draft.nextHearingMonth = restored.nextHearingMonth || draft.nextHearingMonth || 1;
      draft.nextFundingMonth = restored.nextFundingMonth || draft.nextFundingMonth || 1;
      draft.hearingFatigue = restored.hearingFatigue || 0;
      draft.economyHistory = restored.economyHistory || draft.economyHistory || [];
      draft.unlocked = restored.unlocked || draft.unlocked || {};
      draft.activeLine = Math.min(draft.activeLine, draft.lines.length - 1);
      draft.hint = "Undid the last network change.";
      return draft;
    });
  }

  function runMonth() {
    patchGame((draft) => {
      draft = withSnapshot(draft);
      const current = getMetrics(draft);
      draft.month = (draft.month || 1) + 1;
      draft.budget += current.netIncome;
      draft.councilSupport = Math.max(5, Math.min(95, Math.round((draft.councilSupport ?? 50) + current.netIncome * .04 + current.coverage * .03 - (current.netIncome < 0 ? 2 : 0))));
      draft.hearingFatigue = Math.max(0, (draft.hearingFatigue || 0) - 1);
      if (current.netIncome >= 15) draft.politicalCapital = (draft.politicalCapital || 0) + 1;
      draft.hint = `Month ${draft.month}: fares ${current.monthlyRevenue} mkr, operations ${current.operatingCost} mkr, net ${current.netIncome} mkr.`;
      return maybeCreateEvent(applyUnlocks(recordEconomy(spendTurn(draft, draft.hint), current), current));
    });
  }

  function holdHearing() {
    patchGame((draft) => {
      if ((draft.month || 1) < (draft.nextHearingMonth || 1)) {
        draft.hint = `Public hearing cooldown. Next available in month ${draft.nextHearingMonth}.`;
        return draft;
      }
      draft = withSnapshot(draft);
      const current = getMetrics(draft);
      draft.month = (draft.month || 1) + 1;
      draft.budget += current.netIncome;
      const fatigue = draft.hearingFatigue || 0;
      const capitalGain = Math.max(1, 3 - fatigue);
      const supportGain = Math.max(1, 7 - fatigue * 2);
      draft.politicalCapital = (draft.politicalCapital || 0) + capitalGain;
      draft.councilSupport = Math.min(95, (draft.councilSupport ?? 50) + supportGain);
      draft.hearingFatigue = fatigue + 1;
      draft.nextHearingMonth = draft.month + 3;
      return applyUnlocks(recordEconomy(spendTurn(draft, `Held hearings: political capital +${capitalGain}, support +${supportGain}. Next hearing month ${draft.nextHearingMonth}.`), current));
    });
  }

  function requestFunding() {
    patchGame((draft) => {
      const current = getMetrics(draft);
      if ((draft.month || 1) < (draft.nextFundingMonth || 1)) {
        draft.hint = `Council funding vote is on cooldown until month ${draft.nextFundingMonth}.`;
        return draft;
      }
      if (current.councilSupport < 58) {
        draft.hint = "Council support must reach 58% before a funding vote can pass.";
        return draft;
      }
      const hasGrantUnlock = getUnlocks(draft, current).grants;
      const capitalCost = hasGrantUnlock ? 2 : 3;
      if ((draft.politicalCapital || 0) < capitalCost) {
        draft.hint = `Funding request needs ${capitalCost} political capital.`;
        return draft;
      }

      draft = withSnapshot(draft);
      const support = current.councilSupport;
      const grant = Math.round(260 + support * 4 + current.coverage * 5 + (hasGrantUnlock ? 180 : 0) - (draft.fundingRequests || 0) * 90);
      draft.politicalCapital -= capitalCost;
      draft.fundingRequests = (draft.fundingRequests || 0) + 1;
      draft.budget += Math.max(120, grant);
      draft.councilSupport = Math.max(5, (draft.councilSupport ?? 50) - 7);
      draft.nextFundingMonth = (draft.month || 1) + 8;
      return applyUnlocks(recordEconomy(spendTurn(draft, `Council approved ${Math.max(120, grant)} mkr. Next funding vote month ${draft.nextFundingMonth}.`), current), current);
    });
  }

  function reset() {
    localStorage.removeItem("subwayer-stockholm");
    setGame(structuredClone(initialGameState));
    setConstruction("tunnel");
  }

  return (
    <main className="app-shell">
      <aside className="side-panel" aria-label="Game controls">
        <header className="brand">
          <div className="brand-lockup">
            <img className="brand-logo" src={logoUrl} alt="" aria-hidden="true" />
            <div>
              <p className="kicker">Stockholm scenario</p>
              <h1>Tunnelbanan</h1>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            title={game.paused ? "Resume simulation" : "Pause simulation"}
            aria-label={game.paused ? "Resume simulation" : "Pause simulation"}
            onClick={() => patchGame((draft) => ({ ...draft, paused: !draft.paused, hint: draft.paused ? "Simulation running." : "Simulation paused. Building remains available." }))}
          >
            {game.paused ? ">" : "||"}
          </button>
        </header>

        <section className="status-strip" aria-label="Game status">
          <div>
            <span>Rank</span>
            <strong>{nextRank}</strong>
          </div>
          <div>
            <span>Month</span>
            <strong>{game.month || 1}</strong>
          </div>
          <div>
            <span>Level</span>
            <strong>{metrics.level}</strong>
          </div>
        </section>

        <section className="metrics" aria-label="Network metrics">
          <Metric label="Budget" value={`${Math.round(game.budget)} mkr`} />
          <Metric label="Net/month" value={`${metrics.netIncome} mkr`} />
          <Metric label="Riders/day" value={metrics.riders.toLocaleString("en-US")} />
          <Metric label="Fleet" value={`${metrics.trainsets}/${metrics.requiredTrainsets}`} />
        </section>

        <nav className="view-tabs" aria-label="Management views">
          {[
            ["build", "Build"],
            ["economy", "Economy"],
            ["events", "Events"],
            ["politics", "Politics"],
            ["goals", "Goals"],
          ].map(([view, label]) => (
            <button
              className={activeView === view ? "active" : ""}
              key={view}
              type="button"
              onClick={() => setActiveView(view)}
            >
              {label}
            </button>
          ))}
        </nav>

        {activeView === "economy" && (
        <section className="tool-group compact" aria-label="Economy">
          <div className="section-head">
            <h2>Farebox</h2>
            <span>{metrics.score} score</span>
          </div>
          <MiniChart
            data={game.economyHistory || []}
            series={[
              ["revenue", "#41a85f"],
              ["operatingCost", "#ef5b50"],
              ["netIncome", "#f0d24e"],
            ]}
          />
          <CapacityChart metrics={metrics} />
          <div className="fare-control">
            <label className="field range-field">
              <span>Ticket price <strong>{game.ticketPrice ?? 39} kr</strong></span>
              <input type="range" min="24" max="72" step="1" value={game.ticketPrice ?? 39} onChange={(event) => updateTicketPrice(event.target.value)} />
            </label>
            <div className="fare-effects">
              <span>Demand factor {metrics.affordability}%</span>
              <span>Support {metrics.councilSupport}%</span>
            </div>
          </div>
          <div className="finance-grid">
            <div><span>Fares</span><strong>{metrics.monthlyRevenue} mkr</strong></div>
            <div><span>Ops</span><strong>{metrics.operatingCost} mkr</strong></div>
            <div><span>Net result</span><strong>{metrics.netIncome} mkr</strong></div>
            <div><span>Fleet maint.</span><strong>{metrics.fleetMaintenance} mkr</strong></div>
            <div><span>Capacity used</span><strong>{metrics.utilization}%</strong></div>
            <div><span>Unmet demand</span><strong>{metrics.unmetDemand.toLocaleString("en-US")}</strong></div>
          </div>
          <div className="policy-note">
            {fleetAdvice(metrics, unlocks)}
          </div>
          <div className="button-row">
            <button className="primary" type="button" onClick={runMonth}>Run month</button>
            <button type="button" onClick={() => setActiveView("politics")}>Politics</button>
          </div>
        </section>
        )}

        {activeView === "build" && (
        <section className="tool-group build-card" aria-label="Build tools">
          <div className="section-head">
            <h2>Build Plan</h2>
            <span>{modeLabels[game.mode]}</span>
          </div>

          <div className="line-picker" aria-label="Lines">
            {game.lines.map((line, index) => (
              <button
                className={index === game.activeLine ? "line-tab active" : "line-tab"}
                key={`${line.name}-${index}`}
                type="button"
                onClick={() => selectLine(index)}
                style={{ "--line-color": line.color } as React.CSSProperties}
              >
                <span />
                {line.name}
              </button>
            ))}
          </div>

          <div className="segmented" role="group" aria-label="Build mode">
            {Object.entries(modeLabels).map(([mode, label]) => (
              <button
                className={game.mode === mode ? "active" : ""}
                key={mode}
                type="button"
                onClick={() => setMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="field">
            <span>Construction method</span>
            <select aria-label="Construction method" value={construction} onChange={(event) => setConstruction(event.target.value as ConstructionMethod)}>
              {Object.entries(constructionLabels).map(([value, label]) => (
                <option key={value} value={value} disabled={value === "surface" && !unlocks.surface}>{label}{value === "surface" && !unlocks.surface ? " (25% coverage)" : ""}</option>
              ))}
            </select>
          </label>

          <label className="field range-field">
            <span>Frequency <strong>{activeLine.frequency} min</strong></span>
            <input type="range" min={unlocks.highFrequency ? "3" : "5"} max="14" value={activeLine.frequency} onChange={(event) => updateLine(game.activeLine, { frequency: Number(event.target.value) })} />
          </label>

          <div className="overlay-control" aria-label="Map overlay">
            <span>Map filter</span>
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
          </div>

          <div className="action-panel">
            <div>
              <span>Active route</span>
              <strong style={{ color: activeLine.color }}>{activeLine.name}</strong>
              <small>Build start: {anchorStop.name} · trains {activeAssignedTrains}/{activeRequiredTrains}</small>
            </div>
            <button className="primary" type="button" disabled={!canExtend} onClick={extendLine}>
              Extend line {selectedCost ? `${selectedCost} mkr` : ""}
            </button>
            <button type="button" disabled={!unlocks.express || !selectedDistrict || !selectedOnActiveLine} onClick={toggleExpress}>
              Toggle express 85 mkr{!unlocks.express ? " (connect homes + jobs)" : ""}
            </button>
            <button className="danger" type="button" disabled={!selectedDistrict || !selectedOnActiveLine || activeLine.stations.length <= 1} onClick={removeStop}>
              Remove stop
            </button>
          </div>

          <div className="fleet-panel">
            <div className="section-head">
              <h2>Fleet</h2>
              <span>{Math.round(metrics.serviceReliability * 100)}% service</span>
            </div>
            {Object.entries(trainTypes).map(([type, train]) => {
              const trainId = type as TrainTypeId;
              const trainUnlocked = isTrainUnlocked(trainId, unlocks);
              return (
              <div className="train-card" key={type}>
                <div>
                  <strong>{train.label}</strong>
                  <span>{train.description}</span>
                  <small>
                    {train.capacity} cap · {train.maintenance + train.energy} mkr/mo · owned {activeLine.fleet?.[type] || 0}
                    {!trainUnlocked ? ` · unlock: ${trainUnlockRequirement(trainId)}` : ""}
                  </small>
                </div>
                <div>
                  <button type="button" disabled={!trainUnlocked || game.budget < train.price} onClick={() => buyTrain(trainId)}>
                    Buy {train.price}
                  </button>
                  <button type="button" disabled={!activeLine.fleet?.[type]} onClick={() => sellTrain(type)}>Sell</button>
                </div>
              </div>
            );
            })}
          </div>

          <div className="button-row">
            <button type="button" disabled={!canStartLine} onClick={() => addLine()}>
              {selectedDistrict ? `Start line here ${lineStartCost} mkr` : `Start at T-Centralen ${lineStartCost} mkr`}
            </button>
            <button type="button" onClick={undo}>Undo</button>
          </div>
        </section>
        )}

        {activeView === "build" && (
        <section className="tool-group compact" aria-label="Selected district">
          <div className="section-head">
            <h2>Station Intel</h2>
            {selectedDistrict && <span>{districtTypes[selectedDistrict.type].label}</span>}
          </div>
          <div className="district-card">
            {selectedDistrict ? (
              <>
                <strong>{selectedDistrict.name}</strong>
                <span>Demand {selectedDistrict.demand}/100</span>
                <span>{selectedServedBy.length ? `Served by ${selectedServedBy.map((line) => line.name).join(", ")}` : "Unserved: high opportunity"}</span>
                <span>{selectedOnActiveLine ? "Build start set here" : `${constructionLabels[construction]} from ${anchorStop.name}: ${selectedCost} mkr`}</span>
              </>
            ) : (
              <>
                <strong>Select a station</strong>
                <span>Click a station node. Drag the map to pan and use the wheel or controls to zoom.</span>
              </>
            )}
          </div>
        </section>
        )}

        {activeView === "goals" && (
        <section className="tool-group compact" aria-label="Objectives">
          <h2>Contract Goals</h2>
          <ul className="objectives">
            {getObjectives(game, metrics).map((objective) => (
              <li className={`objective ${objective.done ? "done" : ""}`} key={objective.label}>
                <span className="check">{objective.done ? "✓" : ""}</span>
                <span>{objective.label}<small>{objective.done ? "complete" : "pending"}</small></span>
              </li>
            ))}
          </ul>
        </section>
        )}

        {activeView === "goals" && (
        <section className="tool-group compact" aria-label="Unlocks">
          <h2>Progression</h2>
          <ul className="objectives">
            <Unlock label="CX trainsets" done note="Start" />
            <Unlock label="C20 trainsets" done={unlocks.c20} note={trainUnlockRequirement("C20")} />
            <Unlock label="C30 trainsets" done={unlocks.c30} note={trainUnlockRequirement("C30")} />
            <Unlock label="Express stops" done={unlocks.express} note="One line with homes + jobs" />
            <Unlock label="Surface builds" done={unlocks.surface} note="25% coverage" />
            <Unlock label="State grants" done={unlocks.grants} note="65% council support" />
            <Unlock label="3 min frequency" done={unlocks.highFrequency} note="220k riders + 20 mkr net" />
          </ul>
        </section>
        )}

        {activeView === "politics" && (
        <section className="tool-group compact" aria-label="Politics">
          <div className="section-head">
            <h2>Council</h2>
            <span>{metrics.councilSupport}% support</span>
          </div>
          <MiniChart
            data={game.economyHistory || []}
            series={[
              ["support", "#5b8cff"],
              ["budget", "#f0d24e"],
            ]}
          />
          <div className="finance-grid">
            <div><span>Political capital</span><strong>{game.politicalCapital || 0}</strong></div>
            <div><span>Hearings</span><strong>{(game.month || 1) >= (game.nextHearingMonth || 1) ? "Ready" : `M${game.nextHearingMonth}`}</strong></div>
            <div><span>Funding vote</span><strong>{(game.month || 1) >= (game.nextFundingMonth || 1) ? "Ready" : `M${game.nextFundingMonth}`}</strong></div>
            <div><span>Requests</span><strong>{game.fundingRequests || 0}</strong></div>
          </div>
          <div className="button-row">
            <button type="button" disabled={(game.month || 1) < (game.nextHearingMonth || 1)} onClick={holdHearing}>Hold hearing</button>
            <button className="primary" type="button" disabled={(game.month || 1) < (game.nextFundingMonth || 1) || metrics.councilSupport < 58} onClick={requestFunding}>Request funding</button>
          </div>
          <div className="policy-note">
            Hearings take a month, include operating results, and have a 3-month cooldown. Funding votes need 58% support, political capital, and an 8-month cooldown.
          </div>
        </section>
        )}

        {activeView === "events" && (
        <section className="tool-group compact" aria-label="Events">
          <div className="section-head">
            <h2>Special Traffic</h2>
            <span>{game.activeEvent ? "Active" : `Next M${game.nextEventMonth || 2}`}</span>
          </div>
          {game.activeEvent ? (
            <>
              <div className="event-card">
                <strong>{game.activeEvent.name}</strong>
                <span>{districtById(game.activeEvent.stationId).name} to {districtById(game.activeEvent.destinationId).name}</span>
                <span>{game.activeEvent.demand.toLocaleString("en-US")} extra passengers over {game.activeEvent.hours} hours</span>
              </div>
              <CapacityBar label="Event demand" value={game.activeEvent.demand} max={Math.max(game.activeEvent.demand, metrics.eventCapacity, 1)} color="#5b8cff" />
              <CapacityBar label="Shuttle capacity" value={metrics.eventCapacity} max={Math.max(game.activeEvent.demand, metrics.eventCapacity, 1)} color="#f0d24e" />
              <div className="event-roster">
                {game.lines.map((line, lineIndex) => (
                  <div className="event-line" key={`${line.name}-${lineIndex}`}>
                    <strong style={{ color: line.color }}>{line.name}</strong>
                    <div>
                      {Object.entries(trainTypes).map(([type]) => {
                        const spare = Math.max(0, (line.fleet?.[type] || 0) - assignedToEvent(lineIndex, type));
                        return (
                          <button key={type} type="button" disabled={!spare} onClick={() => assignEventTrain(lineIndex, type)}>
                            {type} +1 ({spare})
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <button className="primary wide-button" type="button" onClick={resolveEvent}>
                Resolve event
              </button>
              <div className="policy-note">
                Diverted trains run a temporary shuttle and reduce normal line capacity until the event is resolved.
              </div>
            </>
          ) : (
            <>
              <div className="event-card">
                <strong>No active event</strong>
                <span>Events only trigger when their station and T-Centralen are served.</span>
                <span>Serve Globen for concerts, Solna for football, or Arenastaden for finals.</span>
              </div>
              <ul className="objectives">
                {specialEvents.map((event) => (
                  <li className={`objective ${metrics.served.has(event.stationId) && metrics.served.has(event.destinationId) ? "done" : ""}`} key={event.id}>
                    <span className="check">{metrics.served.has(event.stationId) && metrics.served.has(event.destinationId) ? "✓" : ""}</span>
                    <span>{event.name}<small>{districtById(event.stationId).name} required</small></span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        )}
      </aside>

      <section className="map-area" aria-label="Stockholm game map">
        <React.Suspense fallback={<div className="map-loading">Loading 3D map...</div>}>
          <ThreeMap game={game} metrics={metrics} mapOverlay={mapOverlay} onDistrictClick={selectDistrict} />
        </React.Suspense>
        <div className="hud top-hud">
          <div>
            <strong>{game.hint}</strong>
            <span>{selectedDistrict ? `${selectedDistrict.name} selected` : "Select a station to begin planning"}</span>
          </div>
          <button className="danger" type="button" onClick={reset}>Reset</button>
        </div>
      </section>
    </main>
  );
}

function MiniChart({ data, series }) {
  const rows = data?.length ? data : [{ month: 1 }];
  const values = rows.flatMap((row) => series.map(([key]) => Number(row[key] || 0)));
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const range = max - min || 1;

  function point(row, index, key) {
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
      <div className="chart-legend">
        {series.map(([key, color]) => (
          <span key={key}><i style={{ background: color }} />{formatKey(key)}</span>
        ))}
      </div>
    </div>
  );
}

function CapacityChart({ metrics }) {
  const demand = Math.max(1, metrics.marketDemand);
  const capacity = metrics.dailyCapacity;
  const served = metrics.riders;
  const max = Math.max(demand, capacity, served, 1);

  return (
    <div className="capacity-card">
      <div className="section-head">
        <h2>Demand vs Capacity</h2>
        <span>{metrics.trainsets}/{metrics.requiredTrainsets} trains</span>
      </div>
      <CapacityBar label="Potential demand" value={demand} max={max} color="#5b8cff" />
      <CapacityBar label="Fleet capacity" value={capacity} max={max} color="#f0d24e" />
      <CapacityBar label="Riders carried" value={served} max={max} color="#41a85f" />
      <div className="capacity-stats">
        <span>Utilization {metrics.utilization}%</span>
        <span>Reliability {Math.round(metrics.serviceReliability * 100)}%</span>
      </div>
    </div>
  );
}

function CapacityBar({ label, value, max, color }) {
  return (
    <div className="capacity-row">
      <div>
        <span>{label}</span>
        <strong>{Math.round(value).toLocaleString("en-US")}</strong>
      </div>
      <div className="capacity-track">
        <i style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function isTrainUnlocked(type: TrainTypeId, unlocks: Unlocks) {
  if (type === "CX") return true;
  if (type === "C20") return unlocks.c20;
  return unlocks.c30;
}

function trainUnlockRequirement(type: TrainTypeId) {
  if (type === "CX") return "available from start";
  if (type === "C20") return "18% coverage + 60k daily riders";
  return "C20 objective + 10 mkr net/month + 60% support";
}

function fleetAdvice(metrics, unlocks: Unlocks) {
  if (!metrics.requiredTrainsets) return "Build connected segments before buying trains. A station alone creates no route capacity need.";
  if (!metrics.trainsets) return "No fleet assigned. Buy trains before expecting fare revenue.";
  if (metrics.trainsets < metrics.requiredTrainsets) return `Fleet shortage: buy about ${metrics.requiredTrainsets - metrics.trainsets} more trainset(s) before expanding fares or frequency.`;
  if (metrics.utilization >= 88 && metrics.unmetDemand > 10000 && unlocks.c30) return "Demand is pressing against capacity. C30 trainsets are likely valuable.";
  if (metrics.utilization >= 88 && metrics.unmetDemand > 10000 && unlocks.c20) return "Demand is pressing against capacity. C20 trainsets or another CX can help until C30 unlocks.";
  if (metrics.utilization >= 88 && metrics.unmetDemand > 10000) return "Demand is pressing against capacity. Add CX service while working toward the C20 unlock.";
  if (metrics.utilization < 55) return "Capacity is underused. New trains are probably less valuable than building demand or lowering fares.";
  return "Fleet is reasonably matched to demand. Buy trains when you extend routes or lower headways.";
}

function formatKey(key) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function Unlock({ label, done, note }) {
  return (
    <li className={`objective ${done ? "done" : ""}`}>
      <span className="check">{done ? "✓" : ""}</span>
      <span>{label}<small>{done ? "unlocked" : note}</small></span>
    </li>
  );
}

function getRank(level) {
  if (level >= 4) return "Metro Tycoon";
  if (level >= 3) return "Regional Planner";
  if (level >= 2) return "Line Manager";
  return "Junior Builder";
}
