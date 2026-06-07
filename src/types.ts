export type GeoPoint = {
  lat: number;
  lon: number;
};

export type Point = {
  x: number;
  y: number;
};

export type MapOverlay = "none" | "homes" | "jobs" | "demand" | "flows" | "unmet";
export type BuildMode = "track" | "station" | "select";
export type PanelId = "build" | "economy" | "network" | "data" | "goals" | "service";
export type TrackTool = "straight" | "softCurve" | "broadCurve";
export type ServiceQuality = "basic" | "comfortable" | "premium";

export type ServiceSettings = {
  ticketPrice: number; // mkr per trip
  trainFrequency: number; // trains per hour (1-20)
  serviceQuality: ServiceQuality;
};

export type UnlockId =
  | "tunnels"
  | "express"
  | "transfers"
  | "metro"
  | "doubleTrack"
  | "automation"
  | "signaling"
  | "prestige";

export type UnlockState = Record<UnlockId, boolean>;

export type UnlockNotification = {
  id: UnlockId;
  title: string;
  description: string;
  month: number;
};

export type GameEventType = "demand-spike" | "season" | "development" | "incident";

export type GameEvent = {
  id: string;
  type: GameEventType;
  title: string;
  message: string;
  duration: number; // days remaining
  ridershipMultiplier: number; // 1.0 = no change, 1.5 = +50% ridership
  revenueMultiplier: number; // 1.0 = no change
  costMultiplier: number; // 1.0 = no change
  newHomes: number; // homes added (development events)
  newJobs: number; // jobs added
};

export type SnapHint = {
  kind: "station" | "line-endpoint" | "line-segment";
  point: GeoPoint;
  ref: string; // station id or line id
};

export type SelectedTrackNode = {
  lineId: string;
  index: number;
} | null;


export type Station = GeoPoint & {
  id: string;
  name: string;
};

export type Line = {
  id: string;
  name: string;
  color: string;
  trackTool: TrackTool;
  segmentTools: TrackTool[];
  path: GeoPoint[];
  stationIds: string[];
  frequency: number;
};

export type AggregateDemandArea = {
  id: string;
  name: string;
  bounds: {
    south: number;
    west: number;
    north: number;
    east: number;
  };
  residents: number;
  employedResidents?: number;
  jobs: number;
};

export type EconomyEntry = {
  month: number;
  day: number;
  budget: number;
  revenue: number;
  operatingCost: number;
  netIncome: number;
  riders: number;
  coverage: number;
  constructionCost: number;
  satisfaction: number;
};

export type GoalStatus = "locked" | "active" | "complete";

export type GoalProgress = {
  id: string;
  status: GoalStatus;
  current: number;
  target: number;
  progressLabel: string;
  completedAt: number | null;
};

export type GoalKind = "firstLine" | "coverage30" | "threeLines" | "profitMonth" | "coverage70";

export type GameOver = {
  reason: "bankruptcy";
  month: number;
  budget: number;
  message: string;
};

export type GameState = {
  gameVersion: number;
  budget: number;
  month: number;
  activeLineId: string | null;
  selectedStationId: string | null;
  selectedTrackNode: SelectedTrackNode;
  mode: BuildMode;
  hint: string;
  history: string[];
  stations: Station[];
  lines: Line[];
  economyHistory: EconomyEntry[];
  tickPaused: boolean;
  lastTickAt: number;
  goals: GoalProgress[];
  gameOver: GameOver | null;
  bannerMessage: string | null;
  serviceSettings: ServiceSettings;
  unlocks: UnlockState;
  unlockNotifications: UnlockNotification[];
  events: GameEvent[];
  satisfaction: number;
  newsTicker: { id: string; message: string; month: number }[];
};

export type Metrics = {
  riders: number;
  marketDemand: number;
  unmetDemand: number;
  coverage: number;
  routeLengthKm: number;
  monthlyRevenue: number;
  operatingCost: number;
  netIncome: number;
  stationCount: number;
  lineCount: number;
  interchangeCount: number;
  score: number;
  servedTrips: number;
  totalTrips: number;
  totalHomes: number;
  totalJobs: number;
  flowCoverage: number;
  satisfaction: number;
  capacity: number;
  loadFactor: number;
};
