// Everything is canvas primitives: flat terrain colours, dots, lines, glyphs.
// The static map layer is rendered once to an offscreen canvas at 2× and blitted.
import { CONFIG } from '../config';
import type { MapData, Shape } from '../map/an_cuong';
import type { GameState, Side, Squad } from '../state';
import type { UiState } from '../ui/input';
import { fromAngle, type Vec } from '../vec';

const C = CONFIG.COLORS;
const STATIC_SCALE = 2;

export const sideColor = (s: Side): string => (s === 'US' ? C.us : C.pavn);
export const sideDim = (s: Side): string => (s === 'US' ? C.usDim : C.pavnDim);

function traceShape(ctx: CanvasRenderingContext2D, s: Shape): void {
  ctx.beginPath();
  switch (s.kind) {
    case 'rect': ctx.rect(s.x, s.y, s.w, s.h); break;
    case 'circle': ctx.arc(s.c.x, s.c.y, s.r, 0, Math.PI * 2); break;
    case 'poly':
      s.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      break;
    case 'stroke':
      s.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      break;
  }
}

export function buildStaticLayer(map: MapData): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = map.width * STATIC_SCALE;
  cv.height = map.height * STATIC_SCALE;
  const ctx = cv.getContext('2d')!;
  ctx.scale(STATIC_SCALE, STATIC_SCALE);

  // base
  ctx.fillStyle = C.open;
  ctx.fillRect(0, 0, map.width, map.height);

  // faint paddy texture: horizontal hairlines on open ground
  ctx.strokeStyle = 'rgba(0,0,0,0.05)';
  ctx.lineWidth = 1;
  for (let y = 6; y < map.height; y += 12) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(map.width, y); ctx.stroke(); }

  for (const r of map.regions) {
    const s = r.shape;
    traceShape(ctx, s);
    switch (r.terrain) {
      case 'woods': ctx.fillStyle = C.woods; ctx.fill(); break;
      case 'village':
        ctx.fillStyle = C.village; ctx.fill();
        ctx.strokeStyle = C.villageEdge; ctx.lineWidth = 1.5; ctx.stroke();
        break;
      case 'river': ctx.fillStyle = C.river; ctx.fill(); break;
      case 'road':
        if (s.kind === 'stroke') { ctx.strokeStyle = C.road; ctx.lineWidth = s.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); }
        break;
      case 'bridge':
        ctx.fillStyle = C.bridge; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
        break;
      case 'ford':
        ctx.fillStyle = C.ford; ctx.fill();
        if (s.kind === 'rect') {
          ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
          for (let y = s.y + 6; y < s.y + s.h; y += 8) { ctx.beginPath(); ctx.moveTo(s.x, y); ctx.lineTo(s.x + s.w, y); ctx.stroke(); }
          ctx.setLineDash([]);
        }
        break;
      case 'hq':
      case 'open':
        break;
    }
  }
  // woods texture: sparse darker stipple
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (const r of map.regions) {
    if (r.terrain !== 'woods') continue;
    const s = r.shape;
    if (s.kind !== 'poly') continue;
    const xs = s.pts.map((p) => p.x), ys = s.pts.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const count = ((x1 - x0) * (y1 - y0)) / 220;
    ctx.save(); traceShape(ctx, s); ctx.clip();
    for (let i = 0; i < count; i++) {
      const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0);
      ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // HQ zones: hatched in side colour
  for (const hq of map.hqs) {
    const { x, y, w, h } = hq.rect;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.strokeStyle = sideDim(hq.side); ctx.lineWidth = 3;
    for (let k = -h; k < w + h; k += 12) { ctx.beginPath(); ctx.moveTo(x + k, y); ctx.lineTo(x + k - h, y + h); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = sideColor(hq.side); ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.fillStyle = sideColor(hq.side); ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('HQ', x + w / 2, y + 12);
  }

  // grid overlay A–J × 1–8
  const cw = map.width / CONFIG.GRID_COLS, ch = map.height / CONFIG.GRID_ROWS;
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  for (let c = 1; c < CONFIG.GRID_COLS; c++) { ctx.beginPath(); ctx.moveTo(c * cw, 0); ctx.lineTo(c * cw, map.height); ctx.stroke(); }
  for (let r = 1; r < CONFIG.GRID_ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * ch); ctx.lineTo(map.width, r * ch); ctx.stroke(); }
  ctx.fillStyle = C.gridLabel; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let c = 0; c < CONFIG.GRID_COLS; c++) ctx.fillText(String.fromCharCode(65 + c), c * cw + cw / 2, 3);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (let r = 0; r < CONFIG.GRID_ROWS; r++) ctx.fillText(String(r + 1), 4, r * ch + ch / 2);

  // capture points
  for (const p of map.points) {
    ctx.beginPath(); ctx.arc(p.pos.x, p.pos.y, CONFIG.POINT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
    ctx.strokeStyle = C.pointRing; ctx.lineWidth = 2.5; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.pointRing; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(p.id), p.pos.x, p.pos.y);
    ctx.font = 'bold 9px monospace'; ctx.fillText(p.name, p.pos.x, p.pos.y + 14);
  }
  return cv;
}

