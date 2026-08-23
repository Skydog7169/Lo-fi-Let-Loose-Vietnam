// Phase 1 HUD: a small debug strip. Top bar / capture strip / resources come in Phase 3.
import { CONFIG } from '../config';
import type { GameState } from '../state';
import type { UiState } from './input';

export function drawHud(ctx: CanvasRenderingContext2D, state: GameState, ui: UiState, fps: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, CONFIG.LOGICAL_H - 22, CONFIG.LOGICAL_W, 22);
  ctx.fillStyle = '#ddd';
  ctx.font = '11px monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const t = state.time;
  const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
  ctx.fillText(
    `TACMAP  ${mm}:${String(ss).padStart(2, '0')}  tick ${state.tick}  fps ${fps.toFixed(0)}  zoom ${ui.cam.zoom.toFixed(2)}`,
    8, CONFIG.LOGICAL_H - 11,
  );
  ctx.textAlign = 'right';
  ctx.fillText('drag flag: attack   right-drag flag: defend   drag map: pan   wheel: zoom   P: paths   R: reset cam', CONFIG.LOGICAL_W - 8, CONFIG.LOGICAL_H - 11);
  ctx.restore();
}
