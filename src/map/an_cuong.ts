// "An Cuong-alike" — ship map v1. Pure data: terrain regions painted in order
// (later regions override earlier), capture points, HQ zones, roads.
// Terrain layout IS the level design (bible §4.2).
import type { Vec } from '../vec';
import type { TerrainKey } from '../config';

export type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'poly'; pts: Vec[] }
  | { kind: 'circle'; c: Vec; r: number }
  | { kind: 'stroke'; pts: Vec[]; width: number }; // polyline with thickness

export interface Region { terrain: TerrainKey; shape: Shape }

export interface CapturePoint { id: number; name: string; pos: Vec }
export interface HqZone { side: 'US' | 'PAVN'; rect: { x: number; y: number; w: number; h: number } }

export interface MapDefenses {
  wires: { a: Vec; b: Vec }[];
  trenches: { a: Vec; b: Vec; side: 'US' | 'PAVN' }[];
  bunkers: { pos: Vec; side: 'US' | 'PAVN' }[];
}

export interface MapData {
  name: string;
  width: number;
  height: number;
  regions: Region[];
  points: CapturePoint[];
  hqs: HqZone[];
  defenses: MapDefenses;
  /** x-coordinate midpoints between consecutive points; used for sector lines (Phase 3). */
}

/** The map is authored at 1200×800 and scaled up: bigger world, same relative layout. */
export const MAP_SCALE = 2.0;
const K = MAP_SCALE;
const P = (x: number, y: number): Vec => ({ x: x * K, y: y * K });
const R = (x: number, y: number, w: number, h: number) => ({ x: x * K, y: y * K, w: w * K, h: h * K });

// River centreline, north → south, then offset into a band polygon.
const RIVER_CENTER: Vec[] = [
  P(562, -10), P(548, 110), P(572, 230), P(556, 350), P(582, 470),
  P(560, 590), P(588, 700), P(570, 810),
];
const RIVER_HALF_W = 17 * K;
function riverPoly(center: Vec[], halfW: number): Vec[] {
  // center points are already in map coordinates — do NOT re-scale them here
  const raw = (x: number, y: number): Vec => ({ x, y });
  const left = center.map((p) => raw(p.x - halfW, p.y));
  const right = center.map((p) => raw(p.x + halfW, p.y)).reverse();
  return [...left, ...right];
}

const ROAD_MAIN: Vec[] = [
  P(0, 400), P(120, 400), P(230, 420), P(380, 360), P(440, 330), P(520, 300),
  P(610, 300), P(650, 450), P(760, 420), P(840, 340), P(960, 380), P(1030, 430),
  P(1120, 420), P(1200, 420),
];
const ROAD_SOUTH: Vec[] = [P(230, 420), P(380, 520), P(530, 521), P(620, 521), P(650, 450)];
const ROAD_NORTH_SPUR: Vec[] = [P(840, 340), P(880, 220), P(900, 90)];
// southern main supply route + a farm road on the west bank
const ROAD_SOUTH_MAIN: Vec[] = [P(0, 600), P(130, 615), P(260, 640), P(380, 640), P(530, 620), P(620, 560), P(650, 450)];
const ROAD_WEST_FARM: Vec[] = [P(230, 420), P(210, 300), P(240, 200), P(330, 140)];
// trails: narrow tracks — vehicles make decent time, infantry unaffected
const TRAIL_VILLAGE_BRIDGE: Vec[] = [P(440, 330), P(500, 430), P(546, 521)];
const TRAIL_FORD: Vec[] = [P(330, 140), P(460, 110), P(520, 97), P(584, 97), P(680, 130), P(760, 180), P(840, 260), P(840, 340)];
const TRAIL_EAST_SOUTH: Vec[] = [P(1030, 430), P(1000, 560), P(940, 640), P(800, 700)];
const TRAIL_MIDDLE_SOUTH: Vec[] = [P(650, 450), P(680, 560), P(700, 650), P(700, 760)];
const TRAIL_EAST_NORTH: Vec[] = [P(840, 340), P(950, 300), P(1060, 280), P(1150, 300), P(1200, 340)];

