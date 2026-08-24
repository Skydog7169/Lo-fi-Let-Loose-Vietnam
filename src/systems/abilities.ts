// Orders panel effects (bible §8): recon, strafing run, artillery barrage,
// supply drop, new garrison, redeploy. Purchases are validated here; the
// per-tick effects (sweeps, shells, lifetimes, cooldowns) live in updateAbilities.
import { CONFIG } from '../config';
import { isCoverAt, isWalkable } from '../map/grid';
import { rand } from '../rng';
import { createGarrison, inOwnTerritory, isVehicle, pushEffect, type AbilityKind, type GameState, type Side } from '../state';
import { dist, v, type Vec } from '../vec';
import { garrisonPlacementError } from '../commander';
import { shellImpact } from './combat';

export type AbilityError = 'phase' | 'cooldown' | 'cost' | 'target' | 'territory' | 'supply' | 'point' | 'terrain';

export function abilityError(state: GameState, side: Side, ability: AbilityKind, pos: Vec, pos2?: Vec, garrisonId?: number): AbilityError | null {
  if (state.phase !== 'play') return 'phase';
  const def = CONFIG.ABILITY[ability]!;
  if (state.cooldowns[side][ability] > 0) return 'cooldown';
  if (state.res[side][def.pool] < def.cost) return 'cost';
  switch (ability) {
    case 'recon':
    case 'barrage':
      return null; // anywhere, even blind
    case 'strafe':
      if (!pos2) return 'target';
      return null;
    case 'supply':
      if (!isWalkable(state.grid, pos)) return 'terrain';
      return null;
    case 'garrison': {
      const e = garrisonPlacementError(state, side, pos);
      if (e === 'wb') return 'cost';
      if (e === 'territory' || e === 'point' || e === 'terrain' || e === 'supply') return e;
      return e ? 'target' : null;
    }
    case 'redeploy': {
      const g = garrisonId !== undefined ? state.garrisons[garrisonId] : undefined;
      if (!g || g.side !== side || g.state !== 'active') return 'target';
      const e = garrisonPlacementError(state, side, pos, { forRedeploy: true });
      if (e === 'territory' || e === 'point' || e === 'terrain') return e;
      return null;
    }
    case 'wire':
    case 'trench':
      if (!pos2) return 'target';
      if (!inOwnTerritory(state, side, pos) || !inOwnTerritory(state, side, pos2)) return 'territory';
      if (!isWalkable(state.grid, pos) || !isWalkable(state.grid, pos2)) return 'terrain';
      return null;
    case 'bunker':
      if (!inOwnTerritory(state, side, pos)) return 'territory';
      if (!isWalkable(state.grid, pos)) return 'terrain';
      return null;
  }
}

/** Clamp a defense line to its configured max length. */
function clampLine(a: Vec, b: Vec, maxLen: number): Vec {
  const L = dist(a, b);
  if (L <= maxLen) return b;
  return v(a.x + ((b.x - a.x) * maxLen) / L, a.y + ((b.y - a.y) * maxLen) / L);
}

/** Apply a validated purchase. */
export function buyAbility(state: GameState, side: Side, ability: AbilityKind, pos: Vec, pos2?: Vec, garrisonId?: number): boolean {
  if (abilityError(state, side, ability, pos, pos2, garrisonId)) return false;
  const def = CONFIG.ABILITY[ability]!;
  state.res[side][def.pool] -= def.cost;
  state.cooldowns[side][ability] = def.cooldown;
  switch (ability) {
    case 'recon':
      state.recons.push({ side, pos: v(pos.x, pos.y), r: CONFIG.RECON_RADIUS, t: CONFIG.RECON_DURATION });
      break;
    case 'strafe': {
      // clamp the run to STRAFE_MAX_LENGTH, centred on the requested segment
      const a = v(pos.x, pos.y);
      let b = v(pos2!.x, pos2!.y);
      const L = dist(a, b);
      if (L > CONFIG.STRAFE_MAX_LENGTH) b = v(a.x + ((b.x - a.x) * CONFIG.STRAFE_MAX_LENGTH) / L, a.y + ((b.y - a.y) * CONFIG.STRAFE_MAX_LENGTH) / L);
      state.strafes.push({ side, a, b, delay: CONFIG.STRAFE_DELAY, t: CONFIG.STRAFE_DURATION, progress: 0 });
      break;
    }
    case 'barrage':
      state.barrages.push({ side, pos: v(pos.x, pos.y), r: CONFIG.BARRAGE_RADIUS, delay: CONFIG.BARRAGE_DELAY, t: CONFIG.BARRAGE_DURATION, shellsLeft: CONFIG.BARRAGE_SHELLS, nextShell: 0 });
      break;
    case 'supply':
      state.supplies.push({ side, pos: v(pos.x, pos.y), t: CONFIG.SUPPLY_LIFETIME });
      break;
    case 'garrison':
      createGarrison(state, side, pos);
      // the drop is consumed
      for (let i = state.supplies.length - 1; i >= 0; i--) { const s = state.supplies[i]!; if (s.side === side && dist(s.pos, pos) <= CONFIG.SUPPLY_RADIUS) { state.supplies.splice(i, 1); break; } }
      break;
    case 'wire':
      state.wires.push({ side, a: v(pos.x, pos.y), b: clampLine(pos, pos2!, CONFIG.WIRE_MAX_LENGTH), hp: CONFIG.WIRE_HP });
      break;
    case 'trench':
      state.trenches.push({ side, a: v(pos.x, pos.y), b: clampLine(pos, pos2!, CONFIG.TRENCH_MAX_LENGTH) });
      break;
    case 'bunker':
      state.bunkers.push({ side, pos: v(pos.x, pos.y), hp: CONFIG.BUNKER_HP });
      break;
    case 'redeploy': {
      const g = state.garrisons[garrisonId!]!;
      g.state = 'packing';
      g.packTimer = CONFIG.REDEPLOY_PACK_SECONDS;
      g.packTarget = v(pos.x, pos.y);
      break;
    }
  }
  return true;
}

