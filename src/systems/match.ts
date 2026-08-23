// Match flow: setup phase → play → ended. Win/loss per bible §3.3.
import { CONFIG } from '../config';
import { type GameState, type Side } from '../state';
import { ownedGarrisons, squadIsLiving } from './spawning';

export function updateMatch(state: GameState, dt: number): void {
  if (state.phase === 'draft') {
    if (state.drafted.US && state.drafted.PAVN) { state.phase = 'setup'; if (CONFIG.SKIP_SETUP) state.setupTimer = 1; }
    return;
  }
  if (state.phase === 'setup') {
    state.setupTimer -= dt;
    const bothDone = state.setupDone.US && state.setupDone.PAVN;
    if (state.setupTimer <= 0 || bothDone) state.phase = 'play';
    return;
  }
  if (state.phase !== 'play') return;
  state.timer -= dt;
  if (state.active >= state.points.length) { end(state, 'US', 'captured point 5'); return; }
  if (state.timer <= 0) { state.timer = 0; end(state, 'PAVN', 'held at time-out'); return; }
  for (const side of ['US', 'PAVN'] as Side[]) {
    if (ownedGarrisons(state, side).length === 0 && !state.squads.some((s) => s.side === side && squadIsLiving(state, s))) {
      end(state, side === 'US' ? 'PAVN' : 'US', `${side} annihilated`);
      return;
    }
  }
}

function end(state: GameState, winner: Side, reason: string): void {
  state.phase = 'ended';
  state.result = { winner, reason };
}

export const fmtTime = (s: number): string => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const setupSkipped = (): boolean => CONFIG.SKIP_SETUP;
