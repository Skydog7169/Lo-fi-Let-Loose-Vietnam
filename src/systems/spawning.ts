// Garrisons, OPs, spawn waves (bible §6) — the heart of the game.
import { CONFIG } from '../config';
import { isWalkable } from '../map/grid';
import { aliveDots, formationOffset, hqCenter, squadCentroid, squadsInOrder, type Dot, type GameState, type Garrison, type Side, type Squad } from '../state';
import { dist, dist2, v, type Vec } from '../vec';
import { resolveGoal, findPath } from './movement';

// ---------- garrisons ----------

function updateGarrisons(state: GameState, dt: number): void {
  const R2 = CONFIG.GARRISON_DISABLE_R ** 2;
  for (const g of state.garrisons) {
    if (g.state === 'destroyed') continue;
    if (g.state === 'packing') {
      g.packTimer -= dt;
      if (g.packTimer <= 0 && g.packTarget) {
        g.pos = g.packTarget; g.packTarget = null; g.state = 'active'; g.threatTimer = 0;
      }
    }
    // enemy presence disables; sustained presence destroys (also while packing — it is inert and vulnerable)
    let threatened = false;
    for (const d of state.dots) {
      if (!d.alive || d.side === g.side) continue;
      if (dist2(d.pos, g.pos) <= R2) { threatened = true; break; }
    }
    g.disabled = threatened;
    if (threatened) {
      g.threatTimer += dt;
      if (g.threatTimer >= CONFIG.GARRISON_DESTROY_SECONDS) {
        g.state = 'destroyed';
        g.disabled = false;
        state.stats[g.side].garrisonsLost++;
      }
    } else g.threatTimer = 0;
  }
}

export function ownedGarrisons(state: GameState, side: Side): Garrison[] {
  return state.garrisons.filter((g) => g.side === side && g.state !== 'destroyed');
}

/** Spawns this close to the contested point are locked (both sides): reinforcements must walk in. */
export function spawnLocked(state: GameState, p: Vec, side?: Side): boolean {
  if (state.active >= state.map.points.length) return false;
  if (dist2(p, state.map.points[state.active]!.pos) > CONFIG.ACTIVE_POINT_SPAWN_LOCK_R ** 2) return false;
  // a garrison on a point you hold (not the contested one) always spawns
  if (side && CONFIG.GARRISON_ON_OWNED_POINT) {
    for (let i = 0; i < state.map.points.length; i++) {
      if (i === state.active || state.points[i]!.owner !== side) continue;
      if (dist2(p, state.map.points[i]!.pos) <= CONFIG.POINT_RADIUS ** 2) return false;
    }
  }
  return true;
}

/** Nearest usable (active, not disabled, not locked) garrison to p, or null. */
export function nearestSpawnGarrison(state: GameState, side: Side, p: Vec): Garrison | null {
  let best: Garrison | null = null, bd = Infinity;
  for (const g of state.garrisons) {
    if (g.side !== side || g.state !== 'active' || g.disabled || spawnLocked(state, g.pos, side)) continue;
    const d = dist2(g.pos, p);
    if (d < bd) { bd = d; best = g; }
  }
  return best;
}

// ---------- OPs ----------

function updateOps(state: GameState, dt: number): void {
  for (const sq of squadsInOrder(state)) {
    if (sq.kind === 'artillery') continue;
    const alive = aliveDots(state, sq);
    const c = squadCentroid(state, sq);
    // enemy touch deletes instantly
    if (sq.op) {
      const r2 = CONFIG.OP_TOUCH_R ** 2;
      for (const d of state.dots) {
        if (!d.alive || d.side === sq.side) continue;
        if (dist2(d.pos, sq.op) <= r2) { sq.op = null; break; }
      }
    }
    if (!alive.length || !c) { sq.opTimer = 0; sq.lastCentroid = c; continue; }
    // auto-drop: stationary-or-slow near marker and out of combat for OP_DROP_SECONDS
    const goal = resolveGoal(state, sq);
    const nearMarker = !!goal && dist(c, goal) <= CONFIG.OP_NEAR_MARKER_R;
    const speed = sq.lastCentroid ? dist(c, sq.lastCentroid) / dt : 0;
    let inCombat = false, supp = 0;
    for (const d of alive) { if (d.targetId >= 0) inCombat = true; supp += d.suppression; }
    const calm = !inCombat && supp / alive.length < 0.2 && !sq.fallback;
    if (nearMarker && calm && speed <= CONFIG.OP_SLOW_SPEED) sq.opTimer += dt; else sq.opTimer = 0;
    sq.lastCentroid = c;
    if (sq.opTimer >= CONFIG.OP_DROP_SECONDS) {
      sq.opTimer = 0;
      const lead = alive[0]!;
      if (isWalkable(state.grid, lead.pos) && (!sq.op || dist(sq.op, lead.pos) > 20)) sq.op = v(lead.pos.x, lead.pos.y);
    }
  }
}

// ---------- waves ----------

/** Where this squad's dead members come back: OP → nearest garrison → HQ. */
export function spawnPointFor(state: GameState, sq: Squad): { pos: Vec; kind: 'op' | 'garrison' | 'hq' } {
  if (sq.op && !spawnLocked(state, sq.op)) return { pos: sq.op, kind: 'op' };
  const c = squadCentroid(state, sq) ?? (sq.marker ? sq.marker.pos : hqCenter(state, sq.side));
  const g = nearestSpawnGarrison(state, sq.side, c);
  if (g) return { pos: g.pos, kind: 'garrison' };
  return { pos: hqCenter(state, sq.side), kind: 'hq' };
}

