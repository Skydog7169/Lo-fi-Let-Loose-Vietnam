// HUD: top bar = timer, capture strip (lock chain), resource readouts with /min;
// bottom strip = controls + debug squad states; overlays for setup and end.
import { CONFIG } from '../config';
import { territoryEdgeX, type GameState, type Side } from '../state';
import { incomePerMinute } from '../systems/economy';
import { fmtTime } from '../systems/match';
import { dotsOnActivePoint } from '../systems/capture';
import { ownedGarrisons } from '../systems/spawning';
import { ABILITY_INFO } from './orders';
import type { UiState } from './input';
import { sideColor } from '../render/draw';

const C = CONFIG.COLORS;
export const TOP_BAR_H = 40;

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string = C.hudText, font: string = '12px monospace', align: CanvasTextAlign = 'left'): void {
  ctx.fillStyle = color; ctx.font = font; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

function drawTopBar(ctx: CanvasRenderingContext2D, state: GameState, ui: UiState): void {
  const W = CONFIG.LOGICAL_W;
  ctx.fillStyle = C.hudBg; ctx.fillRect(0, 0, W, TOP_BAR_H);
  const me = ui.player;

  // timer (centre)
  const timerCol = state.timer < 60 ? C.alarm : C.hudText;
  text(ctx, fmtTime(state.timer), W / 2, 14, timerCol, 'bold 18px monospace', 'center');
  text(ctx, state.phase === 'setup' ? 'SETUP' : state.phase === 'ended' ? 'ENDED' : state.mode.toUpperCase(), W / 2, 31, C.hudDim, '9px monospace', 'center');

  // capture strip: 5 boxes left of centre
  const bw = 34, bh = 22, gap = 4;
  const x0 = W / 2 - 90 - (bw + gap) * state.points.length;
  for (let i = 0; i < state.points.length; i++) {
    const ps = state.points[i]!;
    const x = x0 + i * (bw + gap), y = 9;
    ctx.fillStyle = ps.owner === 'US' ? C.us : ps.owner === 'PAVN' ? C.pavn : '#6b6b62'; // gray = neutral
    ctx.globalAlpha = i === state.active ? 1 : 0.55; ctx.fillRect(x, y, bw, bh); ctx.globalAlpha = 1;
    if (i === state.active) {
      // signed progress fill: US capture grows from the left in blue, PAVN from the right in red
      if (ps.progress > 0) { ctx.fillStyle = C.us; ctx.fillRect(x, y, bw * ps.progress, bh); }
      else if (ps.progress < 0) { const w2 = bw * -ps.progress; ctx.fillStyle = C.pavn; ctx.fillRect(x + bw - w2, y, w2, bh); }
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x - 1, y - 1, bw + 2, bh + 2);
    } else {
      // lock glyph for points behind the front / not yet reachable
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
      ctx.strokeRect(x + bw - 9, y + 4, 5, 5); ctx.beginPath(); ctx.arc(x + bw - 6.5, y + 4, 2, Math.PI, 0); ctx.stroke();
    }
    text(ctx, String(ps.id), x + 6, y + bh / 2, '#fff', 'bold 12px monospace');
    // chain link
    if (i < state.points.length - 1) { ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.moveTo(x + bw, y + bh / 2); ctx.lineTo(x + bw + gap, y + bh / 2); ctx.stroke(); }
  }
  if (state.active >= 0 && state.active < state.points.length) {
    const us = dotsOnActivePoint(state, 'US'), pv = dotsOnActivePoint(state, 'PAVN');
    let line = `${state.map.points[state.active]!.name}  ${us}v${pv}`;
    if (state.mode === 'warfare' && state.contestClearT > 5) {
      line += `   attack repelled — front resets in ${Math.ceil(CONFIG.FRONT_RESET_SECONDS - state.contestClearT)}s`;
    }
    text(ctx, line, x0, 36, state.contestClearT > 5 ? '#f2d27a' : C.hudDim, '9px monospace');
  }

  // resources, right side
  const r = state.res[me], inc = incomePerMinute(state, me);
  const cols: [string, number, number, string][] = [
    ['WB', r.wb, inc.wb, '#f2d27a'], ['MUN', r.mun, inc.mun, '#f08a5d'], ['MAN', r.man, inc.man, '#8fd18f'], ['FUEL', r.fuel, inc.fuel, '#7ec8e3'],
  ];
  let x = W - 12;
  for (let i = cols.length - 1; i >= 0; i--) {
    const [name, val, per, col] = cols[i]!;
    text(ctx, `${Math.floor(val)}`, x, 14, col, 'bold 14px monospace', 'right');
    text(ctx, `${name} +${per}/min`, x, 30, C.hudDim, '9px monospace', 'right');
    x -= 92;
  }
  // spawn status, left
  const gar = ownedGarrisons(state, me);
  text(ctx, `${me}  garrisons ${gar.length}${gar.some((g) => g.disabled) ? ' ⚠' : ''}   wave ${Math.ceil(state.waveTimer[me])}s`, 12, 14, sideColor(me), 'bold 12px monospace');
  const ops = state.squads.filter((s) => s.side === me && s.op).length;
  text(ctx, `OPs ${ops}   sector x=${Math.round(state.active >= state.points.length ? W : 0) || ''}${Math.round(sectorX(state))}`, 12, 30, C.hudDim, '9px monospace');
}

function sectorX(state: GameState): number {
  return territoryEdgeX(state, 'US');
}