function strafeHit(state: GameState, s: { side: Side; a: Vec; b: Vec }, from: number, to: number): void {
  // damage everything within STRAFE_WIDTH of the segment portion [from,to] (fractions along a→b)
  const ax = s.a.x + (s.b.x - s.a.x) * from, ay = s.a.y + (s.b.y - s.a.y) * from;
  const bx = s.a.x + (s.b.x - s.a.x) * to, by = s.a.y + (s.b.y - s.a.y) * to;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const W2 = CONFIG.STRAFE_WIDTH ** 2;
  for (const d of state.dots) {
    if (!d.alive) continue;
    let t = l2 > 0 ? ((d.pos.x - ax) * dx + (d.pos.y - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t, qy = ay + dy * t;
    if ((d.pos.x - qx) ** 2 + (d.pos.y - qy) ** 2 > W2) continue;
    const vehicle = isVehicle(state.squads[d.squadId]!.kind);
    let dmg = vehicle ? CONFIG.STRAFE_TANK_DAMAGE : CONFIG.STRAFE_DAMAGE;
    if (!vehicle && isCoverAt(state.grid, d.pos)) dmg *= 0.5;
    d.hp -= dmg;
    if (!vehicle) d.suppression = Math.min(1, d.suppression + CONFIG.STRAFE_SUPPRESS);
    if (d.hp <= 0) { d.alive = false; d.hp = 0; d.targetId = -1; d.coverSeek = null; state.stats[d.side].casualties++; pushEffect(state, { kind: 'death', pos: v(d.pos.x, d.pos.y), side: d.side, ttl: CONFIG.DEATH_TTL, max: CONFIG.DEATH_TTL }); }
  }
  // impacts along the swept segment
  const n = Math.max(1, Math.round(Math.sqrt(l2) / 12));
  for (let i = 0; i < n; i++) {
    const t = (i + rand(state.rng)) / n;
    const jx = (rand(state.rng) - 0.5) * CONFIG.STRAFE_WIDTH, jy = (rand(state.rng) - 0.5) * CONFIG.STRAFE_WIDTH;
    pushEffect(state, { kind: 'impact', pos: v(ax + dx * t + jx, ay + dy * t + jy), r: 6, ttl: CONFIG.IMPACT_TTL * 0.6, max: CONFIG.IMPACT_TTL * 0.6 });
  }
}

export function updateAbilities(state: GameState, dt: number): void {
  for (const side of ['US', 'PAVN'] as Side[]) {
    const cd = state.cooldowns[side];
    for (const k of Object.keys(cd) as AbilityKind[]) cd[k] = Math.max(0, cd[k] - dt);
  }
  for (let i = state.recons.length - 1; i >= 0; i--) { const r = state.recons[i]!; r.t -= dt; if (r.t <= 0) state.recons.splice(i, 1); }
  for (let i = state.supplies.length - 1; i >= 0; i--) { const s = state.supplies[i]!; s.t -= dt; if (s.t <= 0) state.supplies.splice(i, 1); }
  for (let i = state.strafes.length - 1; i >= 0; i--) {
    const s = state.strafes[i]!;
    if (s.delay > 0) { s.delay -= dt; continue; }
    const from = s.progress;
    s.progress = Math.min(1, s.progress + dt / CONFIG.STRAFE_DURATION);
    strafeHit(state, s, from, s.progress);
    s.t -= dt;
    if (s.progress >= 1) state.strafes.splice(i, 1);
  }
  for (let i = state.barrages.length - 1; i >= 0; i--) {
    const b = state.barrages[i]!;
    if (b.delay > 0) { b.delay -= dt; continue; }
    b.t -= dt;
    b.nextShell -= dt;
    if (b.shellsLeft > 0 && b.nextShell <= 0) {
      b.shellsLeft--;
      b.nextShell = CONFIG.BARRAGE_DURATION / CONFIG.BARRAGE_SHELLS;
      const ang = rand(state.rng) * Math.PI * 2, rad = Math.sqrt(rand(state.rng)) * b.r;
      const to = v(b.pos.x + Math.cos(ang) * rad, b.pos.y + Math.sin(ang) * rad);
      state.shells.push({ to, t: CONFIG.ARTY_FLIGHT_TIME, side: b.side, kind: 'arty' });
      const from = v(b.side === 'US' ? -20 : state.map.width + 20, to.y - 120);
      pushEffect(state, { kind: 'shell', from, to, ttl: CONFIG.ARTY_FLIGHT_TIME, max: CONFIG.ARTY_FLIGHT_TIME });
    }
    if (b.shellsLeft <= 0) state.barrages.splice(i, 1);
  }
}

export { shellImpact };

/** Is there a friendly supply drop within SUPPLY_RADIUS of p? */
export function supplied(state: GameState, side: Side, p: Vec): boolean {
  for (const s of state.supplies) if (s.side === side && dist(s.pos, p) <= CONFIG.SUPPLY_RADIUS) return true;
  return false;
}

/** Is p inside any active recon flight of `side`? */
export function inRecon(state: GameState, side: Side, p: Vec): boolean {
  for (const r of state.recons) if (r.side === side && dist(r.pos, p) <= r.r) return true;
  return false;
}

export const abilityInTerritory = inOwnTerritory;
