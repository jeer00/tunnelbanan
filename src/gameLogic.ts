import { colors, districts, initialGameState, trainTypes, water } from "./data";
import type { ConstructionMethod, District, GameState, Line, Metrics, Objective, Point, Segment, TrainTypeId, Unlocks } from "./types";

type SavedGame = Partial<GameState> & {
  lines?: Partial<Line>[];
};

export function createInitialState(): GameState {
  const saved = loadGame();
  if (!saved) return structuredClone(initialGameState);
  if (saved.gameVersion !== initialGameState.gameVersion) return structuredClone(initialGameState);

  return {
    ...structuredClone(initialGameState),
    ...saved,
    lines: saved.lines.map((line, index) => ({
      name: line.name || `Linje ${index + 1}`,
      color: line.color || colors[index % colors.length],
      stations: line.stations?.length ? line.stations : ["tcentralen"],
      segments: line.segments?.length ? line.segments : segmentsFromStations(line.stations?.length ? line.stations : ["tcentralen"]),
      anchor: line.anchor && line.stations?.includes(line.anchor) ? line.anchor : line.stations?.at(-1) || "tcentralen",
      frequency: line.frequency || 7,
      express: line.express || [],
      fleet: { CX: 0, C20: 0, C30: 0, ...(line.fleet || {}) },
    })),
    actionCount: saved.actionCount || 0,
    month: saved.month || 1,
    politicalCapital: saved.politicalCapital ?? initialGameState.politicalCapital,
    councilSupport: saved.councilSupport ?? initialGameState.councilSupport,
    ticketPrice: saved.ticketPrice ?? initialGameState.ticketPrice,
    fundingRequests: saved.fundingRequests || 0,
    activeEvent: saved.activeEvent || initialGameState.activeEvent,
    eventServices: saved.eventServices || [],
    nextEventMonth: saved.nextEventMonth || initialGameState.nextEventMonth,
    nextHearingMonth: saved.nextHearingMonth || initialGameState.nextHearingMonth,
    nextFundingMonth: saved.nextFundingMonth || initialGameState.nextFundingMonth,
    hearingFatigue: saved.hearingFatigue || 0,
    economyHistory: saved.economyHistory?.length ? saved.economyHistory.slice(-18) : initialGameState.economyHistory,
    unlocked: { ...initialGameState.unlocked, ...(saved.unlocked || {}) },
  };
}

