// Per-squad state machine (MOVING → ENGAGING → SUPPRESSED → FALLBACK) and
// per-dot target acquisition. Identical for both sides (bible §10.1).
import { CONFIG } from '../config';
import { cellCenter, cellOf, isCoverAt, isWalkable } from '../map/grid';
import { aliveDots, isVehicle, type Dot, type GameState, type Side, type Squad } from '../state';
import { dist2, norm, sub, v, type Vec } from '../vec';
import { rand } from '../rng';
import { pushEffect, squadCentroid, squadsInOrder } from '../state';

/** Can this shooter hurt that target at all? Small arms never damage armour (bible §9.4). */
export function canDamage(state: GameState, shooter: Dot, target: Dot): boolean {
  const ss = state.squads[shooter.squadId]!;
  const ts = state.squads[target.squadId]!;
  if (ss.kind === 'artillery') return false; // batteries only shell zones
  if (isVehicle(ts.kind)) return ss.kind === 'tank' || (ss.kind === 'at' && isAtGunner(shooter));
  return true;
}

export const isAtGunner = (d: Dot): boolean => d.slot >= 1 && d.slot <= CONFIG.AT_GUNNERS_PER_SQUAD;

/** Weapon range of shooter against a given target. */
export function rangeFor(state: GameState, shooter: Dot, target: Dot): number {
  const ss = state.squads[shooter.squadId]!;
  const ts = state.squads[target.squadId]!;
  if (ss.kind === 'tank') return CONFIG.TANK_RANGE;
  if (ss.kind === 'at' && isVehicle(ts.kind)) return CONFIG.AT_RANGE_VS_ARMOR;
  return CONFIG.INF_RANGE;
}

/** Can the shooter see the target well enough to shoot? Side-level fog of war (vision.ts) plus the
 *  tank concealment penalty. */
export function canSpot(state: GameState, shooter: Dot, target: Dot, d2: number): boolean {
  const vis = state.vis[shooter.side].dotVisible;
  if (vis.length > target.id && vis[target.id] !== 1 && !CONFIG.DEBUG_REVEAL_ALL) return false;
  const ss = state.squads[shooter.squadId]!;
  if (ss.kind === 'tank' && isCoverAt(state.grid, target.pos)) return d2 <= CONFIG.TANK_COVER_SPOT_RANGE ** 2;
  return true;
}

function targetValid(state: GameState, shooter: Dot): boolean {
  if (shooter.targetId < 0) return false;
  const t = state.dots[shooter.targetId];
  if (!t || !t.alive) return false;
  const d2 = dist2(shooter.pos, t.pos);
  const r = rangeFor(state, shooter, t);
  return d2 <= r * r && canSpot(state, shooter, t, d2);
}

const candidates: Dot[] = [];
const candD2: number[] = [];
function acquire(state: GameState, shooter: Dot, enemies: Dot[]): void {
  if (targetValid(state, shooter)) return; // stay on target — no flip-flopping
  candidates.length = 0; candD2.length = 0;
  let bestD2 = Infinity;
  for (const e of enemies) {
    if (!canDamage(state, shooter, e)) continue;
    const d2 = dist2(shooter.pos, e.pos);
    const r = rangeFor(state, shooter, e);
    if (d2 > r * r) continue;
    if (!canSpot(state, shooter, e, d2)) continue;
    candidates.push(e); candD2.push(d2);
    if (d2 < bestD2) bestD2 = d2;
  }
  if (!candidates.length) { shooter.targetId = -1; return; }
  // spread fire: any candidate not much farther than the nearest is fair game
  const limit = bestD2 * CONFIG.TARGET_PICK_SLACK ** 2;
  let n = 0;
  for (let i = 0; i < candidates.length; i++) if (candD2[i]! <= limit) candidates[n++] = candidates[i]!;
  shooter.targetId = candidates[Math.min(n - 1, Math.floor(rand(state.rng) * n))]!.id;
}

/** Nearest walkable cover cell centre within COVER_SEEK_R of p, or null. */
function nearbyCover(state: GameState, p: Vec, vehicle: boolean): Vec | null {
  const g = state.grid;
  const R = CONFIG.COVER_SEEK_R;
  const { c, r } = cellOf(g, p);
  const span = Math.ceil(R / g.cell);
  let best: Vec | null = null, bestD2 = R * R;
  for (let dr = -span; dr <= span; dr++) for (let dc = -span; dc <= span; dc++) {
    const cc = c + dc, rr = r + dr;
    if (cc < 0 || rr < 0 || cc >= g.cols || rr >= g.rows) continue;
    const i = rr * g.cols + cc;
    if (!g.cover[i]) continue;
    const q = cellCenter(g, cc, rr);
    const d2 = dist2(p, q);
    if (d2 < bestD2 && isWalkable(g, q, vehicle)) { best = q; bestD2 = d2; }
  }
  return best;
}


/** Unit vector toward the likely threat: the nearest enemy dot if any, else enemy territory (their HQ). */
export function threatDirection(state: GameState, squad: Squad, from: Vec): Vec {
  let best: Vec | null = null, bestD2 = Infinity;
  for (const d of state.dots) {
    if (!d.alive || d.side === squad.side) continue;
    const d2 = (d.pos.x - from.x) ** 2 + (d.pos.y - from.y) ** 2;
    if (d2 < bestD2) { bestD2 = d2; best = d.pos; }
  }
  if (best) return norm(sub(best, from));
  const hq = state.map.hqs.find((h) => h.side !== squad.side)!.rect;
  return norm(sub(v(hq.x + hq.w / 2, hq.y + hq.h / 2), from));
}