function respawnDot(state: GameState, sq: Squad, dot: Dot, at: Vec, rejoinPath: Vec[] | null): void {
  const n = sq.dotIds.length;
  const off = formationOffset(dot.slot, n, sq.heading);
  let p = v(at.x + off.x, at.y + off.y);
  if (!isWalkable(state.grid, p)) p = v(at.x, at.y);
  dot.pos = p;
  dot.hp = dot.maxHp;
  dot.alive = true;
  dot.suppression = 0;
  dot.targetId = -1;
  dot.coverSeek = null;
  dot.fireCooldown = 0;
  dot.moving = false;
  dot.detour = null;
  dot.detourCooldown = 0;
  if (CONFIG.RESPAWN_REJOIN && rejoinPath && rejoinPath.length) {
    dot.detour = rejoinPath.map((q) => v(q.x, q.y));
    // after the detour the dot should continue from wherever its squadmates are on the path
    let maxWp = 0;
    for (const id of sq.dotIds) { const d = state.dots[id]!; if (d.alive && d.id !== dot.id && d.wp > maxWp) maxWp = d.wp; }
    dot.wp = maxWp;
  } else {
    dot.wp = 0;
  }
}

function updateWaves(state: GameState, dt: number): void {
  if (!state.rules.respawn) return;
  for (const side of ['US', 'PAVN'] as Side[]) {
    state.waveTimer[side] -= dt;
    if (state.waveTimer[side] > 0) continue;
    state.waveTimer[side] = CONFIG.WAVE_SECONDS;
    const res = state.res[side];
    for (const sq of squadsInOrder(state)) {
      if (sq.side !== side || sq.kind === 'artillery') continue;
      const dead = sq.dotIds.map((id) => state.dots[id]!).filter((d) => !d.alive);
      if (!dead.length) continue;
      if (sq.kind === 'tank') {
        // Fuel-funded respawn at the HQ (TANK_RESPAWNS_PER_SLOT per match)
        if ((state.tankRespawns[sq.id] ?? 0) >= CONFIG.TANK_RESPAWNS_PER_SLOT || res.fuel < CONFIG.TANK_RESPAWN_FUEL) continue;
        res.fuel -= CONFIG.TANK_RESPAWN_FUEL;
        state.tankRespawns[sq.id] = (state.tankRespawns[sq.id] ?? 0) + 1;
        for (const d of dead) respawnDot(state, sq, d, hqCenter(state, side), null);
        sq.pathGoal = null;
        continue;
      }
      const alive = aliveDots(state, sq);
      const sp = spawnPointFor(state, sq);
      if (sp.kind === 'hq' && !hqSpawnAllowed(state, side)) continue;
      revealSpawn(state, sq, sp);
      const rejoinTo = alive.length ? squadCentroid(state, sq) : null;
      const rejoinPath = rejoinTo && dist(rejoinTo, sp.pos) > CONFIG.WAYPOINT_ARRIVE_R * 2 ? findPath(state.grid, sp.pos, rejoinTo, false) : null;
      for (const d of dead) {
        if (res.man < CONFIG.MANPOWER_PER_SOLDIER) break; // empty pool = respawns pause
        res.man -= CONFIG.MANPOWER_PER_SOLDIER;
        respawnDot(state, sq, d, sp.pos, rejoinPath);
      }
      if (!alive.length) { sq.pathGoal = null; sq.fallback = null; } // whole squad back: path to marker afresh
    }
  }
}

/** Spawning makes noise: if an enemy dot is within SPAWN_REVEAL_R of the spawn, it is revealed for SPAWN_REVEAL_S. */
function revealSpawn(state: GameState, sq: Squad, sp: { pos: Vec; kind: 'op' | 'garrison' | 'hq' }): void {
  if (sp.kind === 'hq') return;
  const R2 = CONFIG.SPAWN_REVEAL_R ** 2;
  let near = false;
  for (const d of state.dots) if (d.alive && d.side !== sq.side && dist2(d.pos, sp.pos) <= R2) { near = true; break; }
  if (!near) return;
  if (sp.kind === 'op') sq.opRevealUntil = state.time + CONFIG.SPAWN_REVEAL_S;
  else { const g = nearestSpawnGarrison(state, sq.side, sp.pos); if (g) g.revealUntil = state.time + CONFIG.SPAWN_REVEAL_S; }
}

/** The HQ is an ultimate fallback spawn only while the side still owns ≥1 garrison or has a living squad on the field. */
export function hqSpawnAllowed(state: GameState, side: Side): boolean {
  return ownedGarrisons(state, side).length > 0 || state.squads.some((s) => s.side === side && s.dotIds.some((id) => state.dots[id]!.alive));
}

/** A squad counts as living if any member is alive, or it can still come back (a spawn exists and manpower allows). */
export function squadIsLiving(state: GameState, sq: Squad): boolean {
  if (sq.dotIds.some((id) => state.dots[id]!.alive)) return true;
  if (!state.rules.respawn) return false;
  if (sq.kind === 'tank' || sq.kind === 'artillery') return false;
  if (state.res[sq.side].man < CONFIG.MANPOWER_PER_SOLDIER) return false;
  const sp = spawnPointFor(state, sq);
  if (sp.kind === 'hq') return hqSpawnAllowed(state, sq.side);
  return true;
}

export function updateSpawning(state: GameState, dt: number): void {
  updateGarrisons(state, dt);
  updateOps(state, dt);
  updateWaves(state, dt);
}
