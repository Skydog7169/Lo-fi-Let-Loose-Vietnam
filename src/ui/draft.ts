// Pre-match draft screen: spend the War Bond budget on a force within caps.
import { CONFIG } from '../config';
import type { GameState, SquadKind } from '../state';
import { DRAFT_KINDS, draftCost, draftError } from '../systems/draft';
import type { UiState } from './input';
import type { Vec } from '../vec';

const C = CONFIG.COLORS;
const NAMES: Record<SquadKind, string> = { infantry: 'Infantry Squad (6)', at: 'AT Infantry Squad (6)', recon: 'Recon Squad (4)', tank: 'Tank', artillery: 'Artillery Battery' };
const NOTES: Record<SquadKind, string> = {
  infantry: 'the baseline rifle squad',
  at: 'carries rockets — kills tanks and garrisons',
  recon: 'eyes: 220px vision, hard to spot, weak in a fight',
  tank: 'HE splash vs infantry · immune to small arms',
  artillery: 'shells a marked zone',
};

export interface DraftUi { comp: Record<SquadKind, number>; done: boolean }
export const defaultDraft = (): Record<SquadKind, number> => ({ infantry: 4, at: 1, recon: 0, tank: 1, artillery: 0 });

const PX = 290, PY = 150, PW = 620, ROW_H = 48, ROW0 = PY + 96, ROWS = 4;
function rowRect(i: number) { return { y: ROW0 + i * ROW_H }; }
const BTN = { minus: PX + 448, plus: PX + 520, w: 26, h: 26 };
const DEPLOY = { x: PX + PW - 164, y: PY + 96 + ROWS * ROW_H + 22, w: 140, h: 34 };
const COL_COST = PX + 420; // right edge of the cost column

export type DraftHit = { kind: 'inc'; unit: SquadKind } | { kind: 'dec'; unit: SquadKind } | { kind: 'deploy' } | null;

export function draftHit(p: Vec): DraftHit {
  for (let i = 0; i < DRAFT_KINDS.length; i++) {
    const { y } = rowRect(i);
    const cy = y + ROW_H / 2;
    if (p.y >= cy - BTN.h / 2 && p.y <= cy + BTN.h / 2) {
      if (p.x >= BTN.minus && p.x <= BTN.minus + BTN.w) return { kind: 'dec', unit: DRAFT_KINDS[i]! };
      if (p.x >= BTN.plus && p.x <= BTN.plus + BTN.w) return { kind: 'inc', unit: DRAFT_KINDS[i]! };
    }
  }
  if (p.x >= DEPLOY.x && p.x <= DEPLOY.x + DEPLOY.w && p.y >= DEPLOY.y && p.y <= DEPLOY.y + DEPLOY.h) return { kind: 'deploy' };
  return null;
}

export function drawDraft(ctx: CanvasRenderingContext2D, state: GameState, ui: UiState, d: DraftUi): void {
  const W = CONFIG.LOGICAL_W, H = CONFIG.LOGICAL_H;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H);
  const PH = (ROWS + 1) * ROW_H + 132;
  ctx.fillStyle = C.hudBg; ctx.fillRect(PX, PY, PW, PH);
  ctx.strokeStyle = C.cardEdge; ctx.strokeRect(PX + 0.5, PY + 0.5, PW - 1, PH - 1);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = C.hudText; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`DRAFT — ${ui.player} FORCE`, PX + 24, PY + 30);
  const cost = draftCost(d.comp), budget = CONFIG.DRAFT_BUDGET_WB;
  const err = draftError(d.comp, budget);
  ctx.font = '11px monospace'; ctx.fillStyle = C.hudDim;
  ctx.fillText(`Budget ${budget} WB · leftover carries in as starting WB`, PX + 24, PY + 56);
  ctx.fillText(`${CONFIG.SQUAD_SLOTS} squad slots · ${CONFIG.TANK_CAP} armour max · artillery = the Barrage order`, PX + 24, PY + 74);
  // header
  ctx.fillStyle = C.hudDim; ctx.font = 'bold 9px monospace';
  ctx.fillText('UNIT', PX + 24, ROW0 - 10);
  ctx.textAlign = 'right'; ctx.fillText('COST', COL_COST, ROW0 - 10);
  ctx.textAlign = 'center'; ctx.fillText('COUNT', BTN.minus + (BTN.plus + BTN.w - BTN.minus) / 2, ROW0 - 10);
  ctx.textAlign = 'left';
  for (let i = 0; i < DRAFT_KINDS.length; i++) {
    const k = DRAFT_KINDS[i]!;
    const { y } = rowRect(i);
    const cy = y + ROW_H / 2;
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.03)' : 'transparent'; ctx.fillRect(PX + 12, y, PW - 24, ROW_H);
    ctx.fillStyle = C.hudText; ctx.font = '12px monospace'; ctx.textAlign = 'left';
    ctx.fillText(NAMES[k], PX + 24, cy - 8);
    ctx.fillStyle = C.hudDim; ctx.font = '9px monospace'; ctx.fillText(NOTES[k], PX + 24, cy + 10);
    ctx.fillStyle = '#f2d27a'; ctx.font = '12px monospace'; ctx.textAlign = 'right'; ctx.fillText(`${CONFIG.UNIT_COST[k]} WB`, COL_COST, cy);
    ctx.textAlign = 'left';
    // buttons
    for (const [bx, label] of [[BTN.minus, '−'], [BTN.plus, '+']] as [number, string][]) {
      ctx.fillStyle = C.cardBg; ctx.fillRect(bx, cy - BTN.h / 2, BTN.w, BTN.h);
      ctx.strokeStyle = C.cardEdge; ctx.strokeRect(bx + 0.5, cy - BTN.h / 2 + 0.5, BTN.w - 1, BTN.h - 1);
      ctx.fillStyle = C.hudText; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center'; ctx.fillText(label, bx + BTN.w / 2, cy);
    }
    ctx.fillStyle = '#fff'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center'; ctx.fillText(String(d.comp[k]), (BTN.minus + BTN.w + BTN.plus) / 2, cy);
  }
  // totals
  const ty = ROW0 + ROWS * ROW_H + 18;
  ctx.fillStyle = C.hudText; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`Spent ${cost} / ${budget} WB   →   ${Math.max(0, budget - cost)} WB carried in`, PX + 24, ty);
  if (err) { ctx.fillStyle = C.alarm; ctx.font = '11px monospace'; ctx.fillText(err.toUpperCase(), PX + 24, ty + 20); }
  // deploy button
  const ok = !err;
  ctx.fillStyle = ok ? C.cardReady : C.cardCool; ctx.fillRect(DEPLOY.x, DEPLOY.y, DEPLOY.w, DEPLOY.h);
  ctx.fillStyle = '#000'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center'; ctx.fillText(d.done ? 'WAITING…' : 'DEPLOY', DEPLOY.x + DEPLOY.w / 2, DEPLOY.y + DEPLOY.h / 2);
  if (state.drafted.PAVN && !state.drafted.US) { ctx.fillStyle = C.hudDim; ctx.font = '10px monospace'; ctx.textAlign = 'right'; ctx.fillText('enemy commander is ready', DEPLOY.x - 12, DEPLOY.y + DEPLOY.h / 2); }
  ctx.restore();
}

export function applyDraftHit(d: DraftUi, hit: DraftHit): void {
  if (!hit || d.done) return;
  if (hit.kind === 'inc') d.comp[hit.unit]++;
  if (hit.kind === 'dec') d.comp[hit.unit] = Math.max(0, d.comp[hit.unit] - 1);
}
