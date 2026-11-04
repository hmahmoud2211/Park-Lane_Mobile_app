/**
 * The demo compound's layout: levels, roads, buildings, gates, zones, bays,
 * chargers and the road graph that directions are computed from.
 *
 * Everything here is fictional and exists to be replaced. Each level has its
 * own map canvas (MAP_SIZE units); geo coordinates are demo values near New
 * Capital and do not mark real gates. A real site loads this from its asset
 * register, and routes are recomputed from the graph (see routing.ts).
 */
import type {
  Building,
  Charger,
  Connector,
  Entity,
  Gate,
  LevelId,
  MapPoint,
  MapRect,
  ParkingSpace,
  ParkingZone,
  Property,
  PropertyAssociation,
  Resident,
  Vehicle,
  WalkTarget,
} from './types';

type Def<T extends Entity> = Omit<T, 'createdAt' | 'updatedAt' | 'version'>;

export const MAP_SIZE = { width: 360, height: 480 } as const;

/* --------------------------------------------------------------- Levels */

export interface LevelDef {
  id: LevelId;
  name: string;
  /** Tab label on the map. */
  short: string;
  indoor: boolean;
}

export const levels: readonly LevelDef[] = [
  { id: 'ground', name: 'Ground level', short: 'Ground', indoor: false },
  { id: 'b1', name: 'Basement 1 · EV Hub', short: 'B1 · EV Hub', indoor: true },
  { id: 'b2', name: 'Basement 2 · Residents', short: 'B2 · Residents', indoor: true },
];

export const levelName = (id: LevelId) => levels.find((l) => l.id === id)?.name ?? id;

/* ------------------------------------------------------------ Road graph */

export interface RoadNode extends MapPoint {
  id: string;
  levelId: LevelId;
}

export interface RoadEdge {
  from: string;
  to: string;
  /** "Main Avenue". Spoken in directions. */
  name: string;
  kind: 'road' | 'aisle' | 'ramp';
  /** A short connector that directions do not mention, e.g. the foot of a ramp. */
  silent?: boolean;
}

export const roadNodes: readonly RoadNode[] = [
  // Ground: the gates, the junctions and the tops of the ramps.
  { id: 'gate-1', levelId: 'ground', x: 6, y: 160 },
  { id: 'gate-2', levelId: 'ground', x: 354, y: 160 },
  { id: 'gate-3', levelId: 'ground', x: 180, y: 474 },
  { id: 'j-main-central', levelId: 'ground', x: 180, y: 160 },
  { id: 'j-central-south', levelId: 'ground', x: 180, y: 340 },
  { id: 'south-west', levelId: 'ground', x: 36, y: 340 },
  { id: 'south-east', levelId: 'ground', x: 324, y: 340 },
  { id: 'ramp-b1-top', levelId: 'ground', x: 110, y: 340 },
  { id: 'ramp-b2-top', levelId: 'ground', x: 250, y: 340 },
  // Basement 1: a one-way loop from the foot of the ramp.
  { id: 'b1-ramp-bottom', levelId: 'b1', x: 40, y: 84 },
  { id: 'b1-a1', levelId: 'b1', x: 40, y: 110 },
  { id: 'b1-a2', levelId: 'b1', x: 320, y: 110 },
  { id: 'b1-a3', levelId: 'b1', x: 320, y: 410 },
  { id: 'b1-a4', levelId: 'b1', x: 60, y: 410 },
  // Basement 2: the mirror image, entered from the east.
  { id: 'b2-ramp-bottom', levelId: 'b2', x: 320, y: 84 },
  { id: 'b2-a1', levelId: 'b2', x: 320, y: 110 },
  { id: 'b2-a2', levelId: 'b2', x: 40, y: 110 },
  { id: 'b2-a3', levelId: 'b2', x: 40, y: 410 },
  { id: 'b2-a4', levelId: 'b2', x: 300, y: 410 },
];