function drawBottom(ctx: CanvasRenderingContext2D, state: GameState, ui: UiState, fps: number): void {
  const W = CONFIG.LOGICAL_W, H = CONFIG.LOGICAL_H;
  ctx.fillStyle = C.hudBg; ctx.fillRect(0, H - 22, W, 22);
  const modeTxt = ui.mode.kind === 'placeGarrison' ? '  [PLACING GARRISON — click to place · right-click cancels]'
    : ui.mode.kind === 'redeploy' ? '  [REDEPLOY — click new spot · right-click cancels]'
    : ui.mode.kind === 'pickGarrison' ? '  [REDEPLOY — click one of your garrisons]'
    : ui.mode.kind === 'ability' ? `  [${ABILITY_INFO[ui.mode.ability].name}${ABILITY_INFO[ui.mode.ability].mode === 'line' ? ui.mode.stage === 0 ? ' — click start point' : ' — click end point' : ' — click target'} · right-click cancels]`
    : '';
  text(ctx, `tick ${state.tick}  fps ${fps.toFixed(0)}  zoom ${ui.cam.zoom.toFixed(2)}${ui.revealAll ? '  [REVEAL ALL]' : ''}${modeTxt}`, 8, H - 11, modeTxt ? '#f2d27a' : C.hudDim, '10px monospace');
  // the controls reference yields to an active mode hint — the two lines share the bar
  if (!modeTxt) text(ctx, 'drag squad/flag: attack · right-drag: defend · drag garrison: move · orange = flank fire · 1–9: orders · G: garrison · M: sound', W - 8, H - 11, C.hudDim, '10px monospace', 'right');

}

function drawToast(ctx: CanvasRenderingContext2D, ui: UiState): void {
  if (!ui.toast) return;
  const W = CONFIG.LOGICAL_W, H = CONFIG.LOGICAL_H;
  const a = Math.min(1, ui.toast.t / 0.4);
  ctx.globalAlpha = a;
  ctx.font = 'bold 12px monospace';
  const tw = ctx.measureText(ui.toast.text).width + 28;
  ctx.fillStyle = C.hudBg; ctx.fillRect(W / 2 - tw / 2, H - 96, tw, 26);
  ctx.strokeStyle = '#f2d27a'; ctx.lineWidth = 1; ctx.strokeRect(W / 2 - tw / 2 + 0.5, H - 95.5, tw - 1, 25);
  text(ctx, ui.toast.text, W / 2, H - 83, '#f2d27a', 'bold 12px monospace', 'center');
  ctx.globalAlpha = 1;
}

function drawOverlay(ctx: CanvasRenderingContext2D, state: GameState, ui: UiState): void {
  const W = CONFIG.LOGICAL_W;
  if (state.phase === 'setup') {
    const placed = ownedGarrisons(state, ui.player).length;
    ctx.fillStyle = C.hudBg; ctx.fillRect(W / 2 - 260, TOP_BAR_H + 8, 520, 44);
    text(ctx, `SETUP  ${fmtTime(state.setupTimer)} — place ${CONFIG.GARRISONS_AT_START} garrisons in your territory (${placed}/${CONFIG.GARRISONS_AT_START})`, W / 2, TOP_BAR_H + 22, C.hudText, 'bold 13px monospace', 'center');
    text(ctx, ui.mode.kind === 'placeGarrison' ? 'click to place · ≥100px from points · right-click cancels' : 'press G to place · drag a placed garrison to move it · Enter when ready', W / 2, TOP_BAR_H + 40, C.hudDim, '10px monospace', 'center');
  } else if (state.phase === 'ended' && state.result) {
    const H = CONFIG.LOGICAL_H;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.hudBg; ctx.fillRect(W / 2 - 240, H / 2 - 90, 480, 180);
    const w = state.result.winner;
    const headline = w === null ? 'DRAW' : `${w} ${w === ui.player ? 'VICTORY' : 'WINS'}`;
    text(ctx, headline, W / 2, H / 2 - 60, w === null ? C.hudText : sideColor(w), 'bold 26px monospace', 'center');
    text(ctx, state.result.reason.toUpperCase(), W / 2, H / 2 - 32, C.hudText, '12px monospace', 'center');
    const sides: Side[] = ['US', 'PAVN'];
    let y = H / 2 - 4;
    text(ctx, 'side    points·min  casualties  garrisons lost', W / 2, y, C.hudDim, '11px monospace', 'center'); y += 18;
    for (const s of sides) {
      const st = state.stats[s];
      text(ctx, `${s.padEnd(6)}  ${(st.pointHeldTime / 60).toFixed(1).padStart(9)}  ${String(st.casualties).padStart(10)}  ${String(st.garrisonsLost).padStart(14)}`, W / 2, y, sideColor(s), '11px monospace', 'center');
      y += 18;
    }
    // what killed people (both sides pooled): small-arms 210 · tank HE 80 · napalm 12 …
    const pool: Record<string, number> = {};
    for (const s2 of sides) for (const [k, n] of Object.entries(state.stats[s2].deathsBy)) pool[k] = (pool[k] ?? 0) + n;
    const causes = Object.entries(pool).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k} ${n}`).join(' · ');
    if (causes) text(ctx, `killed by: ${causes}`, W / 2, H / 2 + 44, C.hudDim, '10px monospace', 'center');
    text(ctx, 'reload to play again', W / 2, H / 2 + 70, C.hudDim, '10px monospace', 'center');
  }
}

export function drawHud(ctx: CanvasRenderingContext2D, state: GameState, ui: UiState, fps: number): void {
  ctx.save();
  drawTopBar(ctx, state, ui);
  drawBottom(ctx, state, ui, fps);
  drawOverlay(ctx, state, ui);
  drawToast(ctx, ui);
  ctx.restore();
}
