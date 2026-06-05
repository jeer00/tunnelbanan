import type { District, DistrictType, DistrictTypeMeta, GameState, SpecialEvent, TrainType, TrainTypeId } from "./types";

export const colors = ["#41a85f", "#ef4f45", "#1f58d0", "#f0d24e", "#7a36a5", "#f27a30"];

export const districtTypes: Record<DistrictType, DistrictTypeMeta> = {
  homes: { label: "Homes", fill: "#f0d24e" },
  jobs: { label: "Jobs", fill: "#5b8cff" },
  culture: { label: "Culture", fill: "#af62d6" },
  interchange: { label: "Interchange", fill: "#f4f6f4" },
};

export const trainTypes: Record<TrainTypeId, TrainType> = {
  CX: {
    label: "CX",
    price: 45,
    capacity: 620,
    maintenance: 8,
    energy: 5,
    support: -1,
    reliability: 0.86,
    description: "Starter legacy stock. Cheap to run, but limited capacity and comfort.",
  },
  C20: {
    label: "C20",
    price: 95,
    capacity: 880,
    maintenance: 12,
    energy: 7,
    support: 0,
    reliability: 0.92,
    description: "Stable modern workhorse with balanced cost and capacity.",
  },
  C30: {
    label: "C30",
    price: 155,
    capacity: 1180,
    maintenance: 10,
    energy: 6,
    support: 2,
    reliability: 0.97,
    description: "Expensive high-capacity trains with better comfort and public support.",
  },
};

export const specialEvents: SpecialEvent[] = [
  {
    id: "globen-concert",
    name: "Concert at Globen",
    stationId: "globen",
    destinationId: "tcentralen",
    demand: 42000,
    hours: 4,
    supportImpact: 6,
  },
  {
    id: "solna-football",
    name: "Football near Solna centrum",
    stationId: "solna-centrum",
    destinationId: "tcentralen",
    demand: 36000,
    hours: 3,
    supportImpact: 5,
  },
  {
    id: "stadion-final",
    name: "Derby night at Stadion",
    stationId: "stadion",
    destinationId: "tcentralen",
    demand: 52000,
    hours: 5,
    supportImpact: 7,
  },
];

type StationSeed = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  passengers: number;
};

