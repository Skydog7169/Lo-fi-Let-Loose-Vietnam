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
  digTimer: number; // seconds held still on a defend flag out of contact
  dugIn: Vec | null; // entrenched at this position (cover bonus in the open)
  shells: number; // artillery battery ammo
}

export type Effect =
  | { kind: 'tracer'; a: Vec; b: Vec; side: Side; ttl: number; max: number }
  | { kind: 'flash'; pos: Vec; side: Side; ttl: number; max: number }
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
  localRatio: number; // friends ÷ enemies near the squad (Infinity = none near), refreshed each scan
  shaken: boolean; // outnumbered and pinned: barely fires, easier to hit, can be overrun
  op: Vec | null; // this squad's outpost
  opTimer: number; // seconds stationary near marker & out of combat
  lastCentroid: Vec | null;
  fallback: Vec | null; // where a FALLBACK squad is retreating to
  defendCache: { marker: Vec; spot: Vec } | null; // resolved cover spot for the current defend marker
  scanPhase: number; // offset for target scans (0 = all squads together)
  heading: number; // direction of travel; formation slots rotate with it
}

export type GarrisonState = 'active' | 'packing' | 'destroyed';
export interface Garrison {
  id: number;
  side: Side;
  pos: Vec;
  hp: number;
  state: GarrisonState;
  disabled: boolean; // enemy within GARRISON_DISABLE_R
  threatTimer: number; // seconds of continuous enemy presence
  packTimer: number; // seconds left while packing
  packTarget: Vec | null; // where it re-appears after packing
}

export interface Resources { wb: number; mun: number; man: number; fuel: number }

export interface PointState { id: number; owner: Side; progress: number } // progress = attacker (US) capture 0..1

export type MatchPhase = 'draft' | 'setup' | 'play' | 'ended';
export type AbilityKind = 'recon' | 'strafe' | 'barrage' | 'supply' | 'garrison' | 'redeploy';
export const ABILITIES: AbilityKind[] = ['recon', 'strafe', 'barrage', 'supply', 'garrison', 'redeploy'];
export interface Recon { side: Side; pos: Vec; r: number; t: number }
export interface Supply { side: Side; pos: Vec; t: number }
export interface Strafe { side: Side; a: Vec; b: Vec; delay: number; t: number; progress: number } // t = remaining sweep
export interface Barrage { side: Side; pos: Vec; r: number; delay: number; t: number; shellsLeft: number; nextShell: number }

export interface Ghost { pos: Vec; side: Side; t: number; kind: 'dot' | 'tank' }

/** What one commander is allowed to know. Both the human UI and the scripted AI read only this. */
export interface VisibleState {
  side: Side;
  /** Own assets and public match facts — everything a commander legitimately knows. */
  own: { squads: Squad[]; garrisons: Garrison[]; res: Resources; cooldowns: Record<AbilityKind, number>; supplies: Supply[] };
  pub: { points: PointState[]; active: number; sectorX: number; timer: number; phase: MatchPhase };
  enemyDots: Dot[]; // visible enemy dots (live references; do not mutate)
  enemyGarrisons: Garrison[];
  enemyOps: { squadId: number; pos: Vec }[];
  ghosts: Ghost[];
  dotVisible: Uint8Array; // indexed by dot id
  garrisonVisible: Uint8Array; // indexed by garrison id
  opVisible: Uint8Array; // indexed by squad id
}

