import type { GameState } from "./types";

export const colors = [
  "#2fbf71",
  "#f25555",
  "#3d7eff",
  "#f2c94c",
  "#a45de8",
  "#f28c38",
  "#23c7d9",
  "#f062a8",
];

export const initialGameState: GameState = {
  gameVersion: 24,
  budget: 800,
  month: 1,
  activeLineId: null,
  selectedStationId: null,
  selectedTrackNode: null,
  mode: "track",
  hint: "Create a line, then drag on the 3D map to draw snapped track. Each station costs 18 mkr, each track node 1.5 mkr.",
  history: [],
  stations: [],
  lines: [],
  economyHistory: [
    { month: 1, day: 30, budget: 800, revenue: 0, operatingCost: 0, constructionCost: 0, netIncome: 0, riders: 0, coverage: 0, satisfaction: 75 },
  ],
  tickPaused: false,
  lastTickAt: 0,
  goals: [
    { id: "firstLine", status: "active", current: 0, target: 1, progressLabel: "0/1 line with 3+ stations", completedAt: null },
    { id: "coverage30", status: "locked", current: 0, target: 30, progressLabel: "0/30% trips connected", completedAt: null },
    { id: "threeLines", status: "locked", current: 0, target: 3, progressLabel: "0/3 lines with 3+ stations", completedAt: null },
    { id: "profitMonth", status: "locked", current: 0, target: 1, progressLabel: "0/1 profitable cycle", completedAt: null },
    { id: "coverage70", status: "locked", current: 0, target: 70, progressLabel: "0/70% trips connected", completedAt: null },
  ],
  gameOver: null,
  bannerMessage: null,
  serviceSettings: {
    ticketPrice: 0.002,
    trainFrequency: 6,
    serviceQuality: "comfortable",
  },
  unlocks: {
    tunnels: false,
    express: false,
    transfers: false,
    metro: false,
    doubleTrack: false,
    automation: false,
    signaling: false,
    prestige: false,
  },
  unlockNotifications: [],
  events: [],
  satisfaction: 75,
  newsTicker: [],
};