const stationSeeds: StationSeed[] = [
  { id: "abrahamsberg", name: "Abrahamsberg", lat: 59.33668, lon: 17.95295, passengers: 3200 },
  { id: "akalla", name: "Akalla", lat: 59.414814, lon: 17.912796, passengers: 5700 },
  { id: "alby", name: "Alby", lat: 59.239498, lon: 17.845332, passengers: 5900 },
  { id: "alvik", name: "Alvik", lat: 59.333633, lon: 17.980269, passengers: 14700 },
  { id: "aspudden", name: "Aspudden", lat: 59.306449, lon: 18.001447, passengers: 4000 },
  { id: "axelsberg", name: "Axelsberg", lat: 59.304364, lon: 17.97492, passengers: 2200 },
  { id: "bagarmossen", name: "Bagarmossen", lat: 59.276263, lon: 18.131467, passengers: 4400 },
  { id: "bandhagen", name: "Bandhagen", lat: 59.270403, lon: 18.049486, passengers: 3000 },
  { id: "bergshamra", name: "Bergshamra", lat: 59.381509, lon: 18.036514, passengers: 4200 },
  { id: "bjorkhagen", name: "Björkhagen", lat: 59.291114, lon: 18.11552, passengers: 2600 },
  { id: "blackeberg", name: "Blackeberg", lat: 59.348357, lon: 17.882799, passengers: 3800 },
  { id: "blasut", name: "Blåsut", lat: 59.290242, lon: 18.091061, passengers: 3100 },
  { id: "bredang", name: "Bredäng", lat: 59.294835, lon: 17.933812, passengers: 5600 },
  { id: "brommaplan", name: "Brommaplan", lat: 59.338388, lon: 17.93926, passengers: 9500 },
  { id: "danderyds-sjukhus", name: "Danderyds sjukhus", lat: 59.391901, lon: 18.041368, passengers: 10500 },
  { id: "duvbo", name: "Duvbo", lat: 59.367891, lon: 17.964618, passengers: 2000 },
  { id: "enskede-gard", name: "Enskede gård", lat: 59.289397, lon: 18.070296, passengers: 1000 },
  { id: "farsta", name: "Farsta", lat: 59.243552, lon: 18.093281, passengers: 8100 },
  { id: "farsta-strand", name: "Farsta strand", lat: 59.235012, lon: 18.10174, passengers: 3600 },
  { id: "fittja", name: "Fittja", lat: 59.247462, lon: 17.860964, passengers: 5100 },
  { id: "fridhemsplan", name: "Fridhemsplan", lat: 59.332203, lon: 18.029188, passengers: 40200 },
  { id: "fruangen", name: "Fruängen", lat: 59.285927, lon: 17.965005, passengers: 6700 },
  { id: "gamla-stan", name: "Gamla stan", lat: 59.32316, lon: 18.067617, passengers: 19800 },
  { id: "globen", name: "Globen", lat: 59.294278, lon: 18.077972, passengers: 5000 },
  { id: "gubbangen", name: "Gubbängen", lat: 59.262879, lon: 18.082036, passengers: 3500 },
  { id: "gullmarsplan", name: "Gullmarsplan", lat: 59.299114, lon: 18.080768, passengers: 29200 },
  { id: "gardet", name: "Gärdet", lat: 59.347206, lon: 18.098791, passengers: 7800 },
  { id: "hagsatra", name: "Hagsätra", lat: 59.262726, lon: 18.012486, passengers: 3400 },
  { id: "hallonbergen", name: "Hallonbergen", lat: 59.37545, lon: 17.969212, passengers: 5800 },
  { id: "hallunda", name: "Hallunda", lat: 59.243273, lon: 17.825609, passengers: 3300 },
  { id: "hammarbyhojden", name: "Hammarbyhöjden", lat: 59.294763, lon: 18.104554, passengers: 3200 },
  { id: "hjulsta", name: "Hjulsta", lat: 59.396171, lon: 17.887716, passengers: 1700 },
  { id: "hornstull", name: "Hornstull", lat: 59.315834, lon: 18.034024, passengers: 13100 },
  { id: "husby", name: "Husby", lat: 59.410257, lon: 17.925641, passengers: 4500 },
  { id: "huvudsta", name: "Huvudsta", lat: 59.349544, lon: 17.985698, passengers: 3000 },
  { id: "hagerstensasen", name: "Hägerstensåsen", lat: 59.295572, lon: 17.979154, passengers: 4700 },
  { id: "hasselby-gard", name: "Hässelby gård", lat: 59.366902, lon: 17.843767, passengers: 4600 },
  { id: "hasselby-strand", name: "Hässelby strand", lat: 59.361283, lon: 17.832351, passengers: 3500 },
  { id: "hogdalen", name: "Högdalen", lat: 59.263795, lon: 18.043004, passengers: 6600 },
  { id: "hokarangen", name: "Hökarängen", lat: 59.257925, lon: 18.082494, passengers: 5300 },
  { id: "hotorget", name: "Hötorget", lat: 59.335529, lon: 18.063536, passengers: 21600 },
  { id: "islandstorget", name: "Islandstorget", lat: 59.345858, lon: 17.894017, passengers: 2300 },
  { id: "johannelund", name: "Johannelund", lat: 59.367944, lon: 17.857467, passengers: 700 },
  { id: "karlaplan", name: "Karlaplan", lat: 59.33881, lon: 18.090863, passengers: 10300 },
  { id: "kista", name: "Kista", lat: 59.402868, lon: 17.942433, passengers: 12000 },
  { id: "kristineberg", name: "Kristineberg", lat: 59.332815, lon: 18.003182, passengers: 4800 },
  { id: "kungstradgarden", name: "Kungsträdgården", lat: 59.330783, lon: 18.073298, passengers: 6600 },
  { id: "karrtorp", name: "Kärrtorp", lat: 59.284507, lon: 18.114478, passengers: 3200 },
  { id: "liljeholmen", name: "Liljeholmen", lat: 59.31071, lon: 18.023129, passengers: 23900 },
  { id: "mariatorget", name: "Mariatorget", lat: 59.316958, lon: 18.063311, passengers: 13200 },
  { id: "masmo", name: "Masmo", lat: 59.249682, lon: 17.880336, passengers: 1800 },
  { id: "medborgarplatsen", name: "Medborgarplatsen", lat: 59.314342, lon: 18.07355, passengers: 17500 },
  { id: "midsommarkransen", name: "Midsommarkransen", lat: 59.301856, lon: 18.012037, passengers: 4400 },
  { id: "malarhojden", name: "Mälarhöjden", lat: 59.300921, lon: 17.957283, passengers: 1900 },
  { id: "morby-centrum", name: "Mörby centrum", lat: 59.398706, lon: 18.036218, passengers: 5400 },
  { id: "norsborg", name: "Norsborg", lat: 59.243794, lon: 17.814526, passengers: 2200 },
  { id: "nackrosen", name: "Näckrosen", lat: 59.36674, lon: 17.98328, passengers: 3800 },
  { id: "odenplan", name: "Odenplan", lat: 59.342954, lon: 18.049701, passengers: 32500 },
  { id: "rinkeby", name: "Rinkeby", lat: 59.388161, lon: 17.928778, passengers: 5800 },
  { id: "rissne", name: "Rissne", lat: 59.375837, lon: 17.939961, passengers: 5100 },
  { id: "ropsten", name: "Ropsten", lat: 59.357301, lon: 18.102216, passengers: 13600 },
  { id: "racksta", name: "Råcksta", lat: 59.354802, lon: 17.881819, passengers: 4100 },
  { id: "radhuset", name: "Rådhuset", lat: 59.330298, lon: 18.04207, passengers: 9600 },
  { id: "radmansgatan", name: "Rådmansgatan", lat: 59.340572, lon: 18.058771, passengers: 15100 },
  { id: "ragsved", name: "Rågsved", lat: 59.256577, lon: 18.028136, passengers: 4500 },
  { id: "sandsborg", name: "Sandsborg", lat: 59.284785, lon: 18.092382, passengers: 2700 },
  { id: "sankt-eriksplan", name: "S:t Eriksplan", lat: 59.339655, lon: 18.036991, passengers: 14300 },
  { id: "skanstull", name: "Skanstull", lat: 59.307852, lon: 18.076229, passengers: 20100 },
  { id: "skarpnack", name: "Skarpnäck", lat: 59.266816, lon: 18.133346, passengers: 3500 },
  { id: "skogskyrkogarden", name: "Skogskyrkogården", lat: 59.279194, lon: 18.095501, passengers: 1500 },
  { id: "skarholmen", name: "Skärholmen", lat: 59.277144, lon: 17.907007, passengers: 10100 },
  { id: "skarmarbrink", name: "Skärmarbrink", lat: 59.295366, lon: 18.09044, passengers: 2700 },
  { id: "slussen", name: "Slussen", lat: 59.319493, lon: 18.072327, passengers: 67000 },
  { id: "sockenplan", name: "Sockenplan", lat: 59.283302, lon: 18.070592, passengers: 1700 },
  { id: "solna-centrum", name: "Solna centrum", lat: 59.358856, lon: 17.998975, passengers: 9300 },
  { id: "solna-strand", name: "Solna strand", lat: 59.354191, lon: 17.973985, passengers: 2300 },
  { id: "stadion", name: "Stadion", lat: 59.342963, lon: 18.081703, passengers: 7000 },
  { id: "stadshagen", name: "Stadshagen", lat: 59.336959, lon: 18.017322, passengers: 6400 },
  { id: "stora-mossen", name: "Stora mossen", lat: 59.334532, lon: 17.966192, passengers: 2000 },
  { id: "stureby", name: "Stureby", lat: 59.2746, lon: 18.055625, passengers: 1800 },
  { id: "sundbybergs-centrum", name: "Sundbybergs centrum", lat: 59.360897, lon: 17.972214, passengers: 8200 },
  { id: "svedmyra", name: "Svedmyra", lat: 59.277639, lon: 18.06723, passengers: 2400 },
  { id: "satra", name: "Sätra", lat: 59.284983, lon: 17.921371, passengers: 4100 },
  { id: "tallkrogen", name: "Tallkrogen", lat: 59.27114, lon: 18.085326, passengers: 1700 },
  { id: "tcentralen", name: "T-Centralen", lat: 59.330945, lon: 18.059266, passengers: 134100 },
  { id: "tekniska-hogskolan", name: "Tekniska högskolan", lat: 59.345822, lon: 18.071716, passengers: 17200 },
  { id: "telefonplan", name: "Telefonplan", lat: 59.298323, lon: 17.997231, passengers: 8000 },
  { id: "tensta", name: "Tensta", lat: 59.394481, lon: 17.901164, passengers: 5100 },
  { id: "thorildsplan", name: "Thorildsplan", lat: 59.331389, lon: 18.014722, passengers: 6800 },
  { id: "universitetet", name: "Universitetet", lat: 59.365571, lon: 18.054888, passengers: 7200 },
  { id: "varberg", name: "Vårberg", lat: 59.275931, lon: 17.890161, passengers: 6200 },
  { id: "varby-gard", name: "Vårby gård", lat: 59.264613, lon: 17.884399, passengers: 3100 },
  { id: "vallingby", name: "Vällingby", lat: 59.363252, lon: 17.872066, passengers: 9500 },
  { id: "vastertorp", name: "Västertorp", lat: 59.291383, lon: 17.966668, passengers: 3200 },
  { id: "vastra-skogen", name: "Västra skogen", lat: 59.347476, lon: 18.003991, passengers: 6000 },
  { id: "zinkensdamm", name: "Zinkensdamm", lat: 59.317776, lon: 18.050151, passengers: 5500 },
  { id: "akeshov", name: "Åkeshov", lat: 59.342038, lon: 17.924904, passengers: 1800 },
  { id: "angbyplan", name: "Ängbyplan", lat: 59.341885, lon: 17.907052, passengers: 2300 },
  { id: "ornsberg", name: "Örnsberg", lat: 59.305532, lon: 17.989204, passengers: 3400 },
  { id: "ostermalmstorg", name: "Östermalmstorg", lat: 59.334972, lon: 18.07408, passengers: 22900 },
];

