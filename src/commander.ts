// Both commanders (human UI and scripted AI) drive the sim ONLY through this
// interface. It is the door to future PvP — nothing may bypass it.
import type { Command, GameState, MarkerKind, Side } from './state';
import type { Vec } from './vec';

export interface CommanderInterface {
  readonly side: Side;
  issueMarker(squadId: number, kind: MarkerKind, pos: Vec): void;
  // Phase 3/4: buyAbility(...), placeGarrison(...), getVisibleState()
}

/** Queues commands onto the state; they are applied at the start of the next tick. */
export function makeCommander(state: () => GameState, side: Side): CommanderInterface {
  return {
    side,
    issueMarker(squadId, kind, pos) {
      const cmd: Command = { type: 'marker', side, squadId, kind, pos: { x: pos.x, y: pos.y } };
      state().pendingCommands.push(cmd);
    },
  };
}

/** Apply queued commands. Rejects anything targeting a squad the issuer does not own. */
export function applyCommands(state: GameState): void {
  for (const cmd of state.pendingCommands) {
    switch (cmd.type) {
      case 'marker': {
        const squad = state.squads[cmd.squadId];
        if (!squad || squad.side !== cmd.side) break;
        squad.marker = { kind: cmd.kind, pos: cmd.pos };
        break;
      }
    }
  }
  state.pendingCommands.length = 0;
}
