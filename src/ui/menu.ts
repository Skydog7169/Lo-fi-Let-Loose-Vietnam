// Pause menu (Esc) and end-screen buttons: restart, new battle, mode, AI difficulty, sound.
// Clicks set ui.menuRequest; main.ts performs the action (it owns state creation).
import { CONFIG } from '../config';
import type { GameState } from '../state';
import { audioMuted } from '../audio';
import type { UiState } from './input';
import type { Vec } from '../vec';

const C = CONFIG.COLORS;

export type MenuRequest =
  | { kind: 'restart' } // same seed, same settings
  | { kind: 'new' } // fresh seed
  | { kind: 'mode'; mode: 'warfare' | 'offensive' }
  | { kind: 'ai'; level: 'easy' | 'normal' | 'hard' }
  | { kind: 'sound' };

interface Btn { id: string; label: string; w?: number }

const BTN_H = 34, BTN_GAP = 10, PANEL_W = 380;

function menuButtons(ui: UiState): Btn[] {
  return [
    { id: 'resume', label: 'RESUME' },
    { id: 'restart', label: 'RESTART BATTLE (same map)' },
    { id: 'new', label: 'NEW BATTLE (new seed)' },
    { id: 'mode', label: `MODE: ${CONFIG.GAME_MODE.toUpperCase()} — switch` },
    { id: 'ai', label: `ENEMY AI: ${ui.aiLevel.toUpperCase()} — cycle` },
    { id: 'sound', label: `SOUND: ${audioMuted() ? 'OFF' : 'ON'}` },
  ];
}

function endButtons(): Btn[] {
  return [
    { id: 'new', label: 'PLAY AGAIN (new battle)' },
    { id: 'restart', label: 'REMATCH (same map)' },
  ];
}

function rects(btns: Btn[], y0: number): { x: number; y: number; w: number; h: number }[] {
  const W = CONFIG.LOGICAL_W;
  return btns.map((_, i) => ({ x: W / 2 - PANEL_W / 2 + 30, y: y0 + i * (BTN_H + BTN_GAP), w: PANEL_W - 60, h: BTN_H }));
}

const MENU_Y0 = 250;
const END_Y0 = CONFIG.LOGICAL_H / 2 + 96;

/** Which button id (if any) is under a logical-space point. */
export function menuHit(state: GameState, ui: UiState, p: Vec): string | null {
  const active = ui.menuOpen ? menuButtons(ui) : state.phase === 'ended' ? endButtons() : null;
  if (!active) return null;
  const rs = rects(active, ui.menuOpen ? MENU_Y0 : END_Y0);
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i]!;
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return active[i]!.id;
  }
  return null;
}

export function applyMenuClick(ui: UiState, id: string): void {
  switch (id) {
    case 'resume': ui.menuOpen = false; break;
    case 'restart': ui.menuRequest = { kind: 'restart' }; break;
    case 'new': ui.menuRequest = { kind: 'new' }; break;
    case 'mode': ui.menuRequest = { kind: 'mode', mode: CONFIG.GAME_MODE === 'warfare' ? 'offensive' : 'warfare' }; break;
    case 'ai': {
      const order: ('easy' | 'normal' | 'hard')[] = ['easy', 'normal', 'hard'];
      ui.menuRequest = { kind: 'ai', level: order[(order.indexOf(ui.aiLevel) + 1) % 3]! };
      break;
    }
    case 'sound': ui.menuRequest = { kind: 'sound' }; break;
  }
}

function drawButtons(ctx: CanvasRenderingContext2D, btns: Btn[], y0: number, hover: Vec | null): void {
  const rs = rects(btns, y0);
  ctx.textBaseline = 'middle';
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i]!;
    const hot = !!hover && hover.x >= r.x && hover.x <= r.x + r.w && hover.y >= r.y && hover.y <= r.y + r.h;
    ctx.fillStyle = hot ? '#3c4438' : C.cardBg;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = hot ? '#fff' : C.cardEdge; ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.fillStyle = hot ? '#fff' : C.hudText; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
    ctx.fillText(btns[i]!.label, r.x + r.w / 2, r.y + r.h / 2);
  }
}

export function drawMenu(ctx: CanvasRenderingContext2D, state: GameState, ui: UiState): void {
  if (ui.menuOpen) {
    const W = CONFIG.LOGICAL_W, H = CONFIG.LOGICAL_H;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, H);
    const btns = menuButtons(ui);
    const ph = (btns.length * (BTN_H + BTN_GAP)) + 96;
    ctx.fillStyle = C.hudBg; ctx.fillRect(W / 2 - PANEL_W / 2, MENU_Y0 - 66, PANEL_W, ph);
    ctx.strokeStyle = C.cardEdge; ctx.strokeRect(W / 2 - PANEL_W / 2 + 0.5, MENU_Y0 - 65.5, PANEL_W - 1, ph - 1);
    ctx.fillStyle = C.hudText; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('PAUSED', W / 2, MENU_Y0 - 40);
    ctx.fillStyle = C.hudDim; ctx.font = '10px monospace';
    ctx.fillText('mode / AI changes apply to the next battle', W / 2, MENU_Y0 - 20);
    drawButtons(ctx, btns, MENU_Y0, ui.mouseLogical);
    ctx.restore();
  } else if (state.phase === 'ended') {
    ctx.save();
    drawButtons(ctx, endButtons(), END_Y0, ui.mouseLogical);
    ctx.restore();
  }
}
