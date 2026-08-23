// One fixed-timestep simulation tick. Order matters and is the same for both sides.
import { CONFIG } from './config';
import { applyCommands } from './commander';
import type { GameState } from './state';
import { updateMovement, updateSquadPaths } from './systems/movement';

export const TICK_DT = 1 / CONFIG.TICK_HZ;

export function stepSim(state: GameState): void {
  applyCommands(state);
  updateSquadPaths(state);
  updateMovement(state, TICK_DT);
  state.tick++;
  state.time += TICK_DT;
}
