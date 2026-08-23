// Squad roster chips along the bottom: label, kind, alive pips, spawn status,
// state colour. Click a chip to centre the camera on the squad.
import { CONFIG } from '../config';
import type { GameState, Squad } from '../state';
import { spawnPointFor } from '../systems/spawning';
import { squadCentroid } from '../state';
import type { UiState } from './input';
import { sideColor } from '../render/draw';
import { clamp, type Vec } from '../vec';

const C = CONFIG.COLORS;
export const CHIP_W = 112, CHIP_H = 30, CHIP_GAP = 6, CHIP_Y = CONFIG.LOGICAL_H - 22 - CHIP_H - 6, CHIP_X0 = 8;

const KIND_SHORT: Record<string, string> = { infantry: 'INF', at: 'AT', recon: 'RCN', tank: 'TNK', artillery: 'ARTY' };
const STATE_COL: Record<string, string> = { IDLE: '#9a968c', MOVING: '#cfd6dd', ENGAGING: '#ffb347', SUPPRESSED: '#ffd23c', FALLBACK: '#ff5c4c' };

export function ownSquads(state: GameState, ui: UiState): Squad[] { return state.squads.filter((s) => s.side === ui.player); }

export function chipAt(state: GameState, ui: UiState, p: Vec): Squad | null {
  const sqs = ownSquads(state, ui);
  for (let i = 0; i < sqs.length; i++) {
    const x = CHIP_X0 + i * (CHIP_W + CHIP_GAP);
    if (p.x >= x && p.x <= x + CHIP_W && p.y >= CHIP_Y && p.y <= CHIP_Y + CHIP_H) return sqs[i]!;
  }
  return null;
}

export function focusSquad(state: GameState, ui: UiState, sq: Squad): void {
  const c = squadCentroid(state, sq) ?? sq.marker?.pos;
  if (!c) return;
  const z = Math.max(ui.cam.zoom, 2);
  ui.cam.zoom = z;
  ui.cam.x = clamp(c.x - CONFIG.LOGICAL_W / z / 2, 0, CONFIG.LOGICAL_W - CONFIG.LOGICAL_W / z);
  ui.cam.y = clamp(c.y - CONFIG.LOGICAL_H / z / 2, 0, CONFIG.LOGICAL_H - CONFIG.LOGICAL_H / z);
}

export function drawRoster(ctx: CanvasRenderingContext2D, state: GameState, ui: UiState): void {
  if (state.phase === 'draft') return;
  const sqs = ownSquads(state, ui);
  ctx.save();
  ctx.textBaseline = 'middle';
  for (let i = 0; i < sqs.length; i++) {
    const sq = sqs[i]!;
    const x = CHIP_X0 + i * (CHIP_W + CHIP_GAP), y = CHIP_Y;
    const alive = sq.dotIds.filter((id) => state.dots[id]!.alive).length;
    const total = sq.dotIds.length;
    const sp = spawnPointFor(state, sq);
    const hover = ui.hoverSquadId === sq.id;
    ctx.fillStyle = C.cardBg; ctx.fillRect(x, y, CHIP_W, CHIP_H);
    ctx.strokeStyle = hover ? '#fff' : C.cardEdge; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, CHIP_W - 1, CHIP_H - 1);
    // side bar + label
    ctx.fillStyle = sideColor(sq.side); ctx.fillRect(x, y, 4, CHIP_H);
    ctx.fillStyle = C.hudText; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'left';
    ctx.fillText(`${sq.label} ${KIND_SHORT[sq.kind] ?? sq.kind}`, x + 9, y + 9);
    // state
    ctx.fillStyle = STATE_COL[sq.state] ?? C.hudDim; ctx.font = '8px monospace'; ctx.textAlign = 'right';
    ctx.fillText(sq.state, x + CHIP_W - 5, y + 9);
    // alive pips
    if (sq.kind === 'tank' || sq.kind === 'artillery') {
      const d = state.dots[sq.dotIds[0]!]!;
      const frac = d.alive ? d.hp / d.maxHp : 0;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x + 9, y + 18, 60, 4);
      ctx.fillStyle = d.alive ? (frac > 0.5 ? '#7dd87d' : '#ffd23c') : C.alarm; ctx.fillRect(x + 9, y + 18, 60 * frac, 4);
    } else {
      for (let k = 0; k < total; k++) {
        ctx.fillStyle = k < alive ? sideColor(sq.side) : 'rgba(255,255,255,0.15)';
        ctx.fillRect(x + 9 + k * 8, y + 17, 6, 6);
      }
    }
    // spawn status
    ctx.fillStyle = sp.kind === 'op' ? '#8fd18f' : sp.kind === 'garrison' ? '#f2d27a' : C.hudDim; ctx.font = '8px monospace'; ctx.textAlign = 'right';
    ctx.fillText(sq.kind === 'artillery' ? `${state.dots[sq.dotIds[0]!]!.shells} sh` : sq.kind === 'tank' ? (state.tankRespawnUsed[sq.id] ? 'no resp' : `${alive ? '' : 'resp '}${CONFIG.TANK_RESPAWN_FUEL}F`) : `@${sp.kind.toUpperCase()}`, x + CHIP_W - 5, y + 21);
  }
  ctx.restore();
}
