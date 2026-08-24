// Engagement: halted dots fire at their target; hit/damage modified by cover,
// flanking and suppression; tanks immune to small arms; artillery zone fire.
import { CONFIG } from '../config';
import { isCoverAt } from '../map/grid';
import { rand } from '../rng';
import { isVehicle, pushEffect, squadsInOrder, type Bunker, type Dot, type Garrison, type GameState, type Squad } from '../state';
import { angleOf, dist2, distToSegment2, fromAngle, sub, v, type Vec } from '../vec';
import { isAtGunner } from './squad_ai';

interface Weapon { interval: number; hit: number; dmg: number }

function weaponFor(state: GameState, shooter: Dot, target: Dot): Weapon {
  const ss = state.squads[shooter.squadId]!;
  const ts = state.squads[target.squadId]!;
  if (ss.kind === 'tank') {
    return isVehicle(ts.kind)
      ? { interval: CONFIG.TANK_GUN_FIRE_INTERVAL, hit: CONFIG.TANK_GUN_HIT_CHANCE, dmg: CONFIG.TANK_GUN_DAMAGE }
      : { interval: CONFIG.TANK_HE_FIRE_INTERVAL, hit: CONFIG.TANK_HE_HIT_CHANCE, dmg: CONFIG.TANK_HE_DAMAGE };
  }
  if (ss.kind === 'at' && isVehicle(ts.kind) && isAtGunner(shooter)) {
    return { interval: CONFIG.AT_FIRE_INTERVAL, hit: CONFIG.AT_HIT_CHANCE, dmg: CONFIG.AT_DAMAGE };
  }
  const mult = ss.kind === 'recon' ? CONFIG.RECON_DAMAGE_MULT : 1;
  return { interval: CONFIG.INF_FIRE_INTERVAL, hit: CONFIG.INF_HIT_CHANCE, dmg: CONFIG.INF_DAMAGE * mult };
}

const FLANK_RAD = (CONFIG.FLANK_ANGLE_DEG * Math.PI) / 180;
function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

/** Fire from ≥60° off the target's facing ignores its cover bonus (bible §9.3). */
export function isFlanking(shooter: Dot, target: Dot): boolean {
  const bearing = angleOf(sub(shooter.pos, target.pos));
  return angleDiff(bearing, target.facing) >= FLANK_RAD;
}

function killDot(state: GameState, d: Dot): void {
  d.alive = false;
  state.stats[d.side].casualties++;
  d.hp = 0;
  d.targetId = -1;
  d.coverSeek = null;
  pushEffect(state, { kind: 'death', pos: v(d.pos.x, d.pos.y), side: d.side, ttl: CONFIG.DEATH_TTL, max: CONFIG.DEATH_TTL });
}

/** Tank HE round: lands on (or near) the target, splashes every enemy infantry dot around the impact. */
function fireHe(state: GameState, shooter: Dot, target: Dot): void {
  const w = weaponFor(state, shooter, target);
  const landed = rand(state.rng) < w.hit * (1 - CONFIG.SUPPRESS_ACC_MULT_MAX * shooter.suppression);
  const ang = rand(state.rng) * Math.PI * 2, sc = landed ? 0 : CONFIG.TANK_HE_SCATTER * (0.5 + 0.5 * rand(state.rng));
  const to = v(target.pos.x + Math.cos(ang) * sc, target.pos.y + Math.sin(ang) * sc);
  state.shells.push({ to, t: CONFIG.TANK_HE_FLIGHT, side: shooter.side, kind: 'he' });
  shooter.firedAt = state.time;
  shooter.fireCooldown = w.interval;
  shooter.facing = angleOf(sub(target.pos, shooter.pos));
  pushEffect(state, { kind: 'tracer', a: v(shooter.pos.x, shooter.pos.y), b: to, side: shooter.side, ttl: CONFIG.TRACER_TTL * 1.5, max: CONFIG.TRACER_TTL * 1.5 });
  pushEffect(state, { kind: 'flash', pos: v(shooter.pos.x, shooter.pos.y), side: shooter.side, ttl: CONFIG.FLASH_TTL * 2, max: CONFIG.FLASH_TTL * 2 });
}

