// Both commanders (human UI and scripted AI) drive the sim ONLY through this
// interface and may only read their own VisibleState. It is the door to future
// PvP — nothing may bypass it.
import { CONFIG } from './config';
import { isWalkable } from './map/grid';
import { createGarrison, inOwnTerritory, type AbilityKind, type Command, type GameState, type MarkerKind, type Side, type SquadKind, type VisibleState } from './state';
import { buyAbility } from './systems/abilities';
import { applyDraft } from './systems/draft';
import { dist, type Vec } from './vec';

export interface CommanderInterface {
  readonly side: Side;
  issueMarker(squadId: number, kind: MarkerKind, pos: Vec): void;
  placeGarrison(pos: Vec): void;
  redeployGarrison(garrisonId: number, pos: Vec): void;
  setupDone(): void;
  draft(comp: Record<SquadKind, number>): void;
  buyAbility(ability: AbilityKind, pos: Vec, pos2?: Vec, garrisonId?: number): void;
  getVisibleState(): VisibleState;
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
    draft: (comp) => push({ type: 'draft', side, comp: { ...comp } }),
    buyAbility: (ability, pos, pos2, garrisonId) => push({ type: 'ability', side, ability, pos: { x: pos.x, y: pos.y }, pos2: pos2 ? { x: pos2.x, y: pos2.y } : undefined, garrisonId }),
    getVisibleState: () => state().vis[side],
  };
}

export type PlacementError = 'locked' | 'territory' | 'point' | 'terrain' | 'count' | 'wb' | 'cooldown' | 'supply' | 'phase';

/** Why a garrison may not be placed here (null = ok). Shared by UI preview and command validation. */
export function garrisonPlacementError(state: GameState, side: Side, pos: Vec, opts: { forRedeploy?: boolean } = {}): PlacementError | null {
  if (state.phase === 'ended') return 'phase';
  if (!isWalkable(state.grid, pos)) return 'terrain';
  if (!inOwnTerritory(state, side, pos)) return 'territory';
  for (let i = 0; i < state.map.points.length; i++) {
    const p = state.map.points[i]!;
    const ownedBehind = CONFIG.GARRISON_ON_OWNED_POINT && i !== state.active && state.points[i]!.owner === side;
    if (ownedBehind) continue; // you may build right on a point you hold
    if (dist(p.pos, pos) < CONFIG.GARRISON_MIN_POINT_DIST) return 'point';
  }
  if (state.active >= 0 && state.active < state.map.points.length && dist(state.map.points[state.active]!.pos, pos) <= CONFIG.ACTIVE_POINT_SPAWN_LOCK_R) return 'locked';
  if (opts.forRedeploy) return null;
  const owned = state.garrisons.filter((g) => g.side === side && g.state !== 'destroyed').length;
  if (state.phase === 'setup') {
    if (owned >= CONFIG.GARRISONS_AT_START) return 'count';
    return null;
  }
  if (state.res[side].wb < CONFIG.ABILITY.garrison!.cost) return 'wb';
  if (state.cooldowns[side].garrison > 0) return 'cooldown';
  if (CONFIG.GARRISON_REQUIRES_SUPPLY && !hasSupplyNear(state, side, pos)) return 'supply';
  return null;
}

export function hasSupplyNear(state: GameState, side: Side, pos: Vec): boolean {
  for (const s of state.supplies) if (s.side === side && dist(s.pos, pos) <= CONFIG.SUPPLY_RADIUS) return true;
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
        // free setup placement; during play this is the 'garrison' ability (cost + cooldown + supply)
        if (state.phase === 'play') { buyAbility(state, cmd.side, 'garrison', cmd.pos); break; }
        if (garrisonPlacementError(state, cmd.side, cmd.pos)) break;
        createGarrison(state, cmd.side, cmd.pos);
        break;
      }
      case 'redeployGarrison': {
        if (state.phase === 'play') { buyAbility(state, cmd.side, 'redeploy', cmd.pos, undefined, cmd.garrisonId); break; }
        const g = state.garrisons[cmd.garrisonId];
        if (!g || g.side !== cmd.side || g.state !== 'active') break;
        if (garrisonPlacementError(state, cmd.side, cmd.pos, { forRedeploy: true })) break;
        g.pos = { x: cmd.pos.x, y: cmd.pos.y }; // instant while still in setup
        break;
      }
      case 'setupDone':
        state.setupDone[cmd.side] = true;
        break;
      case 'draft':
        if (state.phase === 'draft' && !state.drafted[cmd.side]) applyDraft(state, cmd.side, cmd.comp);
        break;
      case 'ability':
        buyAbility(state, cmd.side, cmd.ability, cmd.pos, cmd.pos2, cmd.garrisonId);
        break;
    }
  }
  state.pendingCommands.length = 0;
}