// ---------- dynamic layer ----------

function drawChevronFlag(ctx: CanvasRenderingContext2D, pos: Vec, color: string, filled: boolean, label: string, zoom: number): void {
  const s = 1 / Math.sqrt(zoom); // flags shrink slightly as you zoom in
  const h = 18 * s, w = 12 * s;
  ctx.save();
  ctx.translate(pos.x, pos.y);
  // pole
  ctx.strokeStyle = color; ctx.lineWidth = 2 * s;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -h); ctx.stroke();
  // chevron pennant
  ctx.beginPath();
  ctx.moveTo(0, -h); ctx.lineTo(w, -h + 4 * s); ctx.lineTo(0, -h + 9 * s); ctx.closePath();
  if (filled) { ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 * s; ctx.stroke(); }
  else { ctx.strokeStyle = color; ctx.lineWidth = 2 * s; ctx.stroke(); }
  // base dot
  ctx.beginPath(); ctx.arc(0, 0, 2.5 * s, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  // squad label
  ctx.fillStyle = '#fff'; ctx.font = `bold ${9 * s}px monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(label, w + 3 * s, -h + 5 * s);
  ctx.restore();
}

function drawSquad(ctx: CanvasRenderingContext2D, state: GameState, sq: Squad): void {
  const col = sideColor(sq.side);
  for (let i = 0; i < sq.dotIds.length; i++) {
    const d = state.dots[sq.dotIds[i]!]!;
    if (!d.alive) continue;
    ctx.beginPath(); ctx.arc(d.pos.x, d.pos.y, CONFIG.DOT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill();
    if (d.slot === 0) { ctx.strokeStyle = C.leaderRing; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(d.pos.x, d.pos.y, CONFIG.DOT_RADIUS + 1.5, 0, Math.PI * 2); ctx.stroke(); }
    // tiny facing tick
    const f = fromAngle(d.facing, CONFIG.DOT_RADIUS + 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(d.pos.x, d.pos.y); ctx.lineTo(d.pos.x + f.x, d.pos.y + f.y); ctx.stroke();
  }
}

export function drawWorld(ctx: CanvasRenderingContext2D, staticLayer: HTMLCanvasElement, state: GameState, ui: UiState): void {
  const { cam } = ui;
  ctx.save();
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(staticLayer, 0, 0, state.map.width, state.map.height);

  // debug paths
  if (ui.showPaths) {
    ctx.strokeStyle = C.debugPath; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    for (const sq of state.squads) {
      if (!sq.path.length) continue;
      const lead = state.dots[sq.dotIds[0]!]!;
      ctx.beginPath(); ctx.moveTo(lead.pos.x, lead.pos.y);
      for (const p of sq.path) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // markers (defend = outlined, attack = solid)
  for (const sq of state.squads) {
    if (!sq.marker) continue;
    const dragging = ui.drag?.kind === 'marker' && ui.drag.squadId === sq.id;
    const hover = ui.hoverSquadId === sq.id;
    if (dragging) ctx.globalAlpha = 0.35;
    if (hover && !dragging) {
      ctx.beginPath(); ctx.arc(sq.marker.pos.x, sq.marker.pos.y, 10 / cam.zoom, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fill();
    }
    drawChevronFlag(ctx, sq.marker.pos, sideColor(sq.side), sq.marker.kind === 'attack', sq.label, cam.zoom);
    ctx.globalAlpha = 1;
  }
  // drag ghost
  if (ui.drag?.kind === 'marker') {
    const sq = state.squads[ui.drag.squadId]!;
    drawChevronFlag(ctx, ui.drag.pos, sideColor(sq.side), ui.drag.markerKind === 'attack', sq.label, cam.zoom);
    const lead = state.dots[sq.dotIds[0]!]!;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(lead.pos.x, lead.pos.y); ctx.lineTo(ui.drag.pos.x, ui.drag.pos.y); ctx.stroke(); ctx.setLineDash([]);
  }

  for (const sq of state.squads) drawSquad(ctx, state, sq);

  ctx.restore();
}
