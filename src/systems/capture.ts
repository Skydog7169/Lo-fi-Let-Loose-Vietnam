// Point control: the active point is contested by dot-count superiority inside
// its circle; capture moves the sector line, adds time, and locks the point.
import { CONFIG } from '../config';
import { isVehicle, type GameState, type Side } from '../state';
import { dist2 } from '../vec';

export function updateCapture(state: GameState, dt: number): void {
  if (state.active >= state.points.length || state.active < 0) return;
  const ps = state.points[state.active]!;
  const pm = state.map.points[state.active]!;
  const r2 = CONFIG.POINT_RADIUS ** 2;
  let us = 0, pavn = 0;
  for (const d of state.dots) {
    if (!d.alive) continue;
    if (state.squads[d.squadId]!.kind === 'artillery') continue;
    if (dist2(d.pos, pm.pos) > r2) continue;
    if (d.side === 'US') us++; else pavn++;
  }
  // tanks count as one body; infantry dots each count as one — superiority is raw count
  const diff = Math.max(-CONFIG.CAPTURE_MAX_SUPERIORITY, Math.min(CONFIG.CAPTURE_MAX_SUPERIORITY, us - pavn));
  // moving progress back toward 0 (undoing the enemy's work) is slower than pushing your own
  const undoing = ps.progress !== 0 && Math.sign(diff) !== Math.sign(ps.progress);
  const rate = (diff / CONFIG.CAPTURE_SECONDS_PER_DOT) * (undoing ? CONFIG.CAPTURE_ROLLBACK_MULT : 1);
  const min = state.mode === 'warfare' ? -1 : 0; // offensive: PAVN only rolls back, never flips a point
  ps.progress = Math.max(min, Math.min(1, ps.progress + rate * dt));
  // empty circle: partial progress drifts back to neutral
  if (us === 0 && pavn === 0 && ps.progress !== 0) {
    const d = Math.sign(ps.progress) * Math.min(Math.abs(ps.progress), CONFIG.CAPTURE_IDLE_DECAY * dt);
    ps.progress -= d;
  }
  if (ps.progress >= 1) { flipPoint(state, ps, 'US'); return; }
  if (ps.progress <= -1) { flipPoint(state, ps, 'PAVN'); return; }
  // warfare: an owned point that has repelled its attackers pushes the front back out on its own
  if (state.mode === 'warfare' && ps.owner) {
    const attackers = ps.owner === 'US' ? pavn : us;
    state.contestClearT = attackers === 0 ? state.contestClearT + dt : 0;
    if (state.contestClearT >= CONFIG.FRONT_RESET_SECONDS) {
      ps.progress = 0;
      state.contestClearT = 0;
      state.active += ps.owner === 'US' ? 1 : -1;
      if (state.active >= 0 && state.active < state.points.length) state.points[state.active]!.progress = 0;
      for (const sq of state.squads) sq.defendCache = null;
    }
  } else state.contestClearT = 0;
}

function flipPoint(state: GameState, ps: GameState['points'][number], to: 'US' | 'PAVN'): void {
  ps.owner = to;
  ps.progress = 0;
  state.contestClearT = 0;
  state.active += to === 'US' ? 1 : -1;
  if (state.active >= 0 && state.active < state.points.length) state.points[state.active]!.progress = 0;
  if (state.mode !== 'warfare') state.timer += CONFIG.CAPTURE_BONUS_SECONDS;
  // squads re-evaluate defend spots (threat direction may change) — cheap: drop caches
  for (const sq of state.squads) sq.defendCache = null;
}

export const isVehicleDot = (state: GameState, id: number): boolean => isVehicle(state.squads[state.dots[id]!.squadId]!.kind);

/** Dots of `side` inside the active point circle (for HUD). */
export function dotsOnActivePoint(state: GameState, side: Side): number {
  if (state.active >= state.points.length) return 0;
  const pm = state.map.points[state.active]!;
  const r2 = CONFIG.POINT_RADIUS ** 2;
  let n = 0;
  for (const d of state.dots) if (d.alive && d.side === side && dist2(d.pos, pm.pos) <= r2) n++;
  return n;
}
