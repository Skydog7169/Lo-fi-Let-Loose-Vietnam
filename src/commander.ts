// Both commanders (human UI and scripted AI) drive the sim ONLY through this
// interface and may only read their own VisibleState. It is the door to future
// PvP — nothing may bypass it.
import { CONFIG } from './config';
import { isWalkable } from './map/grid';
import { createGarrison, inOwnTerritory, type Command, type GameState, type MarkerKind, type Side, type VisibleState } from './state';
import { dist, type Vec } from './vec';

export interface CommanderInterface {
  readonly side: Side;
  issueMarker(squadId: number, kind: MarkerKind, pos: Vec): void;
  placeGarrison(pos: Vec): void;
  redeployGarrison(garrisonId: number, pos: Vec): void;
  setupDone(): void;
  getVisibleState(): VisibleState;
  // Phase 4: buyAbility(...)
}

/** Queues commands onto the state; they are applied at the start of the next tick. */
export function makeCommander(state: () => GameState, side: Side): CommanderInterface {
  const push = (cmd: Command) => state().pendingCommands.push(cmd);
  return {
    side,
    issueMarker: (squadId, kind, pos) => push({ type: 'marker', side, squadId, kind, pos: { x: pos.x, y: pos.y } }),
    placeGarrison: (pos) => push({ type: 'placeGarrison', side, pos: { x: pos.x, y: pos.y } }),
    redeployGarrison: (garrisonId, pos) => push({ type: 'redeployGarrison', side, garrisonId, pos: { x: pos.x, y: pos.y } }),
    setupDone: () => push({ type: 'setupDone', side }),
    getVisibleState: () => state().vis[side],
  };
}

export type PlacementError = 'territory' | 'point' | 'terrain' | 'count' | 'wb' | 'cooldown' | 'supply' | 'phase';

/** Why a garrison may not be placed here (null = ok). Shared by UI preview and command validation. */
export function garrisonPlacementError(state: GameState, side: Side, pos: Vec, opts: { forRedeploy?: boolean } = {}): PlacementError | null {
  if (state.phase === 'ended') return 'phase';
  if (!isWalkable(state.grid, pos)) return 'terrain';
  if (!inOwnTerritory(state, side, pos)) return 'territory';
  for (const p of state.map.points) if (dist(p.pos, pos) < CONFIG.GARRISON_MIN_POINT_DIST) return 'point';
  if (opts.forRedeploy) return null;
  const owned = state.garrisons.filter((g) => g.side === side && g.state !== 'destroyed').length;
  if (state.phase === 'setup') {
    if (owned >= CONFIG.GARRISONS_AT_START) return 'count';
    return null;
  }
  if (state.res[side].wb < CONFIG.GARRISON_COST_WB) return 'wb';
  if (CONFIG.GARRISON_REQUIRES_SUPPLY && !hasSupplyNear(state, side, pos)) return 'supply';
  return null;
}

/** Phase 4 supply drops; until then nothing is supplied. */
export function hasSupplyNear(_state: GameState, _side: Side, _pos: Vec): boolean {
  return false;
}

/** Apply queued commands. Rejects anything targeting things the issuer does not own. */
export function applyCommands(state: GameState): void {
  for (const cmd of state.pendingCommands) {
    switch (cmd.type) {
      case 'marker': {
        const squad = state.squads[cmd.squadId];
        if (!squad || squad.side !== cmd.side) break;
        squad.marker = { kind: cmd.kind, pos: cmd.pos };
        break;
      }
      case 'placeGarrison': {
        if (garrisonPlacementError(state, cmd.side, cmd.pos)) break;
        if (state.phase === 'play') state.res[cmd.side].wb -= CONFIG.GARRISON_COST_WB;
        createGarrison(state, cmd.side, cmd.pos);
        break;
      }
      case 'redeployGarrison': {
        const g = state.garrisons[cmd.garrisonId];
        if (!g || g.side !== cmd.side || g.state !== 'active') break;
        if (garrisonPlacementError(state, cmd.side, cmd.pos, { forRedeploy: true })) break;
        if (state.phase === 'play') {
          if (state.res[cmd.side].wb < CONFIG.REDEPLOY_COST_WB) break;
          state.res[cmd.side].wb -= CONFIG.REDEPLOY_COST_WB;
        }
        g.state = 'packing';
        g.packTimer = state.phase === 'setup' ? 0 : CONFIG.REDEPLOY_PACK_SECONDS;
        g.packTarget = { x: cmd.pos.x, y: cmd.pos.y };
        break;
      }
      case 'setupDone':
        state.setupDone[cmd.side] = true;
        break;
    }
  }
  state.pendingCommands.length = 0;
}
