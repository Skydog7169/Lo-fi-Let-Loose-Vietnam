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

export interface MapData {
  name: string;
  width: number;
  height: number;
  regions: Region[];
  points: CapturePoint[];
  hqs: HqZone[];
  /** x-coordinate midpoints between consecutive points; used for sector lines (Phase 3). */
}

const P = (x: number, y: number): Vec => ({ x, y });

// River centreline, north → south, then offset into a band polygon.
const RIVER_CENTER: Vec[] = [
  P(562, -10), P(548, 110), P(572, 230), P(556, 350), P(582, 470),
  P(560, 590), P(588, 700), P(570, 810),
];
const RIVER_HALF_W = 17;
function riverPoly(center: Vec[], halfW: number): Vec[] {
  const left = center.map((p) => P(p.x - halfW, p.y));
  const right = center.map((p) => P(p.x + halfW, p.y)).reverse();
  return [...left, ...right];
}

const ROAD_MAIN: Vec[] = [
  P(0, 400), P(120, 400), P(230, 420), P(380, 360), P(440, 330), P(520, 300),
  P(610, 300), P(650, 450), P(760, 420), P(840, 340), P(960, 380), P(1030, 430),
  P(1120, 420), P(1200, 420),
];
const ROAD_SOUTH: Vec[] = [P(230, 420), P(380, 520), P(530, 521), P(620, 521), P(650, 450)];
const ROAD_NORTH_SPUR: Vec[] = [P(840, 340), P(880, 220), P(900, 90)];

export const AN_CUONG: MapData = {
  name: 'An Cuong',
  width: 1200,
  height: 800,
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

    // --- River (impassable) ---
    { terrain: 'river', shape: { kind: 'poly', pts: riverPoly(RIVER_CENTER, RIVER_HALF_W) } },

    // --- Roads (pale lines) ---
    { terrain: 'road', shape: { kind: 'stroke', pts: ROAD_MAIN, width: 8 } },
    { terrain: 'road', shape: { kind: 'stroke', pts: ROAD_SOUTH, width: 8 } },
    { terrain: 'road', shape: { kind: 'stroke', pts: ROAD_NORTH_SPUR, width: 6 } },

    // --- Crossings: 2 bridges on the roads + 1 ford hidden in the north woods ---
    { terrain: 'bridge', shape: { kind: 'rect', x: 536, y: 289, w: 58, h: 22 } },
    { terrain: 'bridge', shape: { kind: 'rect', x: 546, y: 510, w: 58, h: 22 } },
    { terrain: 'ford', shape: { kind: 'rect', x: 520, y: 80, w: 64, h: 34 } },

    // --- Villages: gray block clusters on points 2 and 4 ---
    { terrain: 'village', shape: { kind: 'rect', x: 400, y: 292, w: 30, h: 22 } },
    { terrain: 'village', shape: { kind: 'rect', x: 448, y: 286, w: 36, h: 26 } },
    { terrain: 'village', shape: { kind: 'rect', x: 412, y: 344, w: 30, h: 22 } },
    { terrain: 'village', shape: { kind: 'rect', x: 458, y: 340, w: 32, h: 26 } },
    { terrain: 'village', shape: { kind: 'rect', x: 392, y: 372, w: 42, h: 20 } },
    { terrain: 'village', shape: { kind: 'rect', x: 478, y: 310, w: 24, h: 20 } },

    { terrain: 'village', shape: { kind: 'rect', x: 800, y: 300, w: 32, h: 24 } },
    { terrain: 'village', shape: { kind: 'rect', x: 850, y: 296, w: 34, h: 26 } },
    { terrain: 'village', shape: { kind: 'rect', x: 806, y: 356, w: 28, h: 22 } },
    { terrain: 'village', shape: { kind: 'rect', x: 854, y: 354, w: 36, h: 24 } },
    { terrain: 'village', shape: { kind: 'rect', x: 796, y: 384, w: 40, h: 18 } },
    { terrain: 'village', shape: { kind: 'rect', x: 876, y: 326, w: 24, h: 20 } },

    // --- HQ zones (open, just flagged for spawning/fallback) ---
    { terrain: 'hq', shape: { kind: 'rect', x: 0, y: 320, w: 90, h: 160 } },
    { terrain: 'hq', shape: { kind: 'rect', x: 1110, y: 340, w: 90, h: 160 } },
  ],
  points: [
    { id: 1, name: 'PADDY WEST', pos: P(230, 420) },
    { id: 2, name: 'AN CUONG', pos: P(440, 330) },
    { id: 3, name: 'RIVER BEND', pos: P(650, 450) },
    { id: 4, name: 'HILL HAMLET', pos: P(840, 340) },
    { id: 5, name: 'PADDY EAST', pos: P(1030, 430) },
  ],
  hqs: [
    { side: 'US', rect: { x: 0, y: 320, w: 90, h: 160 } },
    { side: 'PAVN', rect: { x: 1110, y: 340, w: 90, h: 160 } },
  ],
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
