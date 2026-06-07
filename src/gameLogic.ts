import { aggregateDemandAreas } from "./demandData";
import { initialGameState } from "./data";
import type {
  EconomyEntry,
  GameEvent,
  GameOver,
  GameState,
  GeoPoint,
  GoalKind,
  GoalProgress,
  GoalStatus,
  Line,
  Metrics,
  ServiceSettings,
  Station,
  UnlockId,
  UnlockNotification,
  UnlockState,
} from "./types";

const saveKey = "subwayer-custom-network";

const STATION_COST = 18;
const TRACK_NODE_COST = 1.5;
const BANKRUPTCY_THRESHOLD = -2000;
const MONTH_LENGTH_MS = 12000;
const DAYS_PER_MONTH = 30;

const COMMUTE_RATE = 0.3;

// Service quality multipliers
const SERVICE_QUALITY = {
  basic: { ridership: 0.85, cost: 0.7, label: "Basic" },
  comfortable: { ridership: 1.0, cost: 1.0, label: "Comfortable" },
  premium: { ridership: 1.25, cost: 1.5, label: "Premium" },
} as const;

// Unlock thresholds (slow progression)
export const UNLOCK_THRESHOLDS: Record<UnlockId, number> = {
  tunnels: 1500,
  express: 4000,
  transfers: 8000,
  metro: 15000,
  doubleTrack: 25000,
  automation: 40000,
  signaling: 60000,
  prestige: 100000,
};

export const UNLOCK_DEFINITIONS: Record<UnlockId, { title: string; description: string; icon: string }> = {
  tunnels: { title: "Tunnels", description: "Underground tracks are 20% cheaper per km.", icon: "🕳️" },
  express: { title: "Express stations", description: "Stations handle 50% more passengers.", icon: "🚄" },
  transfers: { title: "Transfers", description: "Passengers can switch lines at interchange stations (+25% revenue at interchanges).", icon: "🔄" },
  metro: { title: "Metro stations", description: "Stations handle 100% more passengers.", icon: "🚇" },
  doubleTrack: { title: "Double-track", description: "Lines can run 2× more trains per hour.", icon: "🛤️" },
  automation: { title: "Automation", description: "Operating costs reduced by 25%.", icon: "🤖" },
  signaling: { title: "Signaling", description: "Lines can run up to 20 trains per hour.", icon: "🚦" },
  prestige: { title: "Prestige", description: "Network-wide revenue bonus of 15%.", icon: "⭐" },
};

const DEFAULT_SERVICE: ServiceSettings = {
  ticketPrice: 0.002,
  trainFrequency: 6,
  serviceQuality: "comfortable",
};

const DEFAULT_UNLOCKS: UnlockState = {
  tunnels: false,
  express: false,
  transfers: false,
  metro: false,
  doubleTrack: false,
  automation: false,
  signaling: false,
  prestige: false,
};

type SavedGame = Partial<GameState>;

export function createInitialState(): GameState {
  const saved = loadGame();
  if (!saved || saved.gameVersion !== initialGameState.gameVersion) {
    return structuredClone(initialGameState);
  }

  const lines = Array.isArray(saved.lines)
    ? saved.lines.map((line) => ({
      ...line,
      path: Array.isArray(line.path) ? line.path : [],
      trackTool: line.trackTool || "softCurve",
      segmentTools: Array.isArray(line.segmentTools) ? line.segmentTools : [],
      frequency: line.frequency || 7,
      stationIds: Array.isArray(line.stationIds) ? line.stationIds : [],
    }))
    : [];
  const stations = Array.isArray(saved.stations) ? saved.stations : [];
  const activeLineId = saved.activeLineId && lines.some((line) => line.id === saved.activeLineId)
    ? saved.activeLineId
    : lines[0]?.id ?? null;

  return {
    ...structuredClone(initialGameState),
    ...saved,
    lines,
    stations,
    activeLineId,
    selectedStationId: saved.selectedStationId && stations.some((station) => station.id === saved.selectedStationId)
      ? saved.selectedStationId
      : null,
    selectedTrackNode: saved.selectedTrackNode && lines.some((line) =>
      line.id === saved.selectedTrackNode?.lineId &&
      saved.selectedTrackNode.index >= 0 &&
      saved.selectedTrackNode.index < line.path.length
    )
      ? saved.selectedTrackNode
      : null,
    history: saved.history?.slice(-50) || [],
    economyHistory: saved.economyHistory?.slice(-24) || initialGameState.economyHistory,
    tickPaused: saved.tickPaused ?? false,
    lastTickAt: saved.lastTickAt ?? 0,
    goals: saved.goals?.length ? saved.goals : structuredClone(initialGameState.goals),
    gameOver: saved.gameOver ?? null,
    bannerMessage: saved.bannerMessage ?? null,
    serviceSettings: { ...DEFAULT_SERVICE, ...(saved.serviceSettings || {}) },
    unlocks: { ...DEFAULT_UNLOCKS, ...(saved.unlocks || {}) },
    unlockNotifications: saved.unlockNotifications?.slice(-20) || [],
    events: saved.events || [],
    satisfaction: saved.satisfaction ?? 75,
    newsTicker: saved.newsTicker?.slice(-30) || [],
  };
}