export const roadEdges: readonly RoadEdge[] = [
  { from: 'gate-1', to: 'j-main-central', name: 'Main Avenue', kind: 'road' },
  { from: 'j-main-central', to: 'gate-2', name: 'Main Avenue', kind: 'road' },
  { from: 'j-main-central', to: 'j-central-south', name: 'Central Avenue', kind: 'road' },
  { from: 'j-central-south', to: 'gate-3', name: 'Central Avenue', kind: 'road' },
  { from: 'j-central-south', to: 'ramp-b1-top', name: 'South Road', kind: 'road' },
  { from: 'ramp-b1-top', to: 'south-west', name: 'South Road', kind: 'road' },
  { from: 'j-central-south', to: 'ramp-b2-top', name: 'South Road', kind: 'road' },
  { from: 'ramp-b2-top', to: 'south-east', name: 'South Road', kind: 'road' },
  { from: 'ramp-b1-top', to: 'b1-ramp-bottom', name: 'Ramp to Basement 1', kind: 'ramp' },
  { from: 'ramp-b2-top', to: 'b2-ramp-bottom', name: 'Ramp to Basement 2', kind: 'ramp' },
  { from: 'b1-ramp-bottom', to: 'b1-a1', name: 'Ramp exit', kind: 'aisle', silent: true },
  { from: 'b1-a1', to: 'b1-a2', name: 'Aisle 1', kind: 'aisle' },
  { from: 'b1-a2', to: 'b1-a3', name: 'Aisle 2', kind: 'aisle' },
  { from: 'b1-a3', to: 'b1-a4', name: 'Aisle 3', kind: 'aisle' },
  { from: 'b2-ramp-bottom', to: 'b2-a1', name: 'Ramp exit', kind: 'aisle', silent: true },
  { from: 'b2-a1', to: 'b2-a2', name: 'Aisle 1', kind: 'aisle' },
  { from: 'b2-a2', to: 'b2-a3', name: 'Aisle 2', kind: 'aisle' },
  { from: 'b2-a3', to: 'b2-a4', name: 'Aisle 3', kind: 'aisle' },
];

/* --------------------------------------------------------------- Ramps */

export interface RampDef {
  id: string;
  /** The ground node at the top of the ramp. */
  topNodeId: string;
  /** The basement node at its foot. */
  bottomNodeId: string;
  toLevel: LevelId;
  label: string;
  /** The ramp's mouth on the ground map, and the path into it. */
  ground: MapRect;
  groundPath: MapPoint[];
  /** Where it arrives on the basement map, and the path out of it. */
  landing: MapRect;
  landingPath: MapPoint[];
}

export const ramps: readonly RampDef[] = [
  {
    id: 'ramp-b1',
    topNodeId: 'ramp-b1-top',
    bottomNodeId: 'b1-ramp-bottom',
    toLevel: 'b1',
    label: 'B1 · EV Hub',
    ground: { x: 96, y: 354, w: 28, h: 38 },
    groundPath: [
      { x: 110, y: 340 },
      { x: 110, y: 390 },
    ],
    landing: { x: 24, y: 36, w: 32, h: 40 },
    landingPath: [
      { x: 40, y: 40 },
      { x: 40, y: 84 },
    ],
  },
  {
    id: 'ramp-b2',
    topNodeId: 'ramp-b2-top',
    bottomNodeId: 'b2-ramp-bottom',
    toLevel: 'b2',
    label: 'B2 · Residents',
    ground: { x: 236, y: 354, w: 28, h: 38 },
    groundPath: [
      { x: 250, y: 340 },
      { x: 250, y: 390 },
    ],
    landing: { x: 304, y: 36, w: 32, h: 40 },
    landingPath: [
      { x: 320, y: 40 },
      { x: 320, y: 84 },
    ],
  },
];

/* -------------------------------------------------------------- Drawing */

export interface RoadDraw {
  id: string;
  levelId: LevelId;
  name: string;
  points: MapPoint[];
  width: number;
  kind: 'road' | 'aisle';
  /** Where the name is written. */
  label?: MapPoint;
  /** Aisles in the basements run one way, shown with arrows. */
  oneWay?: boolean;
}

