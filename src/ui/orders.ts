// Orders panel (bible §8): right-side ability cards with cost + cooldown sweep,
// hotkeys 1–6, and the placement/targeting modes they start.
import { CONFIG } from '../config';
import { ABILITIES, type AbilityKind, type GameState } from '../state';
import { abilityError } from '../systems/abilities';
import type { UiState } from './input';
import type { Vec } from '../vec';

const C = CONFIG.COLORS;
export const PANEL_W = 150, CARD_W = 138, CARD_H = 48, CARD_GAP = 5, PANEL_X = CONFIG.LOGICAL_W - PANEL_W, PANEL_Y = 46;

export const ABILITY_INFO: Record<AbilityKind, { name: string; hint: string; mode: 'circle' | 'line' | 'point' | 'garrison' | 'pickGarrison' }> = {
  recon: { name: 'RECON FLIGHT', hint: 'reveal r200 · 30s', mode: 'circle' },
  strafe: { name: 'STRAFING RUN', hint: 'line · open inf', mode: 'line' },
  barrage: { name: 'ARTY BARRAGE', hint: 'area · 10s shells', mode: 'circle' },
  supply: { name: 'SUPPLY DROP', hint: 'lands instantly · lasts 2:00', mode: 'point' },
  garrison: { name: 'NEW GARRISON', hint: 'on supplied ground', mode: 'garrison' },
  redeploy: { name: 'REDEPLOY', hint: 'pack 30s · move', mode: 'pickGarrison' },
  wire: { name: 'BARBED WIRE', hint: 'line · slows infantry', mode: 'line' },
  trench: { name: 'TRENCH', hint: 'line · cover for dots in it', mode: 'line' },
  bunker: { name: 'BUNKER', hint: 'strong cover · 400hp', mode: 'point' },
};

export function cardRect(i: number): { x: number; y: number; w: number; h: number } {
  return { x: PANEL_X + (PANEL_W - CARD_W) / 2, y: PANEL_Y + i * (CARD_H + CARD_GAP), w: CARD_W, h: CARD_H };
}

/** Which card (if any) is under a logical-space point. */
export function orderCardAt(p: Vec): AbilityKind | null {
  for (let i = 0; i < ABILITIES.length; i++) {
    const r = cardRect(i);
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return ABILITIES[i]!;
  }
  return null;
}

export function startAbilityMode(ui: UiState, ability: AbilityKind): void {
  const info = ABILITY_INFO[ability];
  if (info.mode === 'pickGarrison') ui.mode = { kind: 'pickGarrison' };
  else if (info.mode === 'garrison') ui.mode = { kind: 'placeGarrison' };
  else ui.mode = { kind: 'ability', ability, stage: 0, first: null };
}

function fmtCd(s: number): string { return s >= 60 ? `${Math.floor(s / 60)}:${String(Math.ceil(s % 60)).padStart(2, '0')}` : `${Math.ceil(s)}s`; }

export function drawOrders(ctx: CanvasRenderingContext2D, state: GameState, ui: UiState): void {
  if (state.phase === 'draft') return;
  ctx.save();
  ctx.fillStyle = C.hudBg; ctx.fillRect(PANEL_X, PANEL_Y - 14, PANEL_W, ABILITIES.length * (CARD_H + CARD_GAP) + 18);
  ctx.fillStyle = C.hudDim; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('ORDERS', PANEL_X + 8, PANEL_Y - 6);
  const me = ui.player;
  for (let i = 0; i < ABILITIES.length; i++) {
    const ab = ABILITIES[i]!;
    const def = CONFIG.ABILITY[ab]!;
    const info = ABILITY_INFO[ab];
    const r = cardRect(i);
    const cd = state.cooldowns[me][ab];
    const afford = state.res[me][def.pool] >= def.cost;
    const err = abilityError(state, me, ab, { x: 0, y: 0 }, { x: 1, y: 1 }, undefined);
    const ready = cd <= 0 && afford && state.phase === 'play' && (err === null || err === 'target' || err === 'territory' || err === 'supply' || err === 'terrain' || err === 'point');
    const active = (ui.mode.kind === 'ability' && ui.mode.ability === ab) || (ab === 'garrison' && ui.mode.kind === 'placeGarrison') || (ab === 'redeploy' && (ui.mode.kind === 'pickGarrison' || ui.mode.kind === 'redeploy'));
    // card body
    ctx.fillStyle = C.cardBg; ctx.fillRect(r.x, r.y, r.w, r.h);
    if (cd > 0) {
      const frac = cd / def.cooldown;
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(r.x, r.y + r.h * (1 - frac), r.w, r.h * frac);
    }
    ctx.strokeStyle = active ? '#fff' : ready ? C.cardReady : C.cardEdge; ctx.lineWidth = active ? 2 : 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    // hotkey
    ctx.fillStyle = ready ? C.cardReady : C.cardCool; ctx.fillRect(r.x, r.y, 14, r.h);
    ctx.fillStyle = '#000'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.fillText(String(i + 1), r.x + 7, r.y + r.h / 2);
    // text
    ctx.textAlign = 'left';
    ctx.fillStyle = ready ? C.hudText : C.hudDim; ctx.font = 'bold 10px monospace'; ctx.fillText(info.name, r.x + 20, r.y + 12);
    ctx.fillStyle = afford ? '#f2d27a' : C.alarm; ctx.font = '9px monospace'; ctx.fillText(`${def.cost} ${def.pool.toUpperCase()}`, r.x + 20, r.y + 26);
    ctx.fillStyle = C.hudDim; ctx.fillText(cd > 0 ? `cooldown ${fmtCd(cd)}` : info.hint, r.x + 20, r.y + 40);
    ctx.textAlign = 'right'; ctx.fillText(fmtCd(def.cooldown), r.x + r.w - 6, r.y + 26);
  }
  ctx.restore();
}