export function loadGame(): SavedGame | null {
  try {
    const saved = localStorage.getItem("subwayer-stockholm");
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

export function saveGame(state: GameState): void {
  localStorage.setItem("subwayer-stockholm", JSON.stringify(state));
}

export function districtById(id: string): District {
  const district = districts.find((item) => item.id === id);
  if (!district) throw new Error(`Unknown district: ${id}`);
  return district;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function segmentCost(a: Point, b: Point, method: ConstructionMethod): number {
  const base = distance(a, b) / 4.8;
  const crossesWater = water.some((poly) => segmentHitsPolygon(a, b, poly));
  const multiplier = { tunnel: 2.5, cutcover: 1.7, surface: crossesWater ? 3.1 : 1.05 }[method];
  return Math.round(base * multiplier + (crossesWater ? 180 : 0) + 35);
}

export function getMetrics(state: GameState): Metrics {
  const served = new Set(state.lines.flatMap((line) => line.stations));
  const servedDemand = districts.filter((district) => served.has(district.id)).reduce((sum, district) => sum + district.demand, 0);
  const totalDemand = districts.reduce((sum, district) => sum + district.demand, 0);
  const interchanges = districts.filter((district) => served.has(district.id) && district.type === "interchange").length;
  const jobLinks = state.lines.reduce((score, line) => {
    const types = line.stations.map((id) => districtById(id).type);
    return score + (types.includes("homes") && types.includes("jobs") ? 1 : 0);
  }, 0);
  const expressBoost = state.lines.reduce((sum, line) => sum + line.express.length, 0);
  const routeLength = state.lines.reduce((sum, line) => sum + lineLength(line), 0);
  const totalSegments = state.lines.reduce((sum, line) => sum + (line.segments?.length || Math.max(0, line.stations.length - 1)), 0);
  const frequencyBonus = state.lines.reduce((sum, line) => sum + Math.max(0, 16 - line.frequency), 0);
  const networkPenalty = Math.max(0, state.lines.length - 2) * 2500;
  const routeMaturity = 0.55 + Math.min(0.45, totalSegments * 0.13);
  const fleet = getFleetMetrics(state);
  const ticketPrice = state.ticketPrice ?? 39;
  const affordability = Math.max(0.48, Math.min(1.34, 1 - (ticketPrice - 39) * 0.018));
  const fareSupport = Math.round((39 - ticketPrice) * 0.65);
  const baseRiders = (servedDemand * 620 + interchanges * 8800 + jobLinks * 7200 + expressBoost * 1900 + frequencyBonus * 460 - routeLength * 3.5 - networkPenalty) * routeMaturity;
  const marketDemand = Math.max(0, Math.round(baseRiders * affordability));
  const unconstrainedRiders = Math.max(0, Math.round(marketDemand * fleet.serviceReliability));
  const capacityFactor = Math.min(1, fleet.dailyCapacity / Math.max(1, baseRiders * 1.25));
  const riders = Math.round(baseRiders * affordability * fleet.serviceReliability * capacityFactor);
  const unmetDemand = Math.max(0, marketDemand - Math.max(0, riders));
  const utilization = fleet.dailyCapacity ? Math.round((Math.max(0, riders) / fleet.dailyCapacity) * 100) : 0;
  const coverage = Math.round((servedDemand / totalDemand) * 100);
  const monthlyRevenue = Math.round((Math.max(0, riders) * ticketPrice) / 12500);
  const infrastructureCost = Math.round(
    state.lines.reduce((sum, line) => sum + 22 + line.stations.length * 6 + lineLength(line) / Math.max(11, line.frequency * 1.8) + line.express.length * 7, 0)
  );
  const operatingCost = infrastructureCost + fleet.maintenanceCost;
  const overhead = Math.round(10 + state.lines.length * 6 + Math.max(0, totalSegments - 1) * 2);
  const debtService = Math.round(Math.max(0, -state.budget) * 0.035);
  const netIncome = monthlyRevenue - operatingCost - overhead - debtService;
  const debtPenalty = Math.max(0, -state.budget) / 80;
  const councilSupport = Math.max(5, Math.min(95, Math.round((state.councilSupport ?? 50) + coverage * .06 + netIncome * .035 + fareSupport + fleet.support - (1 - fleet.serviceReliability) * 14 - debtPenalty)));
  const mood = Math.max(8, Math.min(99, Math.round(coverage * 0.5 + interchanges * 5 + jobLinks * 3 + expressBoost * 2 + Math.max(0, netIncome) * .1 + fareSupport * .55 + fleet.support - (1 - fleet.serviceReliability) * 18 - debtPenalty)));
  const score = Math.max(0, Math.round(coverage * 6 + mood * 2.5 + Math.max(0, riders) / 2100 + interchanges * 32 + jobLinks * 28 + netIncome * 1.1 - Math.max(0, (state.actionCount || 0) - 16) * 6));
  const level = getLevel({ coverage, riders: Math.max(0, riders), score, netIncome });

  return { served, riders: Math.max(0, riders), unconstrainedRiders, marketDemand, unmetDemand, utilization, coverage, mood, score, monthlyRevenue, operatingCost, infrastructureCost, fleetMaintenance: fleet.maintenanceCost, overhead, debtService, netIncome, councilSupport, level, routeLength: Math.round(routeLength), ticketPrice, affordability: Math.round(affordability * 100), ...fleet };
}

export function getObjectives(state: GameState, metrics: Metrics): Objective[] {
  const allLinesHaveThreeStops = state.lines.length >= 3 && state.lines.every((line) => line.stations.length >= 3);
  return [
    { label: "Turn fare operations profitable", done: metrics.netIncome >= 20 },
    { label: "Serve 35% demand coverage", done: metrics.coverage >= 35 },
    { label: "Win 65% council support", done: metrics.councilSupport >= 65 },
    { label: "Run three lines with three stops each", done: allLinesHaveThreeStops },
    { label: "Carry 450,000 daily riders", done: metrics.riders >= 450000 },
    { label: "Reach Planner Level 4", done: metrics.level >= 4 },
  ];
}

export function getLevel(metrics: Pick<Metrics, "coverage" | "riders" | "score" | "netIncome">): number {
  if (metrics.score >= 900 && metrics.coverage >= 55 && metrics.netIncome >= 28) return 4;
  if (metrics.score >= 650 && metrics.coverage >= 38 && metrics.netIncome >= 8) return 3;
  if (metrics.score >= 390 && metrics.coverage >= 18) return 2;
  return 1;
}

export function getUnlocks(state: GameState, metrics: Metrics): Unlocks {
  const hasBalancedLine = state.lines.some((line) => {
    const types = line.stations.map((id) => districtById(id).type);
    return types.includes("homes") && types.includes("jobs");
  });

  return {
    c20: metrics.coverage >= 18 && metrics.riders >= 60000,
    c30: metrics.coverage >= 18 && metrics.riders >= 60000 && metrics.netIncome >= 10 && metrics.councilSupport >= 60,
    express: hasBalancedLine,
    surface: metrics.coverage >= 25,
    grants: metrics.councilSupport >= 65,
    highFrequency: metrics.riders >= 220000 && metrics.netIncome >= 20,
  };
}

export function nearestDistrict(point: Point): { district: District; d: number } {
  return districts
    .map((district) => ({ district, d: distance(point, district) }))
    .sort((a, b) => a.d - b.d)[0];
}

export function withSnapshot(state: GameState): GameState {
  return {
    ...state,
    history: [
      ...state.history,
      JSON.stringify({
        budget: state.budget,
        lines: state.lines,
        actionCount: state.actionCount || 0,
        month: state.month || 1,
        politicalCapital: state.politicalCapital || 0,
        councilSupport: state.councilSupport ?? 50,
        ticketPrice: state.ticketPrice ?? 39,
        fundingRequests: state.fundingRequests || 0,
        activeEvent: state.activeEvent || null,
        eventServices: state.eventServices || [],
        nextEventMonth: state.nextEventMonth || 1,
        nextHearingMonth: state.nextHearingMonth || 1,
        nextFundingMonth: state.nextFundingMonth || 1,
        hearingFatigue: state.hearingFatigue || 0,
        economyHistory: state.economyHistory || [],
        unlocked: state.unlocked || {},
      }),
    ].slice(-30),
  };
}

export function requiredTrainsets(line: Line): number {
  const segments = line.segments?.length || Math.max(0, line.stations.length - 1);
  if (!segments) return 0;
  const routeDemand = Math.max(1, lineLength(line) / 220 + line.stations.length * 0.22);
  const frequencyPressure = 9 / Math.max(4, line.frequency || 7);
  return Math.max(1, Math.ceil(routeDemand * frequencyPressure * 0.55));
}

export function assignedTrainsets(line: Line): number {
  return Object.values(line.fleet || {}).reduce((sum, count) => sum + count, 0);
}

function getFleetMetrics(state: GameState) {
  let trainsets = 0;
  let required = 0;
  let dailyCapacity = 0;
  let maintenanceCost = 0;
  let support = 0;
  let reliabilityWeighted = 0;
  let eventCapacity = 0;
  const diverted = new Map<string, number>();

  (state.eventServices || []).forEach((service) => {
    const key = `${service.lineIndex}:${service.type}`;
    diverted.set(key, (diverted.get(key) || 0) + (service.count || 0));
    const train = trainTypes[service.type];
    if (train) eventCapacity += (service.count || 0) * train.capacity * Math.max(1, state.activeEvent?.hours || 3) * 5;
  });

  state.lines.forEach((line, lineIndex) => {
    const lineRequired = requiredTrainsets(line);
    const lineAssigned = assignedTrainsets(line);
    required += lineRequired;
    trainsets += lineAssigned;

    Object.entries(line.fleet || {}).forEach(([type, count]) => {
      const trainType = type as TrainTypeId;
      const train = trainTypes[trainType];
      const availableCount = Math.max(0, (count || 0) - (diverted.get(`${lineIndex}:${type}`) || 0));
      if (!train || !availableCount) return;
      const frequencyMultiplier = 8 / Math.max(3, line.frequency || 7);
      dailyCapacity += availableCount * train.capacity * 50 * frequencyMultiplier;
      maintenanceCost += availableCount * (train.maintenance + train.energy);
      support += availableCount * train.support;
      reliabilityWeighted += availableCount * train.reliability;
    });
  });

  const activeTrainsets = Math.max(0, trainsets - (state.eventServices || []).reduce((sum, service) => sum + (service.count || 0), 0));
  const reliability = activeTrainsets ? reliabilityWeighted / activeTrainsets : 0;
  const assignmentReliability = required ? Math.min(1, activeTrainsets / required) : 0;
  const serviceReliability = required ? reliability * assignmentReliability : 0;

  return {
    trainsets,
    requiredTrainsets: required,
    dailyCapacity: Math.round(dailyCapacity),
    maintenanceCost: Math.round(maintenanceCost),
    serviceReliability: Math.round(serviceReliability * 100) / 100,
    fleetSupport: support,
    support,
    eventCapacity: Math.round(eventCapacity),
  };
}

export function lineLength(line: Line): number {
  if (line.segments?.length) {
    return line.segments.reduce((sum, [from, to]) => sum + distance(districtById(from), districtById(to)), 0);
  }
  return segmentsFromStations(line.stations).reduce((sum, [from, to]) => sum + distance(districtById(from), districtById(to)), 0);
}

function segmentsFromStations(stations: string[] = []): Segment[] {
  const segments: Segment[] = [];
  for (let i = 1; i < stations.length; i += 1) {
    segments.push([stations[i - 1], stations[i]]);
  }
  return segments;
}

function segmentHitsPolygon(a: Point, b: Point, poly: [number, number][]): boolean {
  for (let i = 0; i < poly.length; i += 1) {
    const c = { x: poly[i][0], y: poly[i][1] };
    const next = poly[(i + 1) % poly.length];
    const d = { x: next[0], y: next[1] };
    if (linesIntersect(a, b, c, d)) return true;
  }
  return false;
}

function linesIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const det = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (det === 0) return false;
  const lambda = ((d.y - c.y) * (d.x - a.x) + (c.x - d.x) * (d.y - a.y)) / det;
  const gamma = ((a.y - b.y) * (d.x - a.x) + (b.x - a.x) * (d.y - a.y)) / det;
  return lambda > 0 && lambda < 1 && gamma > 0 && gamma < 1;
}