// ---- Commands: the ONLY way a commander (human or AI) mutates the sim ----
export type Command =
  | { type: 'marker'; side: Side; squadId: number; kind: MarkerKind; pos: Vec }
  | { type: 'placeGarrison'; side: Side; pos: Vec }
  | { type: 'redeployGarrison'; side: Side; garrisonId: number; pos: Vec }
  | { type: 'setupDone'; side: Side }
  | { type: 'draft'; side: Side; comp: Record<SquadKind, number> }
  | { type: 'ability'; side: Side; ability: AbilityKind; pos: Vec; pos2?: Vec; garrisonId?: number };

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
  shells: { to: Vec; t: number; side: Side; kind: 'arty' | 'he' }[]; // rounds in flight
  scenario: string;
  // ---- match ----
  phase: MatchPhase;
  setupTimer: number;
  setupDone: Record<Side, boolean>;
  timer: number; // seconds remaining
  result: { winner: Side; reason: string } | null;
  points: PointState[];
  active: number; // index into points of the contested point (or points.length when all taken)
  garrisons: Garrison[];
  res: Record<Side, Resources>;
  waveTimer: Record<Side, number>;
  vis: Record<Side, VisibleState>;
  stats: Record<Side, { casualties: number; garrisonsLost: number; pointHeldTime: number }>;
  rules: { income: boolean; respawn: boolean }; // scenario overrides for pure combat tests
  drafted: Record<Side, boolean>;
  cooldowns: Record<Side, Record<AbilityKind, number>>; // seconds remaining
  recons: Recon[];
  supplies: Supply[];
  strafes: Strafe[];
  barrages: Barrage[];
  tankRespawns: Record<number, number>; // by squad id
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
    localRatio: Infinity,
    shaken: false,
    op: null,
    opTimer: 0,
    lastCentroid: null,
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
      digTimer: 0,
      dugIn: null,
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
    phase: 'draft',
    setupTimer: CONFIG.SETUP_SECONDS,
    setupDone: { US: false, PAVN: false },
    timer: CONFIG.MATCH_SECONDS,
    result: null,
    points: map.points.map((p) => ({ id: p.id, owner: 'PAVN' as Side, progress: 0 })),
    active: 0,
    garrisons: [],
    res: {
      US: { wb: CONFIG.START_WB, mun: CONFIG.START_MUN, man: CONFIG.START_MAN, fuel: CONFIG.START_FUEL },
      PAVN: { wb: CONFIG.START_WB, mun: CONFIG.START_MUN, man: CONFIG.START_MAN, fuel: CONFIG.START_FUEL },
    },
    waveTimer: { US: CONFIG.WAVE_SECONDS, PAVN: CONFIG.WAVE_SECONDS },
    vis: { US: emptyVisible('US'), PAVN: emptyVisible('PAVN') },
    stats: { US: { casualties: 0, garrisonsLost: 0, pointHeldTime: 0 }, PAVN: { casualties: 0, garrisonsLost: 0, pointHeldTime: 0 } },
    rules: { income: true, respawn: true },
    drafted: { US: false, PAVN: false },
    cooldowns: { US: zeroCooldowns(), PAVN: zeroCooldowns() },
    recons: [],
    supplies: [],
    strafes: [],
    barrages: [],
    tankRespawns: {},
  };
  return state;
}

export const zeroCooldowns = (): Record<AbilityKind, number> => ({ recon: 0, strafe: 0, barrage: 0, supply: 0, garrison: 0, redeploy: 0 });

export function emptyVisible(side: Side): VisibleState {
  return { side, own: { squads: [], garrisons: [], res: { wb: 0, mun: 0, man: 0, fuel: 0 }, cooldowns: zeroCooldowns(), supplies: [] }, pub: { points: [], active: 0, sectorX: 0, timer: 0, phase: 'draft' }, enemyDots: [], enemyGarrisons: [], enemyOps: [], ghosts: [], dotVisible: new Uint8Array(0), garrisonVisible: new Uint8Array(0), opVisible: new Uint8Array(0) };
}

export function createGarrison(state: GameState, side: Side, pos: Vec): Garrison {
  const g: Garrison = { id: state.garrisons.length, side, pos: v(pos.x, pos.y), hp: CONFIG.GARRISON_HP, state: 'active', disabled: false, threatTimer: 0, packTimer: 0, packTarget: null };
  state.garrisons.push(g);
  return g;
}

/** x of the sector line for the current active point: midway between the last point taken and the active one. */
export function sectorLineX(state: GameState): number {
  const pts = state.map.points;
  if (state.active >= pts.length) return state.map.width; // everything is US
  const cur = pts[state.active]!.pos.x;
  const prev = state.active > 0 ? pts[state.active - 1]!.pos.x : state.map.hqs.find((h) => h.side === 'US')!.rect.w;
  return (prev + cur) / 2;
}

export function inOwnTerritory(state: GameState, side: Side, p: Vec): boolean {
  const x = sectorLineX(state);
  return side === 'US' ? p.x < x : p.x >= x;
}

export function hqCenter(state: GameState, side: Side): Vec {
  const r = state.map.hqs.find((h) => h.side === side)!.rect;
  return v(r.x + r.w / 2, r.y + r.h / 2);
}

export function pointsHeld(state: GameState, side: Side): number {
  let n = 0;
  for (const p of state.points) if (p.owner === side) n++;
  return n;
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