export function loadGame(): SavedGame | null {
  try {
    const saved = localStorage.getItem(saveKey);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

export function saveGame(state: GameState) {
  localStorage.setItem(saveKey, JSON.stringify(state));
}

export function clearSavedGame() {
  localStorage.removeItem(saveKey);
}

export function withSnapshot(state: GameState): GameState {
  return {
    ...state,
    history: [
      ...state.history,
      JSON.stringify({
        budget: state.budget,
        month: state.month,
        activeLineId: state.activeLineId,
        selectedStationId: state.selectedStationId,
        selectedTrackNode: state.selectedTrackNode,
        mode: state.mode,
        hint: state.hint,
        stations: state.stations,
        lines: state.lines,
        economyHistory: state.economyHistory,
        goals: state.goals,
        gameOver: state.gameOver,
        serviceSettings: state.serviceSettings,
        unlocks: state.unlocks,
      }),
    ].slice(-50),
  };
}

export function restoreSnapshot(state: GameState): GameState {
  const previous = state.history.at(-1);
  if (!previous) return state;
  const parsed = JSON.parse(previous) as Partial<GameState>;
  return {
    ...state,
    ...parsed,
    history: state.history.slice(0, -1),
    hint: "Undid the last edit.",
  };
}

export function stationById(stations: Station[], id: string | null | undefined) {
  return stations.find((station) => station.id === id) || null;
}

export function lineById(lines: Line[], id: string | null | undefined) {
  return lines.find((line) => line.id === id) || null;
}

export function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function stationPlacementCost() {
  return STATION_COST;
}

export function trackNodeCost() {
  return TRACK_NODE_COST;
}

export function monthLengthMs() {
  return MONTH_LENGTH_MS;
}

export function daysPerMonth() {
  return DAYS_PER_MONTH;
}

export function bankruptcyThreshold() {
  return BANKRUPTCY_THRESHOLD;
}

export function serviceQualityOptions() {
  return SERVICE_QUALITY;
}

export function getUnlockDefinition(id: UnlockId) {
  return UNLOCK_DEFINITIONS[id];
}

export function getUnlockThreshold(id: UnlockId) {
  return UNLOCK_THRESHOLDS[id];
}

export function getAllUnlockIds(): UnlockId[] {
  return Object.keys(UNLOCK_THRESHOLDS) as UnlockId[];
}

export function nextUnlockToEarn(state: GameState): { id: UnlockId; threshold: number; current: number } | null {
  for (const id of getAllUnlockIds()) {
    if (!state.unlocks[id]) {
      return { id, threshold: UNLOCK_THRESHOLDS[id], current: 0 };
    }
  }
  return null;
}

type GoalDefinition = {
  id: GoalKind;
  title: string;
  description: string;
  reward: number;
  compute: (state: GameState, metrics: Metrics) => { current: number; target: number; label: string };
};

const goalDefinitions: Record<GoalKind, GoalDefinition> = {
  firstLine: {
    id: "firstLine",
    title: "First line",
    description: "Build a line with at least 3 stations.",
    reward: 200,
    compute: (state) => {
      const count = state.lines.filter((line) => line.stationIds.length >= 3).length;
      return { current: Math.min(count, 1), target: 1, label: `${Math.min(count, 1)}/1 line with 3+ stations` };
    },
  },
  coverage30: {
    id: "coverage30",
    title: "Connect 30% of trips",
    description: "Connect home and job stations so 30% of commuters can ride.",
    reward: 400,
    compute: (_state, metrics) => ({
      current: Math.min(metrics.flowCoverage, 30),
      target: 30,
      label: `${Math.min(metrics.flowCoverage, 30)}/30% trips connected`,
    }),
  },
  threeLines: {
    id: "threeLines",
    title: "Build a network",
    description: "Run 3 lines, each with 3+ stations.",
    reward: 600,
    compute: (state) => {
      const count = state.lines.filter((line) => line.stationIds.length >= 3).length;
      return { current: Math.min(count, 3), target: 3, label: `${Math.min(count, 3)}/3 lines with 3+ stations` };
    },
  },
  profitMonth: {
    id: "profitMonth",
    title: "Black ink",
    description: "Finish a 30-day cycle with positive net income.",
    reward: 300,
    compute: (_state, metrics) => {
      const earned = metrics.netIncome > 0 ? 1 : 0;
      return { current: earned, target: 1, label: `${earned}/1 profitable cycle` };
    },
  },
  coverage70: {
    id: "coverage70",
    title: "Mass transit",
    description: "Connect 70% of home-to-work trips across the network.",
    reward: 1200,
    compute: (_state, metrics) => ({
      current: Math.min(metrics.flowCoverage, 70),
      target: 70,
      label: `${Math.min(metrics.flowCoverage, 70)}/70% trips connected`,
    }),
  },
};

export function getGoalDefinition(id: GoalKind): GoalDefinition {
  return goalDefinitions[id];
}

export function getAllGoalDefinitions(): GoalDefinition[] {
  return Object.values(goalDefinitions);
}

export function evaluateGoals(state: GameState, metrics: Metrics) {
  let totalReward = 0;
  let completedTitle: string | null = null;
  const goals: GoalProgress[] = state.goals.map((goal) => {
    const def = goalDefinitions[goal.id as GoalKind];
    if (!def) return goal;
    const computed = def.compute(state, metrics);
    if (goal.status === "complete") {
      return { ...goal, current: goal.target, target: computed.target, progressLabel: computed.label };
    }
    if (goal.status === "locked") return goal;
    if (computed.current >= computed.target) {
      totalReward += def.reward;
      if (!completedTitle) completedTitle = def.title;
      return {
        ...goal,
        status: "complete" as GoalStatus,
        current: computed.target,
        target: computed.target,
        progressLabel: computed.label,
        completedAt: state.month,
      };
    }
    return { ...goal, current: computed.current, target: computed.target, progressLabel: computed.label };
  });

  const firstLocked = goals.findIndex((goal) => goal.status === "locked");
  if (firstLocked > 0) {
    const prev = goals[firstLocked - 1];
    if (prev.status === "complete" && goals[firstLocked].status === "locked") {
      goals[firstLocked] = { ...goals[firstLocked], status: "active" as GoalStatus };
    }
  }

  return { goals, reward: totalReward, completedTitle };
}

export function checkUnlocks(state: GameState, score: number): { state: GameState; newUnlocks: UnlockId[] } {
  const newUnlocks: UnlockId[] = [];
  const updatedUnlocks: UnlockState = { ...state.unlocks };
  const newNotifications: UnlockNotification[] = [];
  for (const id of getAllUnlockIds()) {
    if (!updatedUnlocks[id] && score >= UNLOCK_THRESHOLDS[id]) {
      updatedUnlocks[id] = true;
      newUnlocks.push(id);
      newNotifications.push({
        id,
        title: UNLOCK_DEFINITIONS[id].title,
        description: UNLOCK_DEFINITIONS[id].description,
        month: state.month,
      });
    }
  }
  if (newUnlocks.length === 0) return { state, newUnlocks };
  return {
    state: {
      ...state,
      unlocks: updatedUnlocks,
      unlockNotifications: [...state.unlockNotifications, ...newNotifications].slice(-20),
      newsTicker: [
        ...state.newsTicker,
        ...newUnlocks.map((id) => ({
          id: `unlock-${id}-${state.month}`,
          message: `Unlocked: ${UNLOCK_DEFINITIONS[id].title} — ${UNLOCK_DEFINITIONS[id].description}`,
          month: state.month,
        })),
      ].slice(-30),
    },
    newUnlocks,
  };
}

export function dismissUnlockNotification(state: GameState, id: UnlockId): GameState {
  return { ...state, unlockNotifications: state.unlockNotifications.filter((n) => n.id !== id) };
}

export function getMetrics(state: GameState): Metrics {
  const routeLengthKm = state.lines.reduce((sum, line) => sum + lineLengthKm(line, state.stations), 0);
  const connectedStationIds = new Set(state.lines.flatMap((line) => line.stationIds));
  const stationUse = new Map<string, number>();
  for (const stationId of state.lines.flatMap((line) => line.stationIds)) {
    stationUse.set(stationId, (stationUse.get(stationId) || 0) + 1);
  }

  const coveredAreas = aggregateDemandAreas.filter((area) =>
    state.stations.some((station) => stationCoversArea(station, area)),
  );
  const coveredResidents = coveredAreas.reduce((sum, area) => sum + area.residents, 0);
  const coveredJobs = coveredAreas.reduce((sum, area) => sum + area.jobs, 0);
  const totalDemand = aggregateDemandAreas.reduce((sum, area) => sum + area.residents + area.jobs, 0);
  const coveredDemand = coveredResidents + coveredJobs;
  const coverage = totalDemand ? Math.round((coveredDemand / totalDemand) * 100) : 0;
  const interchangeCount = [...stationUse.values()].filter((count) => count > 1).length;
  const connectedLines = state.lines.filter((line) => line.path.length >= 2 || line.stationIds.length >= 2);
  const frequencyScore = connectedLines.reduce((sum, line) => sum + Math.max(0, 15 - line.frequency), 0);

  const stationHomes = new Map<string, number>();
  const stationJobs = new Map<string, number>();
  for (const station of state.stations) {
    let homes = 0;
    let jobs = 0;
    for (const area of aggregateDemandAreas) {
      if (stationCoversArea(station, area)) {
        homes += area.residents;
        jobs += area.jobs;
      }
    }
    stationHomes.set(station.id, homes);
    stationJobs.set(station.id, jobs);
  }

  const adj = new Map<string, Set<string>>();
  for (const line of state.lines) {
    for (let i = 0; i < line.stationIds.length - 1; i += 1) {
      const a = line.stationIds[i];
      const b = line.stationIds[i + 1];
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    }
  }
  const visited = new Set<string>();
  const components: Set<string>[] = [];
  for (const node of adj.keys()) {
    if (visited.has(node)) continue;
    const component = new Set<string>();
    const queue: string[] = [node];
    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      component.add(current);
      for (const neighbor of adj.get(current) || []) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    components.push(component);
  }

  const totalHomes = state.stations.reduce((sum, s) => sum + (stationHomes.get(s.id) || 0), 0);
  const totalJobs = state.stations.reduce((sum, s) => sum + (stationJobs.get(s.id) || 0), 0);
  const totalTrips = Math.round(Math.min(totalHomes, totalJobs) * COMMUTE_RATE);
  let servedTrips = 0;
  for (const component of components) {
    let compHomes = 0;
    let compJobs = 0;
    for (const stationId of component) {
      compHomes += stationHomes.get(stationId) || 0;
      compJobs += stationJobs.get(stationId) || 0;
    }
    servedTrips += Math.round(Math.min(compHomes, compJobs) * COMMUTE_RATE);
  }
  servedTrips = Math.min(servedTrips, totalTrips);
  const flowCoverage = totalTrips ? Math.round((servedTrips / totalTrips) * 100) : 0;

  // --- Service settings effects ---
  const service = state.serviceSettings;
  const qualityKey = service.serviceQuality in SERVICE_QUALITY ? service.serviceQuality : "comfortable";
  const quality = SERVICE_QUALITY[qualityKey];

  // Price elasticity: lower price = more riders willing to pay
  // Base price is 0.002. At 0.001 → 1.3x riders, at 0.01 → 0.5x riders
  const priceRatio = service.ticketPrice / 0.002;
  const priceElasticity = Math.max(0.4, Math.min(1.4, 1.3 - Math.log2(priceRatio) * 0.25));

  const baseRidership = servedTrips;
  const ridershipMultiplier = priceElasticity * quality.ridership;
  const eventRidershipMultiplier = state.events.reduce((acc, e) => acc * e.ridershipMultiplier, 1.0);
  const eventRevenueMultiplier = state.events.reduce((acc, e) => acc * e.revenueMultiplier, 1.0);
  const effectiveRiders = Math.round(baseRidership * ridershipMultiplier * eventRidershipMultiplier);

  // Transfers: passengers at interchange stations count extra (they switch lines)
  let transferBoost = 0;
  if (state.unlocks.transfers && interchangeCount > 0) {
    // +25% revenue contribution per interchange station (cap at 2x revenue from transfers)
    transferBoost = Math.round(effectiveRiders * Math.min(2, interchangeCount * 0.25));
  }

  // Prestige: +15% revenue
  const prestigeMultiplier = state.unlocks.prestige ? 1.15 : 1.0;

  const revenue = Math.round(effectiveRiders * service.ticketPrice * prestigeMultiplier * eventRevenueMultiplier + transferBoost);
  const monthlyRevenue = revenue;

  // Capacity = sum of (line frequency * stationCount) — rough proxy
  const maxFrequency = state.unlocks.signaling ? 20 : (state.unlocks.doubleTrack ? 12 : 8);
  const effectiveFrequency = Math.min(service.trainFrequency, maxFrequency);
  const capacity = connectedLines.length * effectiveFrequency * 50; // 50 pax per train
  const loadFactor = capacity > 0 ? Math.min(1.5, effectiveRiders / capacity) : 0;

  // --- Operating cost ---
  const lengthPenalty = Math.max(0, routeLengthKm - connectedStationIds.size * 1.6) * 650;
  const baseCost = Math.round(
    connectedLines.length * 18 +
    state.stations.length * 4 +
    routeLengthKm * 2.3 +
    frequencyScore * 1.4 +
    lengthPenalty * 0.05,
  );
  const automationDiscount = state.unlocks.automation ? 0.75 : 1.0;
  const eventCostMultiplier = state.events.reduce((acc, e) => acc * e.costMultiplier, 1.0);
  const operatingCost = Math.round(baseCost * quality.cost * automationDiscount * eventCostMultiplier);
  const netIncome = monthlyRevenue - operatingCost;

  const score = Math.max(
    0,
    Math.round(
      flowCoverage * 6 +
      effectiveRiders / 1400 +
      interchangeCount * 28 +
      Math.max(0, netIncome) * 1.6,
    ),
  );

  return {
    riders: effectiveRiders,
    marketDemand: totalTrips,
    unmetDemand: Math.max(0, totalTrips - effectiveRiders),
    coverage,
    routeLengthKm: Math.round(routeLengthKm * 10) / 10,
    monthlyRevenue,
    operatingCost,
    netIncome,
    stationCount: state.stations.length,
    lineCount: state.lines.length,
    interchangeCount,
    score,
    servedTrips: effectiveRiders,
    totalTrips,
    totalHomes,
    totalJobs,
    flowCoverage,
    satisfaction: state.satisfaction,
    capacity,
    loadFactor,
  };
}

export function recordMonth(state: GameState, metrics = getMetrics(state)): GameState {
  if (state.gameOver) return state;

  const newBudget = Math.round(state.budget + metrics.netIncome);
  const entry: EconomyEntry = {
    month: state.month + 1,
    day: (state.month + 1) * daysPerMonth(),
    budget: newBudget,
    revenue: metrics.monthlyRevenue,
    operatingCost: metrics.operatingCost,
    netIncome: metrics.netIncome,
    riders: metrics.riders,
    coverage: metrics.coverage,
    constructionCost: 0,
    satisfaction: metrics.satisfaction,
  };

  const goalResult = evaluateGoals(state, metrics);
  const finalBudget = Math.round(newBudget + goalResult.reward);

  // Check for new unlocks
  const unlockResult = checkUnlocks(state, metrics.score);
  let workingState = unlockResult.state;
  const newUnlockMessages = unlockResult.newUnlocks
    .map((id) => `🔓 Unlocked: ${UNLOCK_DEFINITIONS[id].title}`)
    .join(" · ");

  // Tick events (reduce duration, remove expired)
  const tickedEvents = workingState.events
    .map((e) => ({ ...e, duration: e.duration - daysPerMonth() }))
    .filter((e) => e.duration > 0);

  // Generate a new event occasionally
  const nextEvents = [...tickedEvents];
  const newsEntries = [...workingState.newsTicker];
  if (shouldGenerateEvent(workingState)) {
    const event = generateEvent(workingState);
    if (event) {
      nextEvents.push(event);
      newsEntries.push({ id: event.id, message: `${event.title} — ${event.message}`, month: state.month });
    }
  }

  const banner: string | null = goalResult.completedTitle
    ? `Goal complete: ${goalResult.completedTitle} (+${goalResult.reward} mkr).`
    : state.bannerMessage;

  const nextState: GameState = {
    ...workingState,
    month: state.month + 1,
    budget: finalBudget,
    economyHistory: [...state.economyHistory, entry].slice(-24),
    goals: goalResult.goals,
    bannerMessage: banner,
    lastTickAt: Date.now(),
    events: nextEvents,
    newsTicker: newsEntries.slice(-30),
  };

  if (finalBudget <= BANKRUPTCY_THRESHOLD) {
    return triggerGameOver(nextState, finalBudget);
  }

  const extraHint = newUnlockMessages ? ` · ${newUnlockMessages}` : "";
  nextState.hint = formatMonthHint(entry, metrics, goalResult.reward, goalResult.completedTitle) + extraHint;
  return nextState;
}

function shouldGenerateEvent(state: GameState): boolean {
  // Generate an event roughly every 6-12 months
  const monthsSinceStart = state.month;
  if (monthsSinceStart < 2) return false;
  if (state.events.length >= 2) return false;
  return Math.random() < 0.35;
}

function generateEvent(state: GameState): GameEvent | null {
  const roll = Math.random();
  const id = `evt-${state.month}-${Math.random().toString(36).slice(2, 7)}`;

  if (roll < 0.35) {
    // Demand spike
    const spikes = [
      { title: "Concert at Globen", message: "Expecting +60% ridership for 3 days as 25,000 fans head to the arena.", ridership: 1.6, revenue: 1.0, cost: 1.0, days: 3 },
      { title: "Football derby at Tele2", message: "Big match tonight — 40,000 fans need a ride home.", ridership: 1.5, revenue: 1.0, cost: 1.0, days: 1 },
      { title: "Stockholm Marathon", message: "City-wide road closures. Public transit demand spikes by 80%.", ridership: 1.8, revenue: 1.0, cost: 1.0, days: 2 },
      { title: "Midsummer celebration", message: "Stockholm empties out — ridership down 40% for the long weekend.", ridership: 0.6, revenue: 1.0, cost: 1.0, days: 3 },
      { title: "Royal wedding parade", message: "Extra security and crowds downtown. +50% demand for 2 days.", ridership: 1.5, revenue: 1.0, cost: 1.0, days: 2 },
    ];
    const pick = spikes[Math.floor(Math.random() * spikes.length)];
    return {
      id,
      type: "demand-spike",
      title: pick.title,
      message: pick.message,
      duration: pick.days,
      ridershipMultiplier: pick.ridership,
      revenueMultiplier: pick.revenue,
      costMultiplier: pick.cost,
      newHomes: 0,
      newJobs: 0,
    };
  }
  if (roll < 0.65) {
    // Development
    const dev = [
      { title: "New office complex in Kista", message: "8,000 new jobs added to the network.", homes: 0, jobs: 8000 },
      { title: "Residential boom in Hagastaden", message: "5,000 new residents moving in.", homes: 5000, jobs: 0 },
      { title: "Tech hub expands in Södermalm", message: "3,000 new jobs and 1,500 new residents.", homes: 1500, jobs: 3000 },
      { title: "Mall of Scandinavia expansion", message: "2,500 new retail jobs in Solna.", homes: 0, jobs: 2500 },
      { title: "New student housing in Frescati", message: "4,000 new residents near Stockholm University.", homes: 4000, jobs: 0 },
    ];
    const pick = dev[Math.floor(Math.random() * dev.length)];
    return {
      id,
      type: "development",
      title: pick.title,
      message: pick.message,
      duration: daysPerMonth() * 3,
      ridershipMultiplier: 1.0,
      revenueMultiplier: 1.0,
      costMultiplier: 1.0,
      newHomes: pick.homes,
      newJobs: pick.jobs,
    };
  }
  if (roll < 0.85) {
    // Season
    const seasons = [
      { title: "Summer holiday", message: "Tourists boost ridership but locals travel less. Net +20%.", ridership: 1.2, revenue: 1.0, cost: 1.0, days: daysPerMonth() * 3 },
      { title: "Winter cold snap", message: "Heating costs up 30%, ridership up 10% as people avoid walking.", ridership: 1.1, revenue: 1.0, cost: 1.3, days: daysPerMonth() * 1 },
      { title: "Back to school", message: "Students return — +30% ridership for a month.", ridership: 1.3, revenue: 1.0, cost: 1.0, days: daysPerMonth() * 1 },
    ];
    const pick = seasons[Math.floor(Math.random() * seasons.length)];
    return {
      id,
      type: "season",
      title: pick.title,
      message: pick.message,
      duration: pick.days,
      ridershipMultiplier: pick.ridership,
      revenueMultiplier: pick.revenue,
      costMultiplier: pick.cost,
      newHomes: 0,
      newJobs: 0,
    };
  }
  // Incident
  const incidents = [
    { title: "Signal failure on the red line", message: "Service disrupted — ridership down 50% for 2 days.", ridership: 0.5, revenue: 1.0, cost: 1.5, days: 2 },
    { title: "Track maintenance", message: "Speed restrictions add 15% to operating costs for a week.", ridership: 1.0, revenue: 1.0, cost: 1.15, days: 7 },
    { title: "Power outage in the central station", message: "Major disruption — 70% ridership drop for 1 day.", ridership: 0.3, revenue: 1.0, cost: 1.4, days: 1 },
  ];
  const pick = incidents[Math.floor(Math.random() * incidents.length)];
  return {
    id,
    type: "incident",
    title: pick.title,
    message: pick.message,
    duration: pick.days,
    ridershipMultiplier: pick.ridership,
    revenueMultiplier: pick.revenue,
    costMultiplier: pick.cost,
    newHomes: 0,
    newJobs: 0,
  };
}

export function tickNow(state: GameState): GameState {
  if (state.gameOver) return state;
  return recordMonth(state);
}

export function togglePause(state: GameState): GameState {
  return { ...state, tickPaused: !state.tickPaused };
}

export function setPaused(state: GameState, paused: boolean): GameState {
  return { ...state, tickPaused: paused };
}

export function applyStationCost(state: GameState, count = 1): GameState {
  if (state.gameOver || count <= 0) return state;
  const cost = Math.round(count * STATION_COST);
  const next = { ...state, budget: Math.round(state.budget - cost) };
  next.hint = count === 1
    ? `Station placed (−${cost} mkr).`
    : `${count} stations built (−${cost} mkr).`;
  return next;
}

export function applyTrackCost(state: GameState, nodeCount: number): GameState {
  if (state.gameOver || nodeCount <= 0) return state;
  const cost = Math.round(nodeCount * TRACK_NODE_COST);
  const next = { ...state, budget: Math.round(state.budget - cost) };
  next.hint = `${nodeCount} track node${nodeCount === 1 ? "" : "s"} built (−${cost} mkr).`;
  return next;
}

export function recordConstructionCost(state: GameState, amount: number): GameState {
  if (state.gameOver || amount <= 0) return state;
  const month = state.month;
  const history = state.economyHistory.slice();
  const lastIndex = history.length - 1;
  let entry: EconomyEntry;
  if (lastIndex >= 0 && history[lastIndex].month === month) {
    entry = { ...history[lastIndex], constructionCost: Math.round(history[lastIndex].constructionCost + amount) };
    history[lastIndex] = entry;
  } else {
    entry = { month, day: month * daysPerMonth(), revenue: 0, operatingCost: 0, netIncome: 0, riders: 0, coverage: 0, constructionCost: Math.round(amount), budget: state.budget, satisfaction: state.satisfaction };
    history.push(entry);
  }
  return { ...state, economyHistory: history.slice(-24) };
}

export function clearBanner(state: GameState): GameState {
  if (!state.bannerMessage) return state;
  return { ...state, bannerMessage: null };
}

export function setServiceSettings(state: GameState, patch: Partial<ServiceSettings>): GameState {
  return { ...state, serviceSettings: { ...state.serviceSettings, ...patch } };
}

export function restartGame(): GameState {
  clearSavedGame();
  return structuredClone(initialGameState);
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatMonth(month: number) {
  const monthsSinceStart = Math.max(0, month - 1);
  const year = 2026 + Math.floor(monthsSinceStart / 12);
  const monthIndex = monthsSinceStart % 12;
  return `1 ${MONTH_NAMES[monthIndex]} ${year}`;
}

function triggerGameOver(state: GameState, budget: number): GameState {
  const gameOver: GameOver = {
    reason: "bankruptcy",
    month: state.month,
    budget,
    message: `Bankrupt on ${formatMonth(state.month)} — budget dropped to ${budget} mkr.`,
  };
  return { ...state, gameOver, hint: gameOver.message };
}

function formatMonthHint(entry: EconomyEntry, metrics: Metrics, reward: number, completedTitle: string | null) {
  const net = entry.netIncome >= 0 ? `+${entry.netIncome}` : `${entry.netIncome}`;
  const rewardPart = reward > 0 ? ` · Goal reward +${reward} mkr${completedTitle ? ` (${completedTitle})` : ""}` : "";
  return `${formatMonth(entry.day / daysPerMonth())}: revenue ${entry.revenue} mkr, ops ${entry.operatingCost} mkr, net ${net} mkr. ${metrics.riders.toLocaleString("en-US")} riders, ${metrics.flowCoverage}% flow${rewardPart}`;
}

export function lineLengthKm(line: Line, stations: Station[]) {
  if (line.path.length >= 2) {
    let length = 0;
    for (let i = 1; i < line.path.length; i += 1) {
      length += haversineKm(line.path[i - 1], line.path[i]);
    }
    return length;
  }

  let length = 0;
  for (let i = 1; i < line.stationIds.length; i += 1) {
    const from = stationById(stations, line.stationIds[i - 1]);
    const to = stationById(stations, line.stationIds[i]);
    if (from && to) length += haversineKm(from, to);
  }
  return length;
}

export function constrainedTrackPoint(line: Line, rawPoint: GeoPoint) {
  const options = trackToolOptions(line.trackTool);
  const path = line.path;
  if (!path.length) return rawPoint;

  const previous = path.at(-1)!;
  const previousWorld = geoToWorld(previous);
  const rawWorld = geoToWorld(rawPoint);
  const distance = Math.hypot(rawWorld.x - previousWorld.x, rawWorld.y - previousWorld.y);
  if (distance < 15) return null;

  let angle = Math.atan2(rawWorld.y - previousWorld.y, rawWorld.x - previousWorld.x);
  const snap = degToRad(options.snapDegrees);
  angle = Math.round(angle / snap) * snap;

  if (path.length >= 2) {
    const before = geoToWorld(path.at(-2)!);
    const previousAngle = Math.atan2(previousWorld.y - before.y, previousWorld.x - before.x);
    const delta = normalizeAngle(angle - previousAngle);
    const maxTurn = degToRad(options.maxTurnDegrees);
    if (Math.abs(delta) > maxTurn) {
      angle = previousAngle + Math.sign(delta) * maxTurn;
    }
  }

  return worldToGeo({
    x: previousWorld.x + Math.cos(angle) * distance,
    y: previousWorld.y + Math.sin(angle) * distance,
  });
}

export function constrainedTrackPointFromNode(line: Line, rawPoint: GeoPoint, index: number) {
  if (!line.path.length) return rawPoint;
  if (index <= 0) return constrainedPrependPoint(line, rawPoint);
  if (index >= line.path.length - 1) return constrainedTrackPoint(line, rawPoint);

  const options = trackToolOptions(line.trackTool);
  const anchor = line.path[index];
  const previous = line.path[index - 1];
  const anchorWorld = geoToWorld(anchor);
  const rawWorld = geoToWorld(rawPoint);
  const distance = Math.hypot(rawWorld.x - anchorWorld.x, rawWorld.y - anchorWorld.y);
  if (distance < 15) return null;

  let angle = Math.atan2(rawWorld.y - anchorWorld.y, rawWorld.x - anchorWorld.x);
  const snap = degToRad(options.snapDegrees);
  angle = Math.round(angle / snap) * snap;

  const previousWorld = geoToWorld(previous);
  const previousAngle = Math.atan2(anchorWorld.y - previousWorld.y, anchorWorld.x - previousWorld.x);
  const delta = normalizeAngle(angle - previousAngle);
  const maxTurn = degToRad(options.maxTurnDegrees);
  if (Math.abs(delta) > maxTurn) {
    angle = previousAngle + Math.sign(delta) * maxTurn;
  }

  return worldToGeo({
    x: anchorWorld.x + Math.cos(angle) * distance,
    y: anchorWorld.y + Math.sin(angle) * distance,
  });
}

function constrainedPrependPoint(line: Line, rawPoint: GeoPoint) {
  const path = line.path;
  if (!path.length) return rawPoint;
  if (path.length === 1) return rawPoint;

  const options = trackToolOptions(line.trackTool);
  const first = path[0];
  const second = path[1];
  const firstWorld = geoToWorld(first);
  const rawWorld = geoToWorld(rawPoint);
  const distance = Math.hypot(rawWorld.x - firstWorld.x, rawWorld.y - firstWorld.y);
  if (distance < 15) return null;

  let angle = Math.atan2(rawWorld.y - firstWorld.y, rawWorld.x - firstWorld.x);
  const snap = degToRad(options.snapDegrees);
  angle = Math.round(angle / snap) * snap;

  const secondWorld = geoToWorld(second);
  const existingAngle = Math.atan2(secondWorld.y - firstWorld.y, secondWorld.x - firstWorld.x);
  const oppositeExisting = normalizeAngle(existingAngle + Math.PI);
  const delta = normalizeAngle(angle - oppositeExisting);
  const maxTurn = degToRad(options.maxTurnDegrees);
  if (Math.abs(delta) > maxTurn) {
    angle = oppositeExisting + Math.sign(delta) * maxTurn;
  }

  return worldToGeo({
    x: firstWorld.x + Math.cos(angle) * distance,
    y: firstWorld.y + Math.sin(angle) * distance,
  });
}

function trackToolOptions(tool: Line["trackTool"]) {
  if (tool === "straight") return { snapDegrees: 5, maxTurnDegrees: 90 };
  if (tool === "broadCurve") return { snapDegrees: 5, maxTurnDegrees: 90 };
  return { snapDegrees: 5, maxTurnDegrees: 90 };
}

function geoToWorld(point: GeoPoint) {
  const referenceLat = 59.33;
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = Math.cos(degToRad(referenceLat)) * 111320;
  return {
    x: point.lon * metersPerDegreeLon,
    y: point.lat * metersPerDegreeLat,
  };
}

function worldToGeo(point: { x: number; y: number }) {
  const referenceLat = 59.33;
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = Math.cos(degToRad(referenceLat)) * 111320;
  return {
    lon: point.x / metersPerDegreeLon,
    lat: point.y / metersPerDegreeLat,
  };
}

function normalizeAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function stationCoversArea(station: Station, area: { bounds: { south: number; west: number; north: number; east: number } }) {
  const center = {
    lat: (area.bounds.south + area.bounds.north) / 2,
    lon: (area.bounds.west + area.bounds.east) / 2,
  };
  return haversineKm(station, center) <= 1.25;
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const radius = 6371;
  const dLat = degToRad(b.lat - a.lat);
  const dLon = degToRad(b.lon - a.lon);
  const lat1 = degToRad(a.lat);
  const lat2 = degToRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function degToRad(value: number) {
  return (value * Math.PI) / 180;
}