const lonRange = { min: 17.81, max: 18.14 };
const latRange = { min: 59.23, max: 59.42 };
const maxPassengers = 134100;
const interchangeStations = new Set(["alvik", "fridhemsplan", "gamla-stan", "gullmarsplan", "liljeholmen", "slussen", "tcentralen"]);
const jobsStations = new Set([
  "danderyds-sjukhus",
  "gardet",
  "hotorget",
  "karlaplan",
  "kista",
  "kungstradgarden",
  "odenplan",
  "ropsten",
  "solna-centrum",
  "sundbybergs-centrum",
  "tekniska-hogskolan",
  "universitetet",
  "ostermalmstorg",
]);
const cultureStations = new Set(["globen", "mariatorget", "medborgarplatsen", "skanstull", "stadion"]);

export const districts: District[] = stationSeeds.map((station) => ({
  id: station.id,
  name: station.name,
  lat: station.lat,
  lon: station.lon,
  x: Math.round(80 + ((station.lon - lonRange.min) / (lonRange.max - lonRange.min)) * 1240),
  y: Math.round(950 - ((station.lat - latRange.min) / (latRange.max - latRange.min)) * 860),
  demand: Math.min(100, Math.max(12, Math.round(12 + Math.sqrt(station.passengers / maxPassengers) * 88))),
  type: interchangeStations.has(station.id)
    ? "interchange"
    : jobsStations.has(station.id)
      ? "jobs"
      : cultureStations.has(station.id)
        ? "culture"
        : "homes",
}));

