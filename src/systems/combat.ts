// Engagement: halted dots fire at their target; hit/damage modified by cover,
// flanking and suppression; tanks immune to small arms; artillery zone fire.
import { CONFIG } from '../config';
import { isCoverAt } from '../map/grid';
import { rand } from '../rng';
import { isVehicle, pushEffect, squadsInOrder, type Dot, type GameState, type Squad } from '../state';
import { angleOf, dist2, fromAngle, sub, v, type Vec } from '../vec';
import { isAtGunner } from './squad_ai';

interface Weapon { interval: number; hit: number; dmg: number }

function weaponFor(state: GameState, shooter: Dot, target: Dot): Weapon {
  const ss = state.squads[shooter.squadId]!;
  const ts = state.squads[target.squadId]!;
  if (ss.kind === 'tank') {
    return isVehicle(ts.kind)
      ? { interval: CONFIG.TANK_GUN_FIRE_INTERVAL, hit: CONFIG.TANK_GUN_HIT_CHANCE, dmg: CONFIG.TANK_GUN_DAMAGE }
      : { interval: CONFIG.TANK_MG_FIRE_INTERVAL, hit: CONFIG.TANK_MG_HIT_CHANCE, dmg: CONFIG.TANK_MG_DAMAGE };
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

function shoot(state: GameState, shooter: Dot, target: Dot): void {
  const w = weaponFor(state, shooter, target);
  const ts = state.squads[target.squadId]!;
  const targetVehicle = isVehicle(ts.kind);
  const covered = !targetVehicle && isCoverAt(state.grid, target.pos) && !isFlanking(shooter, target);
  let hit = w.hit * (1 - CONFIG.SUPPRESS_ACC_MULT_MAX * shooter.suppression);
  let dmg = w.dmg;
  if (covered) { hit *= CONFIG.COVER_HIT_MULT; dmg *= CONFIG.COVER_DMG_MULT; }
  const landed = rand(state.rng) < hit;
  if (landed) {
    target.hp -= dmg;
    if (target.hp <= 0) killDot(state, target);
  }
  // suppression on hit or near miss (vehicles immune)
  if (!targetVehicle) target.suppression = Math.min(1, target.suppression + CONFIG.SUPPRESS_PER_SHOT);
  shooter.fireCooldown = w.interval / (1 - CONFIG.SUPPRESS_FIRE_MULT_MAX * shooter.suppression);
  shooter.facing = angleOf(sub(target.pos, shooter.pos));

  // effects
  const jitter = landed ? 0 : 6;
  const end = v(target.pos.x + (rand(state.rng) - 0.5) * 2 * jitter, target.pos.y + (rand(state.rng) - 0.5) * 2 * jitter);
  pushEffect(state, { kind: 'tracer', a: v(shooter.pos.x, shooter.pos.y), b: end, side: shooter.side, ttl: CONFIG.TRACER_TTL, max: CONFIG.TRACER_TTL });
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
  state.shells.push({ to, t: CONFIG.ARTY_FLIGHT_TIME, side: squad.side });
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
  pushEffect(state, { kind: 'impact', pos: v(p.x, p.y), r: CONFIG.ARTY_SPLASH_R, ttl: CONFIG.IMPACT_TTL, max: CONFIG.IMPACT_TTL });
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
      if (d.targetId < 0) continue;
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
    if (s.t <= 0) { shellImpact(state, s.to); state.shells.splice(i, 1); }
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
