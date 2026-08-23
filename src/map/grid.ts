// Coarse terrain grid rasterised from map regions. Shared by movement (A*),
// vision (concealment) and combat (cover). Built once at boot.
import { CONFIG, type TerrainKey } from '../config';
import type { Vec } from '../vec';
import { terrainAt, type MapData } from './an_cuong';

export interface TerrainGrid {
  cell: number;
  cols: number;
  rows: number;
  terrain: TerrainKey[]; // row-major
  /** infantry time-cost per cell (1/speed); Infinity = impassable */
  infCost: Float32Array;
  /** vehicle time-cost per cell */
  vehCost: Float32Array;
  cover: Uint8Array;
}

export function buildTerrainGrid(map: MapData): TerrainGrid {
  const cell = CONFIG.PATH_CELL;
  const cols = Math.ceil(map.width / cell);
  const rows = Math.ceil(map.height / cell);
  const terrain: TerrainKey[] = new Array(cols * rows);
  const infCost = new Float32Array(cols * rows);
  const vehCost = new Float32Array(cols * rows);
  const cover = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const t = terrainAt(map, { x: (c + 0.5) * cell, y: (r + 0.5) * cell });
      terrain[i] = t;
      const sp = CONFIG.TERRAIN_SPEED[t] ?? 1;
      infCost[i] = sp > 0 ? 1 / sp : Infinity;
      const vsp = t === 'road' ? CONFIG.ROAD_VEHICLE_SPEED : sp;
      vehCost[i] = vsp > 0 ? 1 / vsp : Infinity;
      cover[i] = CONFIG.TERRAIN_IS_COVER[t] ? 1 : 0;
    }
  }
  return { cell, cols, rows, terrain, infCost, vehCost, cover };
}

export const cellOf = (g: TerrainGrid, p: Vec): { c: number; r: number } => ({
  c: Math.max(0, Math.min(g.cols - 1, Math.floor(p.x / g.cell))),
  r: Math.max(0, Math.min(g.rows - 1, Math.floor(p.y / g.cell))),
});
export const cellIndex = (g: TerrainGrid, p: Vec): number => {
  const { c, r } = cellOf(g, p);
  return r * g.cols + c;
};
export const cellCenter = (g: TerrainGrid, c: number, r: number): Vec => ({ x: (c + 0.5) * g.cell, y: (r + 0.5) * g.cell });
export const terrainAtPoint = (g: TerrainGrid, p: Vec): TerrainKey => g.terrain[cellIndex(g, p)] ?? 'open';
export const isWalkable = (g: TerrainGrid, p: Vec, vehicle = false): boolean => {
  if (p.x < 0 || p.y < 0 || p.x >= g.cols * g.cell || p.y >= g.rows * g.cell) return false;
  const cost = (vehicle ? g.vehCost : g.infCost)[cellIndex(g, p)] ?? Infinity;
  return cost !== Infinity;
};
export const isCoverAt = (g: TerrainGrid, p: Vec): boolean => g.cover[cellIndex(g, p)] === 1;
/** Movement speed multiplier at a world point. */
export const speedAt = (g: TerrainGrid, p: Vec, vehicle = false): number => {
  const cost = (vehicle ? g.vehCost : g.infCost)[cellIndex(g, p)] ?? Infinity;
  return cost === Infinity ? 0 : 1 / cost;
};