export const AN_CUONG: MapData = {
  name: 'An Cuong',
  width: 1200 * K,
  height: 800 * K,
  regions: [
    // --- Woods: the north corridor (infiltration highway) ---
    {
      terrain: 'woods',
      shape: {
        kind: 'poly',
        pts: [
          P(0, 0), P(1200, 0), P(1200, 175), P(1080, 150), P(960, 168), P(850, 135),
          P(720, 160), P(600, 140), P(470, 165), P(330, 130), P(200, 160), P(90, 135), P(0, 170),
        ],
      },
    },
    // --- Woods: scattered cover patches south of the lane ---
    { terrain: 'woods', shape: { kind: 'poly', pts: [P(110, 560), P(300, 540), P(330, 640), P(250, 720), P(120, 700)] } },
    { terrain: 'woods', shape: { kind: 'poly', pts: [P(640, 600), P(790, 590), P(800, 700), P(700, 760), P(630, 720)] } },
    { terrain: 'woods', shape: { kind: 'poly', pts: [P(900, 610), P(1080, 600), P(1100, 720), P(940, 740), P(890, 680)] } },
    { terrain: 'woods', shape: { kind: 'poly', pts: [P(380, 760), P(620, 745), P(640, 800), P(370, 800)] } },
    // small copses that offer cover near the mid-lane points
    { terrain: 'woods', shape: { kind: 'poly', pts: [P(300, 250), P(370, 240), P(385, 300), P(320, 310)] } },
    { terrain: 'woods', shape: { kind: 'poly', pts: [P(690, 540), P(760, 530), P(780, 575), P(700, 585)] } },
    { terrain: 'woods', shape: { kind: 'poly', pts: [P(930, 470), P(1000, 480), P(990, 540), P(920, 530)] } },

    // --- Elephant grass: conceals, no cover — infiltration fields (new with the 1.5x map) ---
    { terrain: 'grass', shape: { kind: 'poly', pts: [P(150, 210), P(290, 195), P(330, 260), P(300, 330), P(170, 320)] } },
    { terrain: 'grass', shape: { kind: 'poly', pts: [P(470, 430), P(560, 415), P(600, 470), P(560, 505), P(470, 500)] } },
    { terrain: 'grass', shape: { kind: 'poly', pts: [P(660, 210), P(800, 195), P(830, 260), P(790, 300), P(670, 290)] } },
    { terrain: 'grass', shape: { kind: 'poly', pts: [P(880, 430), P(1010, 415), P(1050, 480), P(1000, 540), P(890, 520)] } },
    { terrain: 'grass', shape: { kind: 'poly', pts: [P(420, 630), P(560, 615), P(600, 680), P(540, 720), P(430, 700)] } },
    // --- Marsh: slow, exposed, no vehicles — pinches the southern route ---
    { terrain: 'marsh', shape: { kind: 'poly', pts: [P(590, 560), P(660, 545), P(700, 600), P(660, 650), P(600, 640)] } },
    { terrain: 'marsh', shape: { kind: 'poly', pts: [P(480, 130), P(560, 110), P(600, 170), P(560, 215), P(490, 205)] } },
    { terrain: 'marsh', shape: { kind: 'poly', pts: [P(1050, 560), P(1140, 545), P(1170, 610), P(1110, 660), P(1050, 640)] } },

    // --- River (impassable) ---
    { terrain: 'river', shape: { kind: 'poly', pts: riverPoly(RIVER_CENTER, RIVER_HALF_W) } },

    // --- Roads (pale lines) ---
    { terrain: 'road', shape: { kind: 'stroke', pts: ROAD_MAIN, width: 8 * K } },
    { terrain: 'road', shape: { kind: 'stroke', pts: ROAD_SOUTH, width: 8 * K } },
    { terrain: 'road', shape: { kind: 'stroke', pts: ROAD_NORTH_SPUR, width: 6 * K } },
    { terrain: 'road', shape: { kind: 'stroke', pts: ROAD_SOUTH_MAIN, width: 8 * K } },
    { terrain: 'road', shape: { kind: 'stroke', pts: ROAD_WEST_FARM, width: 6 * K } },
    { terrain: 'trail', shape: { kind: 'stroke', pts: TRAIL_VILLAGE_BRIDGE, width: 4 * K } },
    { terrain: 'trail', shape: { kind: 'stroke', pts: TRAIL_FORD, width: 4 * K } },
    { terrain: 'trail', shape: { kind: 'stroke', pts: TRAIL_EAST_SOUTH, width: 4 * K } },
    { terrain: 'trail', shape: { kind: 'stroke', pts: TRAIL_MIDDLE_SOUTH, width: 4 * K } },
    { terrain: 'trail', shape: { kind: 'stroke', pts: TRAIL_EAST_NORTH, width: 4 * K } },

    // --- Crossings: 2 bridges on the roads + 1 ford hidden in the north woods ---
    { terrain: 'bridge', shape: { kind: 'rect', ...R(536, 289, 58, 22) } },
    { terrain: 'bridge', shape: { kind: 'rect', ...R(546, 510, 58, 22) } },
    { terrain: 'ford', shape: { kind: 'rect', ...R(520, 80, 64, 34) } },

    // --- Villages: gray block clusters on points 2 and 4 ---
    { terrain: 'village', shape: { kind: 'rect', ...R(400, 292, 30, 22) } },
    { terrain: 'village', shape: { kind: 'rect', ...R(448, 286, 36, 26) } },
    { terrain: 'village', shape: { kind: 'rect', ...R(412, 344, 30, 22) } },
    { terrain: 'village', shape: { kind: 'rect', ...R(458, 340, 32, 26) } },
    { terrain: 'village', shape: { kind: 'rect', ...R(392, 372, 42, 20) } },
    { terrain: 'village', shape: { kind: 'rect', ...R(478, 310, 24, 20) } },

    { terrain: 'village', shape: { kind: 'rect', ...R(720, 300, 32, 24) } },
    { terrain: 'village', shape: { kind: 'rect', ...R(770, 296, 34, 26) } },
    { terrain: 'village', shape: { kind: 'rect', ...R(726, 356, 28, 22) } },
    { terrain: 'village', shape: { kind: 'rect', ...R(774, 354, 36, 24) } },
    { terrain: 'village', shape: { kind: 'rect', ...R(716, 384, 40, 18) } },
    { terrain: 'village', shape: { kind: 'rect', ...R(796, 326, 24, 20) } },

    // --- HQ zones (open, just flagged for spawning/fallback) ---
    { terrain: 'hq', shape: { kind: 'rect', ...R(0, 320, 90, 160) } },
    { terrain: 'hq', shape: { kind: 'rect', ...R(1110, 340, 90, 160) } },
  ],
  // warfare-symmetric lane: P1/P5 and P2/P4 mirror about x=600; the middle sits just east of the river
  points: [
    { id: 1, name: 'PADDY WEST', pos: P(230, 420) },
    { id: 2, name: 'AN CUONG', pos: P(440, 330) },
    { id: 3, name: 'RIVER BEND', pos: P(615, 450) },
    { id: 4, name: 'HILL HAMLET', pos: P(760, 340) },
    { id: 5, name: 'PADDY EAST', pos: P(970, 430) },
  ],
  hqs: [
    { side: 'US', rect: R(0, 320, 90, 160) },
    { side: 'PAVN', rect: R(1110, 340, 90, 160) },
  ],
  // Standing fortifications: each side's second point is dug in; wire pinches the middle corridors.
  defenses: {
    wires: [
      { a: P(600, 205), b: P(660, 235) }, // north gap
      { a: P(598, 565), b: P(655, 598) }, // south of the lower bridge
    ],
    trenches: [
      { a: P(408, 296), b: P(408, 392), side: 'US' }, // An Cuong east face
      { a: P(792, 300), b: P(792, 395), side: 'PAVN' }, // Hill Hamlet west face
      { a: P(610, 415), b: P(608, 470), side: 'US' }, // middle approaches
      { a: P(695, 420), b: P(697, 475), side: 'PAVN' },
    ],
    bunkers: [
      { pos: P(415, 345), side: 'US' },
      { pos: P(785, 348), side: 'PAVN' },
    ],
  },
};

// ---- geometry helpers for rasterising regions (used by map/grid.ts and draw) ----

export function pointInPoly(p: Vec, pts: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!, b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distToSegment2(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = a.x + t * dx, qy = a.y + t * dy;
  return (p.x - qx) ** 2 + (p.y - qy) ** 2;
}

export function pointInShape(p: Vec, s: Shape): boolean {
  switch (s.kind) {
    case 'rect': return p.x >= s.x && p.x < s.x + s.w && p.y >= s.y && p.y < s.y + s.h;
    case 'circle': return (p.x - s.c.x) ** 2 + (p.y - s.c.y) ** 2 <= s.r * s.r;
    case 'poly': return pointInPoly(p, s.pts);
    case 'stroke': {
      const hw2 = (s.width / 2) ** 2;
      for (let i = 0; i + 1 < s.pts.length; i++) if (distToSegment2(p, s.pts[i]!, s.pts[i + 1]!) <= hw2) return true;
      return false;
    }
  }
}

/** Terrain at a world point, by painting order. */
export function terrainAt(map: MapData, p: Vec): TerrainKey {
  let t: TerrainKey = 'open';
  for (const r of map.regions) if (pointInShape(p, r.shape)) t = r.terrain;
  return t;
}
