// One fixed-timestep simulation tick. Order matters and is the same for both sides.
import { CONFIG } from './config';
import { applyCommands } from './commander';
import type { GameState } from './state';
import { updateMovement, updateSquadPaths } from './systems/movement';
import { updateSquadAi } from './systems/squad_ai';
import { updateCombat } from './systems/combat';
import { updateVision } from './systems/vision';
import { updateSpawning } from './systems/spawning';
import { updateCapture } from './systems/capture';
import { updateEconomy } from './systems/economy';
import { updateMatch } from './systems/match';

export const TICK_DT = 1 / CONFIG.TICK_HZ;

export function stepSim(state: GameState): void {
  applyCommands(state);
  if (state.phase === 'play') {
    updateVision(state, TICK_DT);
    updateSquadAi(state);
    updateSquadPaths(state);
    updateMovement(state, TICK_DT);
    updateCombat(state, TICK_DT);
    updateSpawning(state, TICK_DT);
    updateCapture(state, TICK_DT);
    updateEconomy(state, TICK_DT);
  } else if (state.phase === 'setup') {
    updateVision(state, TICK_DT); // so the setup screen already shows what you can see
  }
  updateMatch(state, TICK_DT);
  state.tick++;
  state.time += TICK_DT;
}