export const roads: readonly RoadDraw[] = [
  { id: 'main', levelId: 'ground', name: 'Main Avenue', kind: 'road', width: 24, points: [{ x: 6, y: 160 }, { x: 354, y: 160 }], label: { x: 46, y: 169 } },
  { id: 'central', levelId: 'ground', name: 'Central Avenue', kind: 'road', width: 24, points: [{ x: 180, y: 160 }, { x: 180, y: 474 }], label: { x: 196, y: 314 } },
  { id: 'south', levelId: 'ground', name: 'South Road', kind: 'road', width: 22, points: [{ x: 36, y: 340 }, { x: 324, y: 340 }], label: { x: 272, y: 348 } },
  { id: 'b1-loop', levelId: 'b1', name: 'Aisles', kind: 'aisle', width: 26, oneWay: true, points: [{ x: 40, y: 84 }, { x: 40, y: 110 }, { x: 320, y: 110 }, { x: 320, y: 410 }, { x: 60, y: 410 }] },
  { id: 'b2-loop', levelId: 'b2', name: 'Aisles', kind: 'aisle', width: 26, oneWay: true, points: [{ x: 320, y: 84 }, { x: 320, y: 110 }, { x: 40, y: 110 }, { x: 40, y: 410 }, { x: 300, y: 410 }] },
];

/** Aisle names written on the basement maps; `anchor` aligns the text to the point. */
export const aisleLabels: readonly (MapPoint & { levelId: LevelId; text: string; anchor: 'start' | 'middle' | 'end' })[] = [
  { levelId: 'b1', x: 196, y: 92, text: 'Aisle 1 →', anchor: 'middle' },
  { levelId: 'b1', x: 303, y: 262, text: 'Aisle 2 ↓', anchor: 'end' },
  { levelId: 'b1', x: 190, y: 438, text: '← Aisle 3', anchor: 'middle' },
  { levelId: 'b2', x: 164, y: 92, text: '← Aisle 1', anchor: 'middle' },
  { levelId: 'b2', x: 57, y: 262, text: 'Aisle 2 ↓', anchor: 'start' },
  { levelId: 'b2', x: 170, y: 438, text: 'Aisle 3 →', anchor: 'middle' },
];

export interface LiftDef {
  id: string;
  levelId: LevelId;
  label: string;
  /** Where it leads, in directions: "the Building C lobby". */
  leadsTo: string;
  rect: MapRect;
  door: MapPoint;
}

export const lifts: readonly LiftDef[] = [
  { id: 'lift-c', levelId: 'b1', label: 'Lift C', leadsTo: 'the Building C lobby', rect: { x: 22, y: 214, w: 36, h: 36 }, door: { x: 40, y: 214 } },
  { id: 'lift-a', levelId: 'b2', label: 'Lift A', leadsTo: 'the Building A lobby', rect: { x: 302, y: 214, w: 36, h: 36 }, door: { x: 320, y: 214 } },
];

export interface LandscapeDef extends MapRect {
  id: string;
  levelId: LevelId;
  kind: 'garden' | 'water' | 'landmark';
  label?: string;
}

export const landscape: readonly LandscapeDef[] = [
  { id: 'garden-w', levelId: 'ground', kind: 'garden', x: 20, y: 402, w: 138, h: 60, label: 'Garden' },
  { id: 'garden-e', levelId: 'ground', kind: 'garden', x: 202, y: 402, w: 138, h: 60, label: 'Garden' },
  { id: 'club', levelId: 'ground', kind: 'landmark', x: 206, y: 208, w: 128, h: 82, label: 'Clubhouse' },
  { id: 'pool', levelId: 'ground', kind: 'water', x: 222, y: 230, w: 96, h: 46, label: 'Pool' },
];

