// Pre-match draft (bible §3.2): spend DRAFT_BUDGET_WB on a force within caps;
// unspent WB carries into the match.
import { CONFIG } from '../config';
import { createSquad, hqCenter, type GameState, type Side, type SquadKind } from '../state';
import { v } from '../vec';

export const DRAFT_KINDS: SquadKind[] = ['infantry', 'at', 'recon', 'tank']; // artillery comes only as the Barrage order

export function draftCost(comp: Record<SquadKind, number>): number {
  let c = 0;
  for (const k of DRAFT_KINDS) c += (comp[k] ?? 0) * (CONFIG.UNIT_COST[k] ?? 0);
  return c;
}

/** Troops this composition puts on the field (6 per squad, 2 per recon team, 3 per tank crew). */
export function draftTroops(comp: Record<SquadKind, number>): number {
  let n = 0;
  for (const k of DRAFT_KINDS) n += (comp[k] ?? 0) * (CONFIG.PERSONNEL[k] ?? 0);
  return n;
}

export function draftError(comp: Record<SquadKind, number>, budget: number = CONFIG.DRAFT_BUDGET_WB): string | null {
  for (const k of DRAFT_KINDS) if ((comp[k] ?? 0) < 0 || !Number.isInteger(comp[k] ?? 0)) return 'bad count';
  if (draftTroops(comp) > CONFIG.ROSTER_CAP) return `over ${CONFIG.ROSTER_CAP} troops`;
  if ((comp.tank ?? 0) > CONFIG.TANK_CAP) return `max ${CONFIG.TANK_CAP} armour`;
  if ((comp.artillery ?? 0) > CONFIG.ARTILLERY_CAP) return `max ${CONFIG.ARTILLERY_CAP} battery`;
  if (draftCost(comp) > budget) return 'over budget';
  if ((comp.infantry ?? 0) + (comp.at ?? 0) + (comp.recon ?? 0) + (comp.tank ?? 0) === 0) return 'need at least one squad';
  return null;
}

/** Create the drafted squads at the side's HQ and bank the leftover WB. */
export function applyDraft(state: GameState, side: Side, comp: Record<SquadKind, number>): boolean {
  const budget = CONFIG.DRAFT_BUDGET_WB + (side === 'PAVN' ? CONFIG.AI_BONUS_WB : 0);
  if (draftError(comp, budget)) return false;
  const hq = state.map.hqs.find((h) => h.side === side)!.rect;
  const c = hqCenter(state, side);
  const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  let li = 0, row = 0;
  const slotPos = () => { const y = hq.y + 22 + row * 26; row++; return v(c.x, Math.min(hq.y + hq.h - 14, y)); };
  for (let i = 0; i < (comp.infantry ?? 0); i++) createSquad(state, side, 'infantry', labels[li++]!, slotPos());
  for (let i = 0; i < (comp.at ?? 0); i++) createSquad(state, side, 'at', labels[li++]!, slotPos());
  for (let i = 0; i < (comp.recon ?? 0); i++) createSquad(state, side, 'recon', labels[li++]!, slotPos());
  for (let i = 0; i < (comp.tank ?? 0); i++) createSquad(state, side, 'tank', `T${i + 1}`, v(c.x + (side === 'US' ? 28 : -28), c.y - 30 + i * 40));
  for (let i = 0; i < (comp.artillery ?? 0); i++) createSquad(state, side, 'artillery', 'G', v(c.x + (side === 'US' ? -30 : 30), hq.y + hq.h - 16));
  state.res[side].wb = budget - draftCost(comp) + CONFIG.START_WB_BONUS;
  state.drafted[side] = true;
  return true;
}
