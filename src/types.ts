export type DistrictType = "homes" | "jobs" | "culture" | "interchange";
export type TrainTypeId = "CX" | "C20" | "C30";
export type BuildMode = "station" | "express" | "remove";
export type ConstructionMethod = "tunnel" | "cutcover" | "surface";
export type ViewId = "build" | "economy" | "events" | "politics" | "goals";
export type MapOverlay = "none" | "homes" | "jobs" | "demand";

export type Point = {
  x: number;
  y: number;
};

export type GeoPoint = {
  lat: number;
  lon: number;
};

export type District = Point & GeoPoint & {
  id: string;
  name: string;
  demand: number;
  type: DistrictType;
};

export type DistrictTypeMeta = {
  label: string;
  fill: string;
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

export type TrainType = {
  label: string;
  price: number;
  capacity: number;
  maintenance: number;
  energy: number;
  support: number;
  reliability: number;
  description: string;
};

export type SpecialEvent = {
  id: string;
  name: string;
  stationId: string;
  destinationId: string;
  demand: number;
  hours: number;
  supportImpact: number;
};

export type ActiveEvent = SpecialEvent & {
  month: number;
};

export type EventService = {
  lineIndex: number;
  type: TrainTypeId;
  count: number;
  fromId: string;
  toId: string;
};

export type Fleet = Record<TrainTypeId, number>;
export type Segment = [string, string];

export type Line = {
  name: string;
  color: string;
  stations: string[];
  segments: Segment[];
  anchor?: string;
  frequency: number;
  express: string[];
  fleet?: Fleet;
};

export type EconomyEntry = {
  month: number;
  budget: number;
  revenue: number;
  operatingCost: number;
  netIncome: number;
  support: number;
  riders: number;
  unconstrainedRiders?: number;
  capacity?: number;
  utilization?: number;
  ticketPrice: number;
  trainsets: number;
  eventCapacity: number;
};

export type Unlocks = {
  c20: boolean;
  c30: boolean;
  express: boolean;
  surface: boolean;
  grants: boolean;
  highFrequency: boolean;
};

export type GameState = {
  gameVersion: number;
  budget: number;
  paused: boolean;
  activeLine: number;
  mode: BuildMode;
  selected: string | null;
  hint: string;
  history: string[];
  actionCount: number;
  month: number;
  politicalCapital: number;
  councilSupport: number;
  ticketPrice: number;
  fundingRequests: number;
  activeEvent: ActiveEvent | null;
  eventServices: EventService[];
  nextEventMonth: number;
  nextHearingMonth: number;
  nextFundingMonth: number;
  hearingFatigue: number;
  economyHistory: EconomyEntry[];
  unlocked: Unlocks;
  lines: Line[];
};

export type Metrics = {
  served: Set<string>;
  riders: number;
  unconstrainedRiders: number;
  marketDemand: number;
  unmetDemand: number;
  utilization: number;
  coverage: number;
  mood: number;
  score: number;
  monthlyRevenue: number;
  operatingCost: number;
  infrastructureCost: number;
  fleetMaintenance: number;
  overhead: number;
  debtService: number;
  netIncome: number;
  councilSupport: number;
  level: number;
  routeLength: number;
  ticketPrice: number;
  affordability: number;
  trainsets: number;
  requiredTrainsets: number;
  dailyCapacity: number;
  maintenanceCost: number;
  serviceReliability: number;
  fleetSupport: number;
  support: number;
  eventCapacity: number;
};

export type Objective = {
  label: string;
  done: boolean;
};