/** Pedestrian walkways, drawn as paths. */
export const walkways: readonly { levelId: LevelId; points: MapPoint[] }[] = [
  { levelId: 'ground', points: [{ x: 26, y: 103 }, { x: 154, y: 103 }] },
  { levelId: 'ground', points: [{ x: 206, y: 103 }, { x: 334, y: 103 }] },
  { levelId: 'b1', points: [{ x: 40, y: 200 }, { x: 300, y: 200 }] },
  { levelId: 'b2', points: [{ x: 60, y: 200 }, { x: 320, y: 200 }] },
];

/** Bays that are not bookable (general and other residents' bays), drawn for context only. */
export const otherBays: readonly (MapRect & { levelId: LevelId; note?: string })[] = [
  ...Array.from({ length: 7 }, (_, i) => ({ levelId: 'b1' as const, x: 72 + i * 32, y: 348, w: 26, h: 40 })),
  ...[0, 1].map((i) => ({ levelId: 'b2' as const, x: 62 + i * 40, y: 130, w: 32, h: 46 })),
  ...Array.from({ length: 7 }, (_, i) => ({ levelId: 'b2' as const, x: 72 + i * 32, y: 348, w: 26, h: 40 })),
];

export const otherBayNotes: readonly (MapPoint & { levelId: LevelId; text: string })[] = [
  { levelId: 'b1', x: 180, y: 340, text: 'General parking' },
  { levelId: 'b2', x: 180, y: 340, text: 'Residents’ bays' },
];

/** Structural columns, which drivers use as landmarks underground. */
export const columns: readonly (MapPoint & { levelId: LevelId })[] = (['b1', 'b2'] as const).flatMap((levelId) =>
  [90, 150, 210, 270].map((x) => ({ levelId, x, y: 290 })),
);

/* --------------------------------------------------------------- Zones */

export interface ZoneLayout {
  /** The road or aisle the zone's bays open onto. */
  attach: [string, string];
  /** Walking directions from a bay: along `viaY`, to `to`, which is `target`. */
  walk: { viaY: number; to: MapPoint; target: WalkTarget };
}

export const zoneLayouts: Readonly<Record<string, ZoneLayout>> = {
  'zone-v1': { attach: ['gate-1', 'j-main-central'], walk: { viaY: 103, to: { x: 90, y: 98 }, target: { kind: 'entrance', building: 'A' } } },
  'zone-v2': { attach: ['j-main-central', 'gate-2'], walk: { viaY: 103, to: { x: 270, y: 98 }, target: { kind: 'entrance', building: 'B' } } },
  'zone-ev': { attach: ['b1-a1', 'b1-a2'], walk: { viaY: 200, to: { x: 40, y: 214 }, target: { kind: 'lift', lift: 'C', building: 'C' } } },
  'zone-r': { attach: ['b2-a1', 'b2-a2'], walk: { viaY: 200, to: { x: 320, y: 214 }, target: { kind: 'lift', lift: 'A', building: 'A' } } },
};

/* ------------------------------------------------------------- Entities */

export const buildingDefs: Def<Building>[] = [
  { id: 'bld-a', name: 'Building A', map: { x: 26, y: 30, w: 128, h: 68 }, door: { x: 90, y: 98 } },
  { id: 'bld-b', name: 'Building B', map: { x: 206, y: 30, w: 128, h: 68 }, door: { x: 270, y: 98 } },
  { id: 'bld-c', name: 'Building C', map: { x: 26, y: 208, w: 128, h: 82 }, door: { x: 90, y: 208 } },
];

export const zoneDefs: Def<ParkingZone>[] = [
  { id: 'zone-v1', name: 'Visitor Court North', level: 'Ground', levelId: 'ground', indoor: false, kind: 'visitor' },
  { id: 'zone-v2', name: 'Visitor Lane East', level: 'Ground', levelId: 'ground', indoor: false, kind: 'visitor' },
  { id: 'zone-ev', name: 'EV Hub', level: 'Basement 1', levelId: 'b1', indoor: true, kind: 'ev' },
  { id: 'zone-r', name: 'Residents', level: 'Basement 2', levelId: 'b2', indoor: true, kind: 'resident' },
];

const DEMO_LAT = 30.0185;
const DEMO_LNG = 31.7612;