export function heImpact(state: GameState, p: Vec, side: 'US' | 'PAVN'): void {
  const sr2 = CONFIG.TANK_HE_SPLASH_R ** 2, ur2 = CONFIG.TANK_HE_SUPPRESS_R ** 2;
  for (const d of state.dots) {
    if (!d.alive || d.side === side) continue; // HE only hurts the enemy (no friendly fire on your own pushing squads)
    const sq = state.squads[d.squadId]!;
    if (isVehicle(sq.kind)) continue;
    const d2 = dist2(d.pos, p);
    if (d2 <= sr2) {
      let dmg = CONFIG.TANK_HE_DAMAGE;
      if (isCoverAt(state.grid, d.pos)) dmg *= CONFIG.TANK_HE_COVER_MULT;
      d.hp -= dmg;
      if (d.hp <= 0) killDot(state, d);
    }
    if (d.alive && d2 <= ur2) d.suppression = Math.min(1, d.suppression + CONFIG.TANK_HE_SUPPRESS);
  }
  damageStructures(state, p, CONFIG.TANK_HE_DAMAGE, CONFIG.TANK_HE_SPLASH_R);
  pushEffect(state, { kind: 'impact', pos: v(p.x, p.y), r: CONFIG.TANK_HE_SPLASH_R * 0.8, ttl: CONFIG.IMPACT_TTL * 0.8, max: CONFIG.IMPACT_TTL * 0.8 });
}

/** Explosions chew through wire and bunkers. */
function damageStructures(state: GameState, p: Vec, dmg: number, r: number): void {
  const r2 = r * r;
  for (let i = state.wires.length - 1; i >= 0; i--) {
    const w = state.wires[i]!;
    if (distToSegment2(p, w.a, w.b) <= r2) { w.hp -= dmg; if (w.hp <= 0) state.wires.splice(i, 1); }
  }
  for (let i = state.bunkers.length - 1; i >= 0; i--) {
    const b = state.bunkers[i]!;
    if (dist2(b.pos, p) <= r2) { b.hp -= dmg; if (b.hp <= 0) { state.bunkers.splice(i, 1); pushEffect(state, { kind: 'impact', pos: v(b.pos.x, b.pos.y), r: 14, ttl: CONFIG.IMPACT_TTL, max: CONFIG.IMPACT_TTL }); } }
  }
}

function shoot(state: GameState, shooter: Dot, target: Dot): void {
  const ts = state.squads[target.squadId]!;
  const targetVehicle = isVehicle(ts.kind);
  if (state.squads[shooter.squadId]!.kind === 'tank' && !targetVehicle) { fireHe(state, shooter, target); return; }
  const w = weaponFor(state, shooter, target);
  const flank = isFlanking(shooter, target);
  const covered = !targetVehicle && isCoverAt(state.grid, target.pos) && !flank;
  const bunkered = !targetVehicle && inFriendlyBunker(state, target); // enclosed: flanking does not bypass
  const trenched = !targetVehicle && !covered && !bunkered && !flank && inTrench(state, target.pos);
  const dug = !targetVehicle && !covered && !bunkered && !trenched && !!target.dugIn && !flank;
  let hit = w.hit * (1 - CONFIG.SUPPRESS_ACC_MULT_MAX * shooter.suppression);
  let dmg = w.dmg;
  if (bunkered) { hit *= CONFIG.BUNKER_HIT_MULT; dmg *= CONFIG.BUNKER_DMG_MULT; }
  else if (covered) { hit *= CONFIG.COVER_HIT_MULT; dmg *= CONFIG.COVER_DMG_MULT; }
  else if (trenched) { hit *= CONFIG.TRENCH_HIT_MULT; dmg *= CONFIG.TRENCH_DMG_MULT; }
  else if (dug) { hit *= CONFIG.DIG_IN_HIT_MULT; dmg *= CONFIG.DIG_IN_DMG_MULT; }
  if (!targetVehicle) {
    // weight of fire: pinned men are easier to hit; shaken (outnumbered + pinned) men more so
    hit *= 1 + CONFIG.SUPPRESSED_TARGET_VULNERABILITY * target.suppression;
    if (ts.shaken) hit *= 1 + CONFIG.SHAKEN_HIT_BONUS;
  }
  const landed = rand(state.rng) < hit;
  if (landed) {
    target.hp -= dmg;
    if (target.hp <= 0) killDot(state, target);
  }
  // suppression on hit or near miss (vehicles immune); flank/rear fire rattles harder
  if (!targetVehicle) target.suppression = Math.min(1, target.suppression + CONFIG.SUPPRESS_PER_SHOT * (flank ? CONFIG.FLANK_SUPPRESS_MULT : 1));
  shooter.firedAt = state.time;
  shooter.fireCooldown = w.interval / (1 - CONFIG.SUPPRESS_FIRE_MULT_MAX * shooter.suppression);
  if (state.squads[shooter.squadId]!.shaken) shooter.fireCooldown /= CONFIG.SHAKEN_FIRE_MULT; // shaken: heads down
  shooter.facing = angleOf(sub(target.pos, shooter.pos));

  // effects
  const jitter = landed ? 0 : 6;
  const end = v(target.pos.x + (rand(state.rng) - 0.5) * 2 * jitter, target.pos.y + (rand(state.rng) - 0.5) * 2 * jitter);
  pushEffect(state, { kind: 'tracer', a: v(shooter.pos.x, shooter.pos.y), b: end, side: shooter.side, ttl: CONFIG.TRACER_TTL, max: CONFIG.TRACER_TTL, flank: flank && !targetVehicle });
  pushEffect(state, { kind: 'flash', pos: v(shooter.pos.x, shooter.pos.y), side: shooter.side, ttl: CONFIG.FLASH_TTL, max: CONFIG.FLASH_TTL });
}

