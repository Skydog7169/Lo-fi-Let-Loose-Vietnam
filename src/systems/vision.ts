// Fog of war (bible §5). Builds each side's VisibleState: territory vision
// (enemy units in the open inside your territory), unit vision radii (reduced
// against targets in cover), enemy spawns under the same rules, and fading
// last-known ghosts. Everything downstream — targeting, rendering, the AI —
// reads visibility only from here.
import { CONFIG } from '../config';
import { isCoverAt } from '../map/grid';
import { inOwnTerritory, isVehicle, sectorLineX, type Dot, type GameState, type Side } from '../state';
import { dist2, v, type Vec } from '../vec';

function visionRadius(state: GameState, d: Dot): number {
  const k = state.squads[d.squadId]!.kind;
  if (k === 'recon') return CONFIG.VISION_RECON;
  if (k === 'tank') return CONFIG.VISION_TANK;
  if (k === 'artillery') return 0;
  return CONFIG.VISION_INF;
}

/** Is world point p (an enemy thing, in cover or not) seen by `side`? */
function seenBy(state: GameState, side: Side, p: Vec, inCover: boolean, ownDots: Dot[], radii: Float32Array): boolean {
  if (CONFIG.DEBUG_REVEAL_ALL) return true;
  if (!inCover && inOwnTerritory(state, side, p)) return true;
  for (const r of state.recons) if (r.side === side && dist2(r.pos, p) <= r.r * r.r) return true; // recon flight sees through cover
  for (let i = 0; i < ownDots.length; i++) {
    let r = radii[i]!;
    if (inCover) r *= CONFIG.VISION_COVER_MULT;
    if (dist2(ownDots[i]!.pos, p) <= r * r) return true;
  }
  return false;
}

function enemyNear(p: Vec, dots: Dot[], r: number): boolean {
  const r2 = r * r;
  for (const d of dots) if (dist2(d.pos, p) <= r2) return true;
  return false;
}

export function updateVision(state: GameState, dt: number): void {
  const nDots = state.dots.length, nGar = state.garrisons.length, nSq = state.squads.length;
  for (const side of ['US', 'PAVN'] as Side[]) {
    const vs = state.vis[side];
    // age ghosts every tick
    for (let i = vs.ghosts.length - 1; i >= 0; i--) { const g = vs.ghosts[i]!; g.t -= dt; if (g.t <= 0) vs.ghosts.splice(i, 1); }
  }
  if (state.tick % CONFIG.VISION_INTERVAL_TICKS !== 0) return;

  for (const side of ['US', 'PAVN'] as Side[]) {
    const enemy: Side = side === 'US' ? 'PAVN' : 'US';
    const vs = state.vis[side];
    const prevDot = vs.dotVisible.length === nDots ? vs.dotVisible : new Uint8Array(nDots);
    const dotVisible = new Uint8Array(nDots);
    const garrisonVisible = new Uint8Array(nGar);
    const opVisible = new Uint8Array(nSq);
    const ownDots: Dot[] = [];
    for (const d of state.dots) if (d.alive && d.side === side) ownDots.push(d);
    const radii = new Float32Array(ownDots.length);
    for (let i = 0; i < ownDots.length; i++) radii[i] = visionRadius(state, ownDots[i]!);

    vs.enemyDots = [];
    for (const d of state.dots) {
      if (d.side !== enemy) continue;
      if (!d.alive) {
        // a visible dot that just died leaves a ghost too
        if (prevDot[d.id]) vs.ghosts.push({ pos: v(d.pos.x, d.pos.y), side: enemy, t: CONFIG.GHOST_SECONDS, kind: isVehicle(state.squads[d.squadId]!.kind) ? 'tank' : 'dot' });
        continue;
      }
      const cover = isCoverAt(state.grid, d.pos);
      const firing = state.time - d.firedAt < CONFIG.FIRE_REVEAL_S && enemyNear(d.pos, ownDots, CONFIG.FIRE_REVEAL_R);
      if (firing || seenBy(state, side, d.pos, cover, ownDots, radii)) { dotVisible[d.id] = 1; vs.enemyDots.push(d); }
      else if (prevDot[d.id]) {
        vs.ghosts.push({ pos: v(d.pos.x, d.pos.y), side: enemy, t: CONFIG.GHOST_SECONDS, kind: isVehicle(state.squads[d.squadId]!.kind) ? 'tank' : 'dot' });
      }
    }
    vs.enemyGarrisons = [];
    for (const g of state.garrisons) {
      if (g.side !== enemy || g.state === 'destroyed') continue;
      if (g.revealUntil > state.time || g.disabled || seenBy(state, side, g.pos, isCoverAt(state.grid, g.pos), ownDots, radii)) { garrisonVisible[g.id] = 1; vs.enemyGarrisons.push(g); }
    }
    vs.enemyOps = [];
    for (const sq of state.squads) {
      if (sq.side !== enemy || !sq.op) continue;
      if (sq.opRevealUntil > state.time || seenBy(state, side, sq.op, isCoverAt(state.grid, sq.op), ownDots, radii)) { opVisible[sq.id] = 1; vs.enemyOps.push({ squadId: sq.id, pos: sq.op }); }
    }
    vs.dotVisible = dotVisible;
    vs.garrisonVisible = garrisonVisible;
    vs.opVisible = opVisible;
    vs.own = {
      squads: state.squads.filter((s) => s.side === side),
      garrisons: state.garrisons.filter((g) => g.side === side && g.state !== 'destroyed'),
      res: state.res[side],
      cooldowns: state.cooldowns[side],
      supplies: state.supplies.filter((s) => s.side === side),
    };
    vs.pub = { points: state.points, active: state.active, sectorX: sectorLineX(state), timer: state.timer, phase: state.phase };
  }
}

/** Can `side` currently see dot `d`? (true for own dots) */
export function canSee(state: GameState, side: Side, d: Dot): boolean {
  if (d.side === side) return true;
  const vs = state.vis[side];
  return vs.dotVisible[d.id] === 1;
}
