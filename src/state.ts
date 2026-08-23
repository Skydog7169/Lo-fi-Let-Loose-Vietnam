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
  targetId: number; // -1 = none; a dot with a target halts, faces and fires
  fireCooldown: number; // seconds
  coverSeek: Vec | null; // short step into adjacent cover while engaging
  moving: boolean; // moved this tick → cannot fire (halt, face, fire)
  shells: number; // artillery battery ammo
}

export type Effect =
  | { kind: 'tracer'; a: Vec; b: Vec; side: Side; ttl: number; max: number }
  | { kind: 'flash'; pos: Vec; ttl: number; max: number }
  | { kind: 'shell'; from: Vec; to: Vec; ttl: number; max: number }
  | { kind: 'impact'; pos: Vec; r: number; ttl: number; max: number }
  | { kind: 'death'; pos: Vec; side: Side; ttl: number; max: number };

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
  fallback: Vec | null; // where a FALLBACK squad is retreating to
  defendCache: { marker: Vec; spot: Vec } | null; // resolved cover spot for the current defend marker
  scanPhase: number; // offset for target scans (0 = all squads together)
  heading: number; // direction of travel; formation slots rotate with it
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
  effects: Effect[];
  shells: { to: Vec; t: number; side: Side }[]; // artillery rounds in flight
  scenario: string;
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
    fallback: null,
    defendCache: null,
    scanPhase: 0, // all squads scan on the same ticks — staggering gave one side first acquisition
    heading: side === 'US' ? 0 : Math.PI,
  };
  const n = CONFIG.SQUAD_SIZE[kind] ?? 0;
  const hp = kind === 'tank' ? CONFIG.TANK_HP : kind === 'artillery' ? CONFIG.ARTY_HP : CONFIG.DOT_HP;
  for (let i = 0; i < n; i++) {
    const off = formationOffset(i, n, squad.heading);
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
      targetId: -1,
      fireCooldown: 0,
      coverSeek: null,
      moving: false,
      shells: kind === 'artillery' ? CONFIG.ARTY_SHELLS : 0,
    };
    state.dots.push(dot);
    squad.dotIds.push(dot.id);
  }
  state.squads.push(squad);
  return squad;
}

/** Slot offset around the squad centre: leader (slot 0) in the middle, rest on a ring that
 *  rotates with the squad's heading so the formation is symmetric for both directions of travel. */
export function formationOffset(slot: number, n: number, heading = 0): Vec {
  if (n <= 1 || slot === 0) return v(0, 0);
  const ringCount = n - 1;
  const t = heading + ((slot - 1) / ringCount) * Math.PI * 2;
  return fromAngle(t, CONFIG.FORMATION_RADIUS);
}

export function createEmptyState(seed: number, scenario: string): GameState {
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
    effects: [],
    shells: [],
    scenario,
  };
  return state;
}

export const isVehicle = (k: SquadKind): boolean => k === 'tank';

export function aliveDots(state: GameState, squad: Squad): Dot[] {
  const out: Dot[] = [];
  for (const id of squad.dotIds) { const d = state.dots[id]!; if (d.alive) out.push(d); }
  return out;
}

export function pushEffect(state: GameState, e: Effect): void {
  if (state.effects.length >= CONFIG.MAX_EFFECTS) state.effects.shift();
  state.effects.push(e);
}

export function terrainIsCover(state: GameState, p: Vec): boolean {
  const g = state.grid;
  const c = Math.max(0, Math.min(g.cols - 1, Math.floor(p.x / g.cell)));
  const r = Math.max(0, Math.min(g.rows - 1, Math.floor(p.y / g.cell)));
  return g.cover[r * g.cols + c] === 1;
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

/** Squads in processing order. Alternates direction every tick so neither side gets a
 *  systematic first-mover advantage in movement/combat resolution. */
export function squadsInOrder(state: GameState): Squad[] {
  const n = state.squads.length;
  const out: Squad[] = new Array(n);
  if (state.tick % 2 === 0) for (let i = 0; i < n; i++) out[i] = state.squads[i]!;
  else for (let i = 0; i < n; i++) out[i] = state.squads[n - 1 - i]!;
  return out;
}