export const gateDefs: Def<Gate>[] = [
  {
    id: 'gate-1',
    name: 'Gate 1 · Main Gate',
    description: 'West entrance, off the boulevard',
    direction: 'both',
    zoneIds: ['zone-v1', 'zone-r'],
    geo: { lat: DEMO_LAT, lng: DEMO_LNG },
    map: { x: 6, y: 160 },
  },
  {
    id: 'gate-2',
    name: 'Gate 2 · East Gate',
    description: 'East entrance, by the clubhouse',
    direction: 'both',
    zoneIds: ['zone-v2', 'zone-ev', 'zone-r'],
    geo: { lat: DEMO_LAT + 0.0004, lng: DEMO_LNG + 0.0042 },
    map: { x: 354, y: 160 },
  },
  {
    id: 'gate-3',
    name: 'Gate 3 · Service Exit',
    description: 'South exit only',
    direction: 'exit',
    zoneIds: ['zone-v1', 'zone-v2', 'zone-ev', 'zone-r'],
    geo: { lat: DEMO_LAT - 0.0031, lng: DEMO_LNG + 0.0021 },
    map: { x: 180, y: 474 },
  },
];

/** A bay's fixed data; its route and written directions are computed in seed.ts. */
export type SpaceDef = Omit<
  Def<ParkingSpace>,
  'serviceability' | 'occupancy' | 'occupancySince' | 'occupiedByReservationId' | 'route' | 'instructions'
>;

const northBays: SpaceDef[] = Array.from({ length: 6 }, (_, i) => ({
  id: `sp-V-0${11 + i}`,
  label: `V-0${11 + i}`,
  zoneId: 'zone-v1',
  kind: 'visitor',
  buildingId: 'bld-a',
  gateId: 'gate-1',
  levelId: 'ground',
  map: { x: 30 + i * 21, y: 110, w: 18, h: 30 },
  geo: { lat: DEMO_LAT + 0.0009, lng: DEMO_LNG + 0.0006 + i * 0.00004 },
}));

const eastBays: SpaceDef[] = Array.from({ length: 6 }, (_, i) => ({
  id: `sp-V-0${21 + i}`,
  label: `V-0${21 + i}`,
  zoneId: 'zone-v2',
  kind: 'visitor',
  buildingId: 'bld-b',
  gateId: 'gate-2',
  levelId: 'ground',
  map: { x: 312 - i * 21, y: 110, w: 18, h: 30 },
  geo: { lat: DEMO_LAT + 0.0011, lng: DEMO_LNG + 0.0038 - i * 0.00004 },
}));

const evBays: SpaceDef[] = Array.from({ length: 6 }, (_, i) => ({
  id: `sp-EV-0${i + 1}`,
  label: `EV-0${i + 1}`,
  zoneId: 'zone-ev',
  kind: 'ev',
  buildingId: 'bld-c',
  gateId: 'gate-2',
  levelId: 'b1',
  map: { x: 62 + i * 40, y: 130, w: 32, h: 46 },
}));

/** The residents' own bays in Basement 2; only P2-148 is assigned in the demo. */
const residentBays: SpaceDef[] = ['P2-146', 'P2-147', 'P2-148', 'P2-149'].map((label, i) => ({
  id: `sp-${label}`,
  label,
  zoneId: 'zone-r',
  kind: 'resident',
  buildingId: 'bld-a',
  gateId: 'gate-1',
  levelId: 'b2',
  map: { x: 142 + i * 40, y: 130, w: 32, h: 46 },
}));

export const spaceDefs: SpaceDef[] = [...northBays, ...eastBays, ...evBays, ...residentBays];