// ---- artillery ----

export interface Shell { to: Vec; t: number; side: 'US' | 'PAVN' }

function fireBattery(state: GameState, squad: Squad, gun: Dot): void {
  if (!squad.marker || squad.marker.kind !== 'attack' || gun.shells <= 0) return;
  if (gun.fireCooldown > 0) return;
  gun.shells--;
  gun.fireCooldown = CONFIG.ARTY_SHELL_INTERVAL;
  const ang = rand(state.rng) * Math.PI * 2;
  const rad = Math.sqrt(rand(state.rng)) * CONFIG.ARTY_ZONE_R;
  const to = v(squad.marker.pos.x + Math.cos(ang) * rad, squad.marker.pos.y + Math.sin(ang) * rad);
  state.shells.push({ to, t: CONFIG.ARTY_FLIGHT_TIME, side: squad.side, kind: 'arty' });
  pushEffect(state, { kind: 'shell', from: v(gun.pos.x, gun.pos.y), to, ttl: CONFIG.ARTY_FLIGHT_TIME, max: CONFIG.ARTY_FLIGHT_TIME });
  pushEffect(state, { kind: 'flash', pos: v(gun.pos.x, gun.pos.y), side: squad.side, ttl: CONFIG.FLASH_TTL * 2, max: CONFIG.FLASH_TTL * 2 });
}

export function shellImpact(state: GameState, p: Vec): void {
  const sr2 = CONFIG.ARTY_SPLASH_R ** 2, ur2 = CONFIG.ARTY_SUPPRESS_R ** 2;
  for (const d of state.dots) {
    if (!d.alive) continue;
    const d2 = dist2(d.pos, p);
    if (d2 <= sr2) { d.hp -= CONFIG.ARTY_SHELL_DAMAGE; if (d.hp <= 0) killDot(state, d); }
    if (d.alive && d2 <= ur2 && !isVehicle(state.squads[d.squadId]!.kind)) d.suppression = Math.min(1, d.suppression + CONFIG.ARTY_SUPPRESS);
  }
  // spawns: OPs are deleted by a near hit, garrisons lose hp and die after a few
  for (const sq of state.squads) if (sq.op && dist2(sq.op, p) <= sr2) sq.op = null;
  damageStructures(state, p, CONFIG.SHELL_SPAWN_DAMAGE, Math.sqrt(sr2));
  for (const g of state.garrisons) {
    if (g.state === 'destroyed' || dist2(g.pos, p) > sr2) continue;
    g.hp -= CONFIG.SHELL_SPAWN_DAMAGE;
    if (g.hp <= 0) { g.state = 'destroyed'; g.disabled = false; state.stats[g.side].garrisonsLost++; }
  }
  pushEffect(state, { kind: 'impact', pos: v(p.x, p.y), r: CONFIG.ARTY_SPLASH_R, ttl: CONFIG.IMPACT_TTL, max: CONFIG.IMPACT_TTL });
}

export function inTrench(state: GameState, p: Vec): boolean {
  for (const t of state.trenches) if (distToSegment2(p, t.a, t.b) <= CONFIG.TRENCH_HALF_W ** 2) return true;
  return false;
}

function inFriendlyBunker(state: GameState, d: Dot): boolean {
  const r2 = CONFIG.BUNKER_R ** 2;
  for (const b of state.bunkers) {
    if (b.side !== d.side) continue;
    const myD2 = dist2(b.pos, d.pos);
    if (myD2 > r2) continue;
    // capacity: only the closest BUNKER_CAPACITY men fit inside — the rest are just standing next to concrete
    let closer = 0;
    for (const o of state.dots) {
      if (!o.alive || o.side !== d.side || o.id === d.id) continue;
      if (dist2(b.pos, o.pos) < myD2) closer++;
      if (closer >= CONFIG.BUNKER_CAPACITY) break;
    }
    if (closer < CONFIG.BUNKER_CAPACITY) return true;
  }
  return false;
}