function overrun(state: GameState, d: Dot): void {
  d.alive = false; d.hp = 0; d.targetId = -1; d.coverSeek = null;
  state.stats[d.side].casualties++;
  pushEffect(state, { kind: 'death', pos: v(d.pos.x, d.pos.y), side: d.side, ttl: CONFIG.DEATH_TTL, max: CONFIG.DEATH_TTL });
}

export function updateSquadAi(state: GameState): void {
  const aliveBySide: Record<Side, Dot[]> = { US: [], PAVN: [] };
  for (const d of state.dots) if (d.alive) aliveBySide[d.side].push(d);

  for (const squad of squadsInOrder(state)) {
    const alive = aliveDots(state, squad);
    if (!alive.length) { squad.state = 'IDLE'; continue; }
    const enemies = aliveBySide[squad.side === 'US' ? 'PAVN' : 'US'];
    const scanNow = (state.tick + squad.scanPhase) % CONFIG.TARGET_SCAN_INTERVAL_TICKS === 0;

    let suppSum = 0, engaging = false;
    for (const d of alive) {
      if (squad.kind === 'artillery' || squad.fallback) { d.targetId = -1; d.coverSeek = null; } // batteries only shell; broken squads run, they don't shoot
      else if (scanNow) acquire(state, d, enemies);
      else if (!targetValid(state, d)) d.targetId = -1;
      if (d.targetId >= 0) engaging = true;
      suppSum += d.suppression;
    }
    const avgSupp = suppSum / alive.length;
    const pinned = avgSupp > CONFIG.SUPPRESS_PIN_THRESHOLD;

    // ---- local numbers: who has the weight of fire here? ----
    if (scanNow) {
      const c = squadCentroid(state, squad)!;
      const R2 = CONFIG.LOCAL_RATIO_R ** 2;
      let friends = 0, foes = 0;
      for (const d of state.dots) {
        if (!d.alive || dist2(d.pos, c) > R2) continue;
        if (state.squads[d.squadId]!.kind === 'artillery') continue;
        if (d.side === squad.side) friends++; else foes++;
      }
      squad.localRatio = foes === 0 ? Infinity : friends / foes;
    }
    squad.shaken = pinned && squad.localRatio <= 1 / CONFIG.SUPERIORITY_RATIO;
    // overrun: a shaken dot with an enemy at arm's length is routed
    if (squad.shaken) {
      const o2 = CONFIG.OVERRUN_DIST ** 2;
      for (const d of alive) {
        for (const e of enemies) {
          if (dist2(d.pos, e.pos) <= o2) { overrun(state, d); break; }
        }
      }
      if (!alive.some((d) => d.alive)) { squad.state = 'IDLE'; squad.fallback = null; continue; } // wiped out by the overrun
    }

    // ---- FALLBACK ----
    if (CONFIG.FALLBACK_ENABLED && squad.kind !== 'artillery') {
      const total = squad.dotIds.length;
      const holds = !CONFIG.FALLBACK_DEFENDERS_IN_COVER && squad.marker?.kind === 'defend' && alive.some((d) => isCoverAt(state.grid, d.pos));
      if (!squad.fallback && pinned && !holds && alive.length <= Math.floor(total * CONFIG.FALLBACK_STRENGTH_FRACTION)) {
        squad.fallback = fallbackPoint(state, squad);
        squad.pathGoal = null; // force repath
      } else if (squad.fallback && avgSupp < CONFIG.FALLBACK_RECOVER_SUPPRESSION) {
        squad.fallback = null;
        squad.pathGoal = null;
      }
    }

    if (squad.fallback) squad.state = 'FALLBACK';
    else if (pinned) squad.state = 'SUPPRESSED';
    else if (engaging) squad.state = 'ENGAGING';
    else if (squad.state === 'ENGAGING' || squad.state === 'SUPPRESSED') squad.state = 'MOVING';

    // ---- cover seeking while engaging (bible §9.2) ----
    const vehicle = isVehicle(squad.kind);
    for (const d of alive) {
      if (d.targetId >= 0 && !d.coverSeek && !vehicle && !isCoverAt(state.grid, d.pos)) {
        d.coverSeek = nearbyCover(state, d.pos, vehicle);
      }
      // idle defenders face the likely threat
      if (d.targetId < 0 && d.wp >= squad.path.length && !d.coverSeek) { const td = threatDirection(state, squad, d.pos); d.facing = Math.atan2(td.y, td.x); }
    }
  }
}

/** Where a broken squad runs to: straight away from the nearby enemy mass, snapped to walkable ground.
 *  (Phase 3 may prefer the squad's active spawn.) */
function fallbackPoint(state: GameState, squad: Squad): Vec {
  const c = squadCentroid(state, squad)!;
  let ex = 0, ey = 0, n = 0;
  const R2 = (CONFIG.TANK_RANGE * 2) ** 2;
  for (const d of state.dots) {
    if (!d.alive || d.side === squad.side) continue;
    if (dist2(d.pos, c) > R2) continue;
    ex += d.pos.x; ey += d.pos.y; n++;
  }
  let dir = n ? norm(sub(c, v(ex / n, ey / n))) : v(squad.side === 'US' ? -1 : 1, 0);
  if (dir.x === 0 && dir.y === 0) dir = v(squad.side === 'US' ? -1 : 1, 0);
  const g = state.grid;
  const W = g.cols * g.cell, H = g.rows * g.cell;
  for (let dist = CONFIG.FALLBACK_DISTANCE; dist >= 20; dist -= 20) {
    const p = v(Math.max(5, Math.min(W - 5, c.x + dir.x * dist)), Math.max(5, Math.min(H - 5, c.y + dir.y * dist)));
    if (isWalkable(g, p, isVehicle(squad.kind))) return p;
  }
  return c;
}