export const water: [number, number][][] = [
  [[0, 450], [250, 430], [430, 470], [620, 520], [760, 535], [930, 500], [1400, 520], [1400, 660], [1040, 640], [850, 680], [690, 630], [520, 600], [330, 555], [0, 585]],
  [[470, 0], [570, 0], [620, 230], [595, 390], [520, 430], [460, 360]],
  [[860, 285], [1400, 220], [1400, 360], [1040, 390], [900, 365]],
];

export const landLabels = [
  ["Norra Stockholm", 250, 115],
  ["Innerstaden", 700, 450],
  ["Sodermalm", 645, 720],
  ["Sodra fororter", 520, 930],
  ["Nacka", 1100, 775],
];

export const initialGameState: GameState = {
  gameVersion: 8,
  budget: 950,
  paused: false,
  activeLine: 0,
  mode: "station",
  selected: null,
  hint: "Start lean with CX trains. Complete growth objectives to unlock better trainsets, permits, and high-frequency service.",
  history: [],
  actionCount: 0,
  month: 1,
  politicalCapital: 3,
  councilSupport: 52,
  ticketPrice: 39,
  fundingRequests: 0,
  activeEvent: null,
  eventServices: [],
  nextEventMonth: 2,
  nextHearingMonth: 1,
  nextFundingMonth: 1,
  hearingFatigue: 0,
  economyHistory: [
    { month: 1, budget: 950, revenue: 0, operatingCost: 34, netIncome: -34, support: 52, riders: 0, ticketPrice: 39, trainsets: 1, eventCapacity: 0 },
  ],
  unlocked: {
    c20: false,
    c30: false,
    express: false,
    surface: false,
    grants: false,
    highFrequency: false,
  },
  lines: [
    { name: "Gröna linjen", color: colors[0], stations: ["tcentralen"], segments: [], anchor: "tcentralen", frequency: 7, express: [], fleet: { CX: 1, C20: 0, C30: 0 } },
  ],
};