/** Tanks and AT gunners with nothing else to shoot engage a visible enemy garrison or bunker in range. */
function shootStructure(state: GameState, squad: Squad, d: Dot): void {
  if (d.fireCooldown > 0) return;
  const vis = state.vis[d.side];
  const range = squad.kind === 'tank' ? CONFIG.TANK_RANGE : CONFIG.AT_RANGE_VS_ARMOR;
  let best: Garrison | Bunker | null = null, bd = range * range;
  for (const g of state.garrisons) {
    if (g.side === d.side || g.state === 'destroyed') continue;
    if (!(vis.garrisonVisible.length > g.id && vis.garrisonVisible[g.id])) continue;
    const d2 = dist2(g.pos, d.pos);
    if (d2 <= bd) { bd = d2; best = g; }
  }
  for (const b of state.bunkers) {
    if (b.side === d.side || b.hp <= 0) continue;
    const d2 = dist2(b.pos, d.pos);
    if (d2 <= bd) { bd = d2; best = b; }
  }
  if (!best) return;
  const tank = squad.kind === 'tank';
  d.facing = angleOf(sub(best.pos, d.pos));
  d.firedAt = state.time;
  d.fireCooldown = tank ? CONFIG.TANK_GUN_FIRE_INTERVAL : CONFIG.AT_FIRE_INTERVAL;
  const landed = rand(state.rng) < CONFIG.STRUCTURE_HIT_CHANCE;
  if (landed) {
    best.hp -= tank ? CONFIG.TANK_STRUCTURE_DAMAGE : CONFIG.AT_STRUCTURE_DAMAGE;
    if (best.hp <= 0) {
      if ('state' in best) { best.state = 'destroyed'; best.disabled = false; state.stats[best.side].garrisonsLost++; }
      else state.bunkers.splice(state.bunkers.indexOf(best), 1);
      pushEffect(state, { kind: 'impact', pos: v(best.pos.x, best.pos.y), r: 14, ttl: CONFIG.IMPACT_TTL, max: CONFIG.IMPACT_TTL });
    }
  }
  const end = landed ? v(best.pos.x, best.pos.y) : v(best.pos.x + (rand(state.rng) - 0.5) * 16, best.pos.y + (rand(state.rng) - 0.5) * 16);
  pushEffect(state, { kind: 'tracer', a: v(d.pos.x, d.pos.y), b: end, side: d.side, ttl: CONFIG.TRACER_TTL * 1.5, max: CONFIG.TRACER_TTL * 1.5 });
  pushEffect(state, { kind: 'flash', pos: v(d.pos.x, d.pos.y), side: d.side, ttl: CONFIG.FLASH_TTL * 2, max: CONFIG.FLASH_TTL * 2 });
  pushEffect(state, { kind: 'impact', pos: end, r: 6, ttl: CONFIG.IMPACT_TTL * 0.6, max: CONFIG.IMPACT_TTL * 0.6 });
}

export function updateCombat(state: GameState, dt: number): void {
  const decay = dt / CONFIG.SUPPRESS_DECAY_S;
  for (const squad of squadsInOrder(state)) {
    for (const id of squad.dotIds) {
      const d = state.dots[id]!;
      if (!d.alive) continue;
      d.suppression = Math.max(0, d.suppression - decay);
      d.fireCooldown -= dt;
      if (squad.kind === 'artillery') { fireBattery(state, squad, d); continue; }
      if (d.targetId < 0) { if (!d.moving && (squad.kind === 'tank' || (squad.kind === 'at' && isAtGunner(d)))) shootStructure(state, squad, d); continue; }
      const t = state.dots[d.targetId];
      if (!t || !t.alive) { d.targetId = -1; continue; }
      if (d.moving) continue; // halt, face, fire — no shooting on the move
      d.facing = angleOf(sub(t.pos, d.pos));
      if (d.fireCooldown <= 0) shoot(state, d, t);
    }
  }
  // shells in flight
  for (let i = state.shells.length - 1; i >= 0; i--) {
    const s = state.shells[i]!;
    s.t -= dt;
    if (s.t <= 0) { if (s.kind === 'he') heImpact(state, s.to, s.side); else shellImpact(state, s.to); state.shells.splice(i, 1); }
  }
  // effects ttl
  const fx = state.effects;
  let w = 0;
  for (let i = 0; i < fx.length; i++) {
    const e = fx[i]!;
    e.ttl -= dt;
    if (e.ttl > 0) fx[w++] = e;
  }
  fx.length = w;
}

export const facingVec = (d: Dot): Vec => fromAngle(d.facing);