export const chargerDefs: Def<Charger>[] = [
  { id: 'chg-a', label: 'Charger A · AC 22 kW', current: 'AC', powerKw: 22, status: 'available', maxConcurrent: 2, map: { levelId: 'b1', x: 98, y: 186 } },
  // Two plugs, one power cabinet: only one car charges at a time.
  { id: 'chg-b', label: 'Charger B · DC 60 kW', current: 'DC', powerKw: 60, status: 'available', maxConcurrent: 1, map: { levelId: 'b1', x: 178, y: 186 } },
  { id: 'chg-c', label: 'Charger C · AC 11 kW', current: 'AC', powerKw: 11, status: 'available', maxConcurrent: 1, map: { levelId: 'b1', x: 238, y: 186 } },
  { id: 'chg-d', label: 'Charger D · DC 50 kW', current: 'DC', powerKw: 50, status: 'available', maxConcurrent: 1, map: { levelId: 'b1', x: 278, y: 186 } },
];

export const connectorDefs: Def<Connector>[] = [
  { id: 'con-a1', chargerId: 'chg-a', type: 'Type 2', spaceId: 'sp-EV-01' },
  { id: 'con-a2', chargerId: 'chg-a', type: 'Type 2', spaceId: 'sp-EV-02' },
  { id: 'con-b1', chargerId: 'chg-b', type: 'CCS2', spaceId: 'sp-EV-03' },
  { id: 'con-b2', chargerId: 'chg-b', type: 'CHAdeMO', spaceId: 'sp-EV-04' },
  { id: 'con-c1', chargerId: 'chg-c', type: 'Type 2', spaceId: 'sp-EV-05' },
  { id: 'con-d1', chargerId: 'chg-d', type: 'CCS2', spaceId: 'sp-EV-06' },
  { id: 'con-d2', chargerId: 'chg-d', type: 'GB/T', spaceId: 'sp-EV-06' },
];

export const residentDefs: Def<Resident>[] = [
  { id: 'res-ahmed', name: 'Ahmed Hassan', phone: '+20 10 0000 0302', email: 'ahmed.demo@example.com' },
  { id: 'res-laila', name: 'Laila Mansour', phone: '+20 11 0000 0705', email: 'laila.demo@example.com' },
];

export const propertyDefs: Def<Property>[] = [
  { id: 'prop-a302', label: 'Apartment A-302', buildingId: 'bld-a', assignedSpaceId: 'sp-P2-148', mapEntrance: { x: 90, y: 98 } },
  { id: 'prop-b1104', label: 'Apartment B-1104', buildingId: 'bld-b', mapEntrance: { x: 270, y: 98 } },
  { id: 'prop-c0705', label: 'Apartment C-0705', buildingId: 'bld-c', mapEntrance: { x: 90, y: 208 } },
];

export const associationDefs: Def<PropertyAssociation>[] = [
  { id: 'asc-1', residentId: 'res-ahmed', propertyId: 'prop-a302', role: 'owner' },
  { id: 'asc-2', residentId: 'res-ahmed', propertyId: 'prop-b1104', role: 'owner' },
  { id: 'asc-3', residentId: 'res-laila', propertyId: 'prop-c0705', role: 'owner' },
];

export const vehicleDefs: Def<Vehicle>[] = [
  { id: 'veh-bmw', residentId: 'res-ahmed', make: 'BMW', model: 'X5 xDrive', colour: 'Black', plate: 'EGY 5678', plateCountry: 'Egypt' },
  {
    id: 'veh-ioniq',
    residentId: 'res-ahmed',
    make: 'Hyundai',
    model: 'Ioniq 5',
    colour: 'White',
    plate: 'EGY 2468',
    plateCountry: 'Egypt',
    ev: { connectors: ['Type 2', 'CCS2'], maxAcKw: 11, maxDcKw: 220, batteryKwh: 77 },
  },
  {
    id: 'veh-ev6',
    residentId: 'res-laila',
    make: 'Kia',
    model: 'EV6',
    colour: 'Grey',
    plate: 'EGY 1357',
    plateCountry: 'Egypt',
    ev: { connectors: ['Type 2', 'CCS2'], maxAcKw: 11, maxDcKw: 230, batteryKwh: 77 },
  },
];

/** The signed-in resident until the app has real accounts. */
export const DEMO_RESIDENT_ID = 'res-ahmed';
