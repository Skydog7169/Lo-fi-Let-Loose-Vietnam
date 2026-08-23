// GameState types + factory. Entity data is plain objects in arrays; systems
// are functions over this state. Nothing here touches the DOM.
import { CONFIG } from './config';
import { makeRng, type Rng } from './rng';
import { type Vec, v, fromAngle } from './vec';
import { AN_CUONG, type MapData } from './map/an_cuong';
import { buildTerrainGrid, type TerrainGrid } from './map/grid';

export type Side = 'US' | 'PAVN';
export const SIDES: Side[] = ['US', 'PAVN'];
export const otherSide = (s: Side): Side => (s === 'US' ? 'PAVN' : 'US');

export type SquadKind = 'infantry' | 'at' | 'recon' | 'tank' | 'artillery';
export type MarkerKind = 'attack' | 'defend';
export type SquadState = 'MOVING' | 'ENGAGING' | 'SUPPRESSED' | 'FALLBACK' | 'IDLE';

export interface Marker { kind: MarkerKind; pos: Vec }

export interface Dot {
  id: number;
  squadId: number;
  side: Side;
  slot: number; // formation slot index within squad
  pos: Vec;
  facing: number; // radians
  hp: number;
  maxHp: number;
  alive: boolean;
  wp: number; // index into squad.path
  detour: Vec[] | null; // personal re-path when blocked (e.g. pushed off a bridge)
  detourCooldown: number; // ticks
  suppression: number; // 0..1
}

export interface Squad {
  id: number;
  side: Side;
  kind: SquadKind;
  label: string; // e.g. "A", "B"
  dotIds: number[];
  marker: Marker | null;
  path: Vec[]; // smoothed world waypoints toward marker
  pathGoal: Vec | null; // what the path was computed for
  state: SquadState;
}

// ---- Commands: the ONLY way a commander (human or AI) mutates the sim ----
export type Command =
  | { type: 'marker'; side: Side; squadId: number; kind: MarkerKind; pos: Vec };

export interface GameState {
  seed: number;
  rng: Rng;
  tick: number;
  time: number; // seconds of sim time
  map: MapData;
  grid: TerrainGrid;
  squads: Squad[];
  dots: Dot[];
  pendingCommands: Command[];
}

let nextSquadId = 0;
let nextDotId = 0;

export function createSquad(state: GameState, side: Side, kind: SquadKind, label: string, pos: Vec): Squad {
  const squad: Squad = {
    id: nextSquadId++,
    side,
    kind,
    label,
    dotIds: [],
    marker: { kind: 'defend', pos: v(pos.x, pos.y) }, // no marker = defend where you stand
    path: [],
    pathGoal: null,
    state: 'IDLE',
  };
  const n = CONFIG.SQUAD_SIZE[kind] ?? 0;
  const hp = kind === 'tank' ? CONFIG.TANK_HP : CONFIG.DOT_HP;
  for (let i = 0; i < n; i++) {
    const off = formationOffset(i, n);
    const dot: Dot = {
      id: nextDotId++,
      squadId: squad.id,
      side,
      slot: i,
      pos: v(pos.x + off.x, pos.y + off.y),
      facing: side === 'US' ? 0 : Math.PI,
      hp,
      maxHp: hp,
      alive: true,
      wp: 0,
      detour: null,
      detourCooldown: 0,
      suppression: 0,
    };
    state.dots.push(dot);
    squad.dotIds.push(dot.id);
  }
  state.squads.push(squad);
  return squad;
}

/** Fixed slot offset around the squad centre: leader (slot 0) in the middle, rest on a ring. */
export function formationOffset(slot: number, n: number): Vec {
  if (n <= 1 || slot === 0) return v(0, 0);
  const ringCount = n - 1;
  const t = ((slot - 1) / ringCount) * Math.PI * 2;
  return fromAngle(t, CONFIG.FORMATION_RADIUS);
}

export function createInitialState(seed: number): GameState {
  nextSquadId = 0;
  nextDotId = 0;
  const map = AN_CUONG;
  const state: GameState = {
    seed,
    rng: makeRng(seed),
    tick: 0,
    time: 0,
    map,
    grid: buildTerrainGrid(map),
    squads: [],
    dots: [],
    pendingCommands: [],
  };
  // Phase 1 placeholder forces, parked in each HQ.
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
  for (const side of SIDES) {
    const hq = map.hqs.find((h) => h.side === side)!.rect;
    for (let i = 0; i < CONFIG.PLACEHOLDER_SQUADS_PER_SIDE; i++) {
      const y = hq.y + ((i + 1) * hq.h) / (CONFIG.PLACEHOLDER_SQUADS_PER_SIDE + 1);
      const x = hq.x + hq.w / 2;
      createSquad(state, side, 'infantry', labels[i]!, v(x, y));
    }
  }
  return state;
}

export const squadById = (s: GameState, id: number): Squad | undefined => s.squads[id];
export const dotById = (s: GameState, id: number): Dot | undefined => s.dots[id];

export function squadCentroid(state: GameState, squad: Squad): Vec | null {
  let x = 0, y = 0, n = 0;
  for (const id of squad.dotIds) {
    const d = state.dots[id]!;
    if (!d.alive) continue;
    x += d.pos.x; y += d.pos.y; n++;
  }
  return n ? v(x / n, y / n) : null;
}
