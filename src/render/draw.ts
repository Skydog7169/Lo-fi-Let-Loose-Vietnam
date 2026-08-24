// Everything is canvas primitives: flat terrain colours, dots, lines, glyphs.
// The static map layer is rendered once to an offscreen canvas at 2× and blitted.
import { CONFIG } from '../config';
import { pointInShape, type MapData, type Shape } from '../map/an_cuong';
import { inOwnTerritory, territoryEdgeX, vetLevel, type Dot, type GameState, type Garrison, type Side, type Squad } from '../state';
import { concealsAt } from '../map/grid';
import { spawnLocked } from '../systems/spawning';
import { garrisonPlacementError } from '../commander';
import type { UiState } from '../ui/input';
import { dist, fromAngle, v, type Vec } from '../vec';

const C = CONFIG.COLORS;
const STATIC_SCALE = 2;

export const sideColor = (s: Side): string => (s === 'US' ? C.us : C.pavn);
export const sideDim = (s: Side | null): string => (s === 'US' ? C.usDim : s === 'PAVN' ? C.pavnDim : 'rgba(150,145,130,0.45)');

function shapeBounds(s2: Shape): { x0: number; y0: number; x1: number; y1: number } {
  if (s2.kind === 'rect') return { x0: s2.x, y0: s2.y, x1: s2.x + s2.w, y1: s2.y + s2.h };
  if (s2.kind === 'circle') return { x0: s2.c.x - s2.r, y0: s2.c.y - s2.r, x1: s2.c.x + s2.r, y1: s2.c.y + s2.r };
  const pts = s2.pts;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const pad = s2.kind === 'stroke' ? s2.width / 2 : 0;
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

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

  // paddy plots: an irregular field grid in shifting tones with faint dike lines
  let pseed = 11;
  const prnd = () => { pseed = (pseed * 1103515245 + 12345) & 0x7fffffff; return pseed / 0x7fffffff; };
  for (let y = 0; y < map.height; ) {
    const rh = 34 + prnd() * 44;
    for (let x = 0; x < map.width; ) {
      const rw = 52 + prnd() * 78;
      const t = prnd();
      if (t < 0.30) ctx.fillStyle = 'rgba(70,60,30,0.045)';
      else if (t < 0.55) ctx.fillStyle = 'rgba(255,250,220,0.05)';
      else ctx.fillStyle = 'transparent';
      if (ctx.fillStyle !== 'transparent') ctx.fillRect(x, y, rw, rh);
      x += rw;
    }
    // dike line between plot rows
    ctx.strokeStyle = 'rgba(90,75,45,0.10)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y + rh); ctx.lineTo(map.width, y + rh); ctx.stroke();
    y += rh;
  }

  for (const r of map.regions) {
    const s = r.shape;
    traceShape(ctx, s);
    switch (r.terrain) {
      case 'woods':
        ctx.fillStyle = C.woods; ctx.fill();
        ctx.strokeStyle = 'rgba(18,34,14,0.4)'; ctx.lineWidth = 2; ctx.stroke(); // treeline edge
        break;
      case 'village':
        if (s.kind === 'rect') { ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(s.x + 2.5, s.y + 3, s.w, s.h); } // drop shadow
        traceShape(ctx, s);
        ctx.fillStyle = C.village; ctx.fill();
        ctx.strokeStyle = C.villageEdge; ctx.lineWidth = 1.5; ctx.stroke();
        if (s.kind === 'rect') { // roof ridge
          ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1;
          ctx.beginPath();
          if (s.w >= s.h) { ctx.moveTo(s.x + 3, s.y + s.h / 2); ctx.lineTo(s.x + s.w - 3, s.y + s.h / 2); }
          else { ctx.moveTo(s.x + s.w / 2, s.y + 3); ctx.lineTo(s.x + s.w / 2, s.y + s.h - 3); }
          ctx.stroke();
        }
        break;
      case 'river':
        ctx.strokeStyle = '#cbbd90'; ctx.lineWidth = 7; ctx.lineJoin = 'round'; ctx.stroke(); // sandy banks
        ctx.fillStyle = C.river; ctx.fill();
        ctx.strokeStyle = 'rgba(15,35,65,0.35)'; ctx.lineWidth = 1.5; ctx.stroke(); // waterline
        break;
      case 'road':
        if (s.kind === 'stroke') {
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.strokeStyle = 'rgba(60,48,25,0.22)'; ctx.lineWidth = s.width + 2.5; ctx.stroke(); // graded shoulder
          ctx.strokeStyle = C.road; ctx.lineWidth = s.width; ctx.stroke();
        }
        break;
      case 'trail':
        if (s.kind === 'stroke') {
          ctx.strokeStyle = C.trail; ctx.lineWidth = s.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.setLineDash([s.width * 2.2, s.width * 1.1]); ctx.stroke(); ctx.setLineDash([]);
        }
        break;
      case 'grass': {
        ctx.fillStyle = C.grass; ctx.fill();
        break;
      }
      case 'marsh': {
        ctx.fillStyle = C.marsh; ctx.fill();
        break;
      }
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
  // grass texture: short vertical tufts; marsh: broken horizontal water dashes
  for (const r of map.regions) {
    if (r.terrain !== 'grass' && r.terrain !== 'marsh') continue;
    const b = shapeBounds(r.shape);
    if (r.terrain === 'grass') {
      ctx.save(); traceShape(ctx, r.shape); ctx.clip();
      ctx.fillStyle = 'rgba(210,215,140,0.12)'; // sun patches
      for (let i = 0; i < (b.x1 - b.x0) * (b.y1 - b.y0) / 3200; i++) {
        const x = b.x0 + ((i * 97) % (b.x1 - b.x0)), y = b.y0 + ((i * 53) % (b.y1 - b.y0));
        ctx.beginPath(); ctx.ellipse(x, y, 14, 8, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(60,70,30,0.35)'; ctx.lineWidth = 1;
      for (let y = b.y0 + 4; y < b.y1; y += 9) for (let x = b.x0 + 4 + (((y / 9) | 0) % 2) * 4; x < b.x1; x += 9) {
        if (!pointInShape({ x, y }, r.shape)) continue;
        ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x, y - 2); ctx.stroke();
      }
    } else {
      ctx.save(); traceShape(ctx, r.shape); ctx.clip();
      ctx.fillStyle = 'rgba(70,110,135,0.30)'; // standing water pools
      for (let i = 0; i < (b.x1 - b.x0) * (b.y1 - b.y0) / 2400; i++) {
        const x = b.x0 + ((i * 89) % (b.x1 - b.x0)), y = b.y0 + ((i * 61) % (b.y1 - b.y0));
        ctx.beginPath(); ctx.ellipse(x, y, 10 + (i % 3) * 4, 5 + (i % 2) * 2, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(60,100,130,0.4)'; ctx.lineWidth = 1;
      for (let y = b.y0 + 5; y < b.y1; y += 10) for (let x = b.x0 + 4; x < b.x1; x += 14) {
        if (!pointInShape({ x, y }, r.shape)) continue;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 7, y); ctx.stroke();
      }
    }
  }
  // woods canopy: clustered crown blobs, dark understorey + lit tops
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (const r of map.regions) {
    if (r.terrain !== 'woods') continue;
    const s = r.shape;
    if (s.kind !== 'poly') continue;
    const xs = s.pts.map((p) => p.x), ys = s.pts.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const count = ((x1 - x0) * (y1 - y0)) / 420;
    ctx.save(); traceShape(ctx, s); ctx.clip();
    for (let i = 0; i < count; i++) {
      const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0);
      const cr = 2.5 + rnd() * 5;
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      ctx.beginPath(); ctx.arc(x + 1, y + 1.5, cr, 0, Math.PI * 2); ctx.fill(); // crown shadow
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(96,140,80,0.35)' : 'rgba(70,110,60,0.35)';
      ctx.beginPath(); ctx.arc(x, y, cr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(150,190,110,0.18)';
      ctx.beginPath(); ctx.arc(x - cr * 0.3, y - cr * 0.35, cr * 0.5, 0, Math.PI * 2); ctx.fill(); // lit top
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
  // paper grain + a quiet edge vignette to pull it together
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * map.width, y = rnd() * map.height;
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)';
    ctx.fillRect(x, y, 1 + rnd(), 1 + rnd());
  }
  const vg = 60;
  const grads: [number, number, number, number][] = [[0, 0, 0, vg], [0, map.height, 0, map.height - vg], [0, 0, vg, 0], [map.width, 0, map.width - vg, 0]];
  for (const [gx0, gy0, gx1, gy1] of grads) {
    const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    g.addColorStop(0, 'rgba(30,25,10,0.14)'); g.addColorStop(1, 'rgba(30,25,10,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, map.width, map.height);
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

function drawSquad(ctx: CanvasRenderingContext2D, state: GameState, sq: Squad, ui: UiState): void {
  const col = sideColor(sq.side);
  // readable at any zoom: dots keep a minimum on-screen size
  const R = Math.max(CONFIG.DOT_RADIUS, CONFIG.DOT_MIN_SCREEN_PX / ui.cam.zoom);
  for (let i = 0; i < sq.dotIds.length; i++) {
    const d = state.dots[sq.dotIds[i]!]!;
    if (!d.alive || !visibleDot(state, ui, d)) continue;
    if (sq.kind === 'tank') { drawTank(ctx, d, col); continue; }
    if (sq.kind === 'artillery') { drawBattery(ctx, d, col); continue; }
    if (d.dugIn) { // entrenched: a small berm arc facing the dot's front
      ctx.strokeStyle = 'rgba(60,40,20,0.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(d.pos.x, d.pos.y, R + 3, d.facing - 1.1, d.facing + 1.1); ctx.stroke();
    }
    if (ui.hoverSquadId === sq.id) { // grabbable: halo on hovered squad
      ctx.beginPath(); ctx.arc(d.pos.x, d.pos.y, R + 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(d.pos.x, d.pos.y, R, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill();
    if (d.slot === 0) {
      ctx.strokeStyle = C.leaderRing; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(d.pos.x, d.pos.y, R + 1.5, 0, Math.PI * 2); ctx.stroke();
      const vl = vetLevel(sq);
      if (vl > 0) { ctx.fillStyle = '#f2d27a'; ctx.font = `${6 + vl}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(vl === 2 ? '★★' : '★', d.pos.x, d.pos.y - R - 3); }
    }
    // tiny facing tick
    const f = fromAngle(d.facing, R + 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(d.pos.x, d.pos.y); ctx.lineTo(d.pos.x + f.x, d.pos.y + f.y); ctx.stroke();
    // "pinned" chevrons above suppressed dots
    if (d.suppression > 0.5) {
      ctx.strokeStyle = C.suppressed; ctx.lineWidth = 1.2;
      const y0 = d.pos.y - R - 3;
      for (let k = 0; k < (d.suppression > 0.85 ? 2 : 1); k++) {
        const y = y0 - k * 3;
        ctx.beginPath(); ctx.moveTo(d.pos.x - 3, y); ctx.lineTo(d.pos.x, y - 2.5); ctx.lineTo(d.pos.x + 3, y); ctx.stroke();
      }
    }
  }
}

function drawTank(ctx: CanvasRenderingContext2D, d: Dot, col: string): void {
  ctx.save();
  ctx.translate(d.pos.x, d.pos.y);
  ctx.rotate(d.facing);
  ctx.fillStyle = col; ctx.fillRect(-7, -5, 14, 10);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(-7, -5, 14, 10);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(11, 0); ctx.lineWidth = 2; ctx.stroke(); // gun
  ctx.restore();
  // hp bar
  const w = 16, frac = Math.max(0, d.hp / d.maxHp);
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(d.pos.x - w / 2, d.pos.y - 10, w, 2.5);
  ctx.fillStyle = frac > 0.5 ? '#7dd87d' : frac > 0.25 ? '#ffd23c' : '#ff5c4c'; ctx.fillRect(d.pos.x - w / 2, d.pos.y - 10, w * frac, 2.5);
}

function drawBattery(ctx: CanvasRenderingContext2D, d: Dot, col: string): void {
  ctx.save();
  ctx.translate(d.pos.x, d.pos.y);
  ctx.fillStyle = col; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(12 * Math.cos(-0.6), 12 * Math.sin(-0.6)); ctx.lineWidth = 2.5; ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(`${d.shells}`, d.pos.x, d.pos.y + 7);
}

function drawEffects(ctx: CanvasRenderingContext2D, state: GameState, ui: UiState): void {
  for (const e of state.effects) {
    const a = Math.max(0, e.ttl / e.max);
    // enemy muzzle flashes only show when the shooter is visible; their tracers always show (the 'contact!' tell)
    if (e.kind === 'flash' && e.side !== ui.player && !ui.revealAll) {
      let seen = false;
      for (const d of state.vis[ui.player].enemyDots) if (Math.abs(d.pos.x - e.pos.x) < 4 && Math.abs(d.pos.y - e.pos.y) < 4) { seen = true; break; }
      if (!seen) continue;
    }
    switch (e.kind) {
      case 'tracer':
        ctx.globalAlpha = a;
        // flanking fire (≥60° off the target's facing — ignores cover) is drawn hot orange, slightly heavier
        ctx.strokeStyle = e.flank ? C.tracerFlank : e.side === 'US' ? C.tracerUs : C.tracerPavn; ctx.lineWidth = e.flank ? 1.6 : 1;
        ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke();
        break;
      case 'rocket': {
        // smoke trail with a bright head that travels a→b
        const prog = 1 - e.ttl / e.max;
        const hx = e.a.x + (e.b.x - e.a.x) * Math.min(1, prog * 2.2);
        const hy = e.a.y + (e.b.y - e.a.y) * Math.min(1, prog * 2.2);
        ctx.globalAlpha = a * 0.55;
        ctx.strokeStyle = '#b8b4a8'; ctx.lineWidth = 2; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(hx, hy); ctx.stroke(); ctx.setLineDash([]);
        const L2 = Math.hypot(hx - e.a.x, hy - e.a.y);
        for (let k = 8; k < L2; k += 12) {
          const t01 = k / Math.max(1, L2);
          ctx.fillStyle = 'rgba(190,186,175,0.35)';
          ctx.beginPath(); ctx.arc(e.a.x + (hx - e.a.x) * t01, e.a.y + (hy - e.a.y) * t01 - (1 - t01) * 2, 1.6 + t01 * 1.6, 0, Math.PI * 2); ctx.fill();
        }
        if (prog < 0.5) { ctx.globalAlpha = a; ctx.fillStyle = '#ffd27a'; ctx.beginPath(); ctx.arc(hx, hy, 2, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalAlpha = 1;
        break;
      }
      case 'explosion': {
        const p01 = 1 - e.ttl / e.max;
        ctx.globalAlpha = a;
        const rr = e.r * (0.4 + p01 * 0.9);
        const grad = ctx.createRadialGradient(e.pos.x, e.pos.y, 1, e.pos.x, e.pos.y, rr);
        grad.addColorStop(0, 'rgba(255,240,180,0.95)');
        grad.addColorStop(0.4, 'rgba(255,140,50,0.85)');
        grad.addColorStop(0.8, 'rgba(120,60,20,0.5)');
        grad.addColorStop(1, 'rgba(40,30,20,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(e.pos.x, e.pos.y, rr, 0, Math.PI * 2); ctx.fill();
        // smoke ring
        ctx.strokeStyle = `rgba(60,55,50,${0.5 * a})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(e.pos.x, e.pos.y, rr * 1.15, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
      case 'wreck': {
        ctx.save(); ctx.translate(e.pos.x, e.pos.y); ctx.rotate(e.facing);
        ctx.globalAlpha = Math.min(1, e.ttl / 8); // fades out at the end
        ctx.fillStyle = '#26231f'; ctx.fillRect(-7, -5, 14, 10);
        ctx.strokeStyle = '#4a443c'; ctx.lineWidth = 1; ctx.strokeRect(-7 + 0.5, -5 + 0.5, 13, 9);
        // smoulder
        const sm = 0.25 + 0.15 * Math.sin(state.time * 3 + e.pos.x);
        ctx.fillStyle = `rgba(120,110,100,${sm})`;
        ctx.beginPath(); ctx.arc(0, -6 - (state.time * 4 % 6), 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore(); ctx.globalAlpha = 1;
        break;
      }
      case 'flash':
        ctx.globalAlpha = a;
        ctx.fillStyle = C.flash; ctx.beginPath(); ctx.arc(e.pos.x, e.pos.y, 2.2, 0, Math.PI * 2); ctx.fill();
        break;
      case 'shell': {
        // arc from gun to target: a dot that rises then falls
        const t = 1 - a;
        const x = e.from.x + (e.to.x - e.from.x) * t, y = e.from.y + (e.to.y - e.from.y) * t - Math.sin(t * Math.PI) * 40;
        ctx.globalAlpha = 1;
        ctx.fillStyle = C.shell; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
        // target zone ring grows faint as shell nears
        ctx.globalAlpha = 0.35 * a; ctx.strokeStyle = C.impact; ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.arc(e.to.x, e.to.y, 6, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        break;
      }
      case 'impact': {
        ctx.globalAlpha = a;
        ctx.fillStyle = C.impact; ctx.beginPath(); ctx.arc(e.pos.x, e.pos.y, e.r * (1 - a * 0.5), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = a * 0.8; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(e.pos.x, e.pos.y, e.r * (1.4 - a * 0.4), 0, Math.PI * 2); ctx.stroke();
        break;
      }
      case 'death':
        ctx.globalAlpha = a * 0.9;
        ctx.strokeStyle = sideColor(e.side); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(e.pos.x - 3, e.pos.y - 3); ctx.lineTo(e.pos.x + 3, e.pos.y + 3);
        ctx.moveTo(e.pos.x + 3, e.pos.y - 3); ctx.lineTo(e.pos.x - 3, e.pos.y + 3); ctx.stroke();
        break;
    }
  }
  ctx.globalAlpha = 1;
}

function visibleDot(state: GameState, ui: UiState, d: Dot): boolean {
  if (ui.revealAll || d.side === ui.player) return true;
  const vis = state.vis[ui.player].dotVisible;
  return vis.length > d.id && vis[d.id] === 1;
}

function drawGarrison(ctx: CanvasRenderingContext2D, g: Garrison, time: number, zoom: number, locked = false): void {
  const col = sideColor(g.side);
  const s = 1 / Math.sqrt(zoom);
  const w = 12 * s, h = 9 * s;
  ctx.save();
  ctx.translate(g.pos.x, g.pos.y);
  // alarm pulse ring when disabled / under attack
  if (g.disabled) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 10);
    ctx.strokeStyle = C.alarm; ctx.lineWidth = 2 * s; ctx.globalAlpha = 0.35 + 0.65 * pulse;
    ctx.beginPath(); ctx.arc(0, 0, CONFIG.GARRISON_DISABLE_R, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (g.state === 'packing') ctx.setLineDash([3 * s, 3 * s]);
  if (locked) ctx.globalAlpha *= 0.55;
  // house glyph: box + roof
  ctx.beginPath();
  ctx.moveTo(-w / 2, h / 2); ctx.lineTo(-w / 2, -h / 4); ctx.lineTo(0, -h); ctx.lineTo(w / 2, -h / 4); ctx.lineTo(w / 2, h / 2); ctx.closePath();
  ctx.fillStyle = g.state === 'packing' ? 'rgba(0,0,0,0.25)' : col; ctx.fill();
  ctx.strokeStyle = C.garrison; ctx.lineWidth = 1.5 * s; ctx.stroke();
  ctx.setLineDash([]);
  if (g.state === 'packing') {
    ctx.fillStyle = '#fff'; ctx.font = `bold ${8 * s}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(`${Math.ceil(g.packTimer)}s`, 0, h / 2 + 2 * s);
    if (g.packTarget) {
      ctx.restore(); ctx.save();
      ctx.strokeStyle = col; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(g.pos.x, g.pos.y); ctx.lineTo(g.packTarget.x, g.packTarget.y); ctx.stroke(); ctx.setLineDash([]);
    }
  } else if (g.disabled) {
    ctx.fillStyle = C.alarm; ctx.font = `bold ${8 * s}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(`${Math.max(0, CONFIG.GARRISON_DESTROY_SECONDS - g.threatTimer).toFixed(0)}`, 0, h / 2 + 2 * s);
  } else if (locked) {
    ctx.fillStyle = '#fff'; ctx.font = `${7 * s}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('LOCKED', 0, h / 2 + 2 * s);
  }
  ctx.restore();
}

function drawOp(ctx: CanvasRenderingContext2D, pos: Vec, side: Side, label: string, zoom: number): void {
  const s = 1 / Math.sqrt(zoom);
  const r = 6 * s;
  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.9, r * 0.6); ctx.lineTo(-r * 0.9, r * 0.6); ctx.closePath();
  ctx.fillStyle = sideColor(side); ctx.fill();
  ctx.strokeStyle = C.opGlyph; ctx.lineWidth = 1 * s; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = `bold ${7 * s}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(label, 0, r * 0.8);
  ctx.restore();
}

export function drawWorld(ctx: CanvasRenderingContext2D, staticLayer: HTMLCanvasElement, state: GameState, ui: UiState): void {
  const { cam } = ui;
  const me = ui.player;
  const vis = state.vis[me];
  ctx.save();
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(staticLayer, 0, 0, state.map.width, state.map.height);

  // territory: tint everything beyond our edge; draw both edges in warfare (no-man's-land between them)
  const lx = territoryEdgeX(state, me);
  ctx.fillStyle = C.fogEnemy;
  if (me === 'US') ctx.fillRect(lx, 0, state.map.width - lx, state.map.height); else ctx.fillRect(0, 0, lx, state.map.height);
  const edges = state.mode === 'warfare' ? [territoryEdgeX(state, 'US'), territoryEdgeX(state, 'PAVN')] : [lx];
  ctx.strokeStyle = C.sectorLine; ctx.lineWidth = 1.5; ctx.setLineDash([8, 6]);
  for (const ex of edges) { ctx.beginPath(); ctx.moveTo(ex, 0); ctx.lineTo(ex, state.map.height); ctx.stroke(); }
  ctx.setLineDash([]);

  // capture points: owner tint, active progress ring with pulse
  for (let i = 0; i < state.points.length; i++) {
    const ps = state.points[i]!, pm = state.map.points[i]!;
    ctx.beginPath(); ctx.arc(pm.pos.x, pm.pos.y, CONFIG.POINT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = sideDim(ps.owner); ctx.fill();
    if (i === state.active) {
      const pulse = 0.6 + 0.4 * Math.sin(state.time * 4);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5 * pulse; ctx.beginPath(); ctx.arc(pm.pos.x, pm.pos.y, CONFIG.POINT_RADIUS + 4, 0, Math.PI * 2); ctx.stroke();
      // spawn-lock ring: no garrison/OP spawns inside
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1; ctx.setLineDash([2, 6]);
      ctx.beginPath(); ctx.arc(pm.pos.x, pm.pos.y, CONFIG.ACTIVE_POINT_SPAWN_LOCK_R, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      if (ps.progress !== 0) {
        // signed progress: blue arc for a US capture in the making, red for PAVN
        ctx.strokeStyle = ps.progress > 0 ? C.us : C.pavn; ctx.lineWidth = 5; ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.arc(pm.pos.x, pm.pos.y, CONFIG.POINT_RADIUS + 4, -Math.PI / 2, -Math.PI / 2 + Math.abs(ps.progress) * Math.PI * 2); ctx.stroke();
      }
    } else {
      // locked (behind either front)
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(pm.pos.x - 5, pm.pos.y + 24); ctx.lineTo(pm.pos.x + 5, pm.pos.y + 24); ctx.stroke();
    }
  }

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

  // garrisons (own always; enemy if visible)
  for (const g of state.garrisons) {
    if (g.state === 'destroyed') continue;
    if (g.side !== me && !ui.revealAll && !(vis.garrisonVisible.length > g.id && vis.garrisonVisible[g.id])) continue;
    drawGarrison(ctx, g, state.time, cam.zoom, spawnLocked(state, g.pos, g.side));
  }
  // OPs
  for (const sq of state.squads) {
    if (!sq.op) continue;
    if (sq.side !== me && !ui.revealAll && !(vis.opVisible.length > sq.id && vis.opVisible[sq.id])) continue;
    drawOp(ctx, sq.op, sq.side, sq.label, cam.zoom);
  }
  // HQ spawn marker hint: none (static layer has HQ)

  // markers (own side, or controllable sides)
  for (const sq of state.squads) {
    if (!sq.marker) continue;
    if (sq.side !== me && !ui.controllable.includes(sq.side) && !ui.revealAll) continue;
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

  // ghosts (last known enemy positions)
  for (const gh of vis.ghosts) {
    const a = Math.max(0, gh.t / CONFIG.GHOST_SECONDS);
    ctx.globalAlpha = a * 0.8;
    ctx.strokeStyle = sideColor(gh.side); ctx.lineWidth = 1;
    ctx.beginPath();
    if (gh.kind === 'tank') ctx.rect(gh.pos.x - 7, gh.pos.y - 5, 14, 10); else ctx.arc(gh.pos.x, gh.pos.y, CONFIG.DOT_RADIUS + 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (const sq of state.squads) drawSquad(ctx, state, sq, ui);
  drawEffects(ctx, state, ui);

  // ---- ability effects ----
  for (const r of state.recons) {
    if (r.side !== me && !ui.revealAll) continue;
    ctx.fillStyle = C.recon; ctx.beginPath(); ctx.arc(r.pos.x, r.pos.y, r.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(120,200,255,0.7)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
    // sweep hand
    const a = state.time * 2;
    ctx.beginPath(); ctx.moveTo(r.pos.x, r.pos.y); ctx.lineTo(r.pos.x + Math.cos(a) * r.r, r.pos.y + Math.sin(a) * r.r); ctx.strokeStyle = 'rgba(120,200,255,0.5)'; ctx.stroke();
    ctx.fillStyle = '#bfe6ff'; ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(`RECON ${Math.ceil(r.t)}s`, r.pos.x, r.pos.y - r.r - 3);
  }
  // ---- defenses: wire, trenches, bunkers (always visible — big earthworks) ----
  for (const wr of state.wires) {
    ctx.strokeStyle = '#7a6a52'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(wr.a.x, wr.a.y); ctx.lineTo(wr.b.x, wr.b.y); ctx.stroke();
    const L = Math.hypot(wr.b.x - wr.a.x, wr.b.y - wr.a.y), n = Math.max(2, Math.floor(L / 7));
    const ang = Math.atan2(wr.b.y - wr.a.y, wr.b.x - wr.a.x);
    ctx.lineWidth = 1; ctx.strokeStyle = '#5d5142';
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = wr.a.x + (wr.b.x - wr.a.x) * t, y = wr.a.y + (wr.b.y - wr.a.y) * t;
      ctx.beginPath(); ctx.moveTo(x - Math.sin(ang) * 3, y + Math.cos(ang) * 3); ctx.lineTo(x + Math.sin(ang) * 3, y - Math.cos(ang) * 3); ctx.stroke();
    }
  }
  for (const tr of state.trenches) {
    ctx.strokeStyle = 'rgba(66,50,32,0.9)'; ctx.lineWidth = CONFIG.TRENCH_HALF_W * 2;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(tr.a.x, tr.a.y); ctx.lineTo(tr.b.x, tr.b.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(30,22,14,0.9)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(tr.a.x, tr.a.y); ctx.lineTo(tr.b.x, tr.b.y); ctx.stroke();
    ctx.lineCap = 'butt';
  }
  for (const bk of state.bunkers) {
    const col = sideColor(bk.side);
    ctx.fillStyle = '#4b463c'; ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    ctx.fillRect(bk.pos.x - 8, bk.pos.y - 6, 16, 12); ctx.strokeRect(bk.pos.x - 8 + 0.5, bk.pos.y - 6 + 0.5, 15, 11);
    ctx.fillStyle = '#151310'; ctx.fillRect(bk.pos.x - 5, bk.pos.y - 2, 10, 3); // firing slit
    if (bk.hp < CONFIG.BUNKER_HP) { // damage bar
      ctx.fillStyle = '#000'; ctx.fillRect(bk.pos.x - 8, bk.pos.y - 11, 16, 3);
      ctx.fillStyle = C.alarm; ctx.fillRect(bk.pos.x - 8, bk.pos.y - 11, 16 * (bk.hp / CONFIG.BUNKER_HP), 3);
    }
  }
  // napalm strips: warning line during the run-in, then flames
  for (const f of state.fires) {
    const hw = CONFIG.NAPALM_HALF_W;
    const ang = Math.atan2(f.b.y - f.a.y, f.b.x - f.a.x), nx = -Math.sin(ang) * hw, ny = Math.cos(ang) * hw;
    if (f.delay > 0) {
      ctx.strokeStyle = '#ff8c42'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(f.a.x, f.a.y); ctx.lineTo(f.b.x, f.b.y); ctx.stroke(); ctx.setLineDash([]);
      continue;
    }
    ctx.globalAlpha = 0.32 + 0.10 * Math.sin(state.time * 11);
    ctx.fillStyle = '#e25822';
    ctx.beginPath(); ctx.moveTo(f.a.x + nx, f.a.y + ny); ctx.lineTo(f.b.x + nx, f.b.y + ny); ctx.lineTo(f.b.x - nx, f.b.y - ny); ctx.lineTo(f.a.x - nx, f.a.y - ny); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.55;
    const L = Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y);
    for (let k = 0; k < L; k += 13) {
      const t01 = k / Math.max(1, L);
      const fx = f.a.x + (f.b.x - f.a.x) * t01 + Math.sin(state.time * 9 + k) * 4;
      const fy = f.a.y + (f.b.y - f.a.y) * t01 + Math.cos(state.time * 7 + k) * 3;
      const fr = 3 + 2 * Math.abs(Math.sin(state.time * 8 + k * 2));
      ctx.fillStyle = k % 26 < 13 ? '#ffb347' : '#ff6b35';
      ctx.beginPath(); ctx.arc(fx, fy, fr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // smoke: soft drifting clouds, visible to everyone
  for (const sm of state.smokes) {
    const a2 = Math.min(1, sm.t / 4) * 0.55; // fades out over the last seconds
    const grad = ctx.createRadialGradient(sm.pos.x, sm.pos.y, 2, sm.pos.x, sm.pos.y, sm.r);
    grad.addColorStop(0, `rgba(210,208,200,${a2})`);
    grad.addColorStop(0.7, `rgba(185,183,175,${a2 * 0.8})`);
    grad.addColorStop(1, 'rgba(170,168,160,0)');
    ctx.fillStyle = grad;
    const wob = Math.sin(state.time * 0.9 + sm.pos.x) * 3;
    ctx.beginPath(); ctx.arc(sm.pos.x + wob, sm.pos.y, sm.r, 0, Math.PI * 2); ctx.fill();
  }
  // hidden fields: only the owner sees them (enemy learns the hard way)
  for (const m of state.minefields) {
    if (m.side !== me && !ui.revealAll) continue;
    const col = m.kind === 'at' ? '#d97979' : '#c8a165';
    ctx.strokeStyle = col; ctx.globalAlpha = 0.7; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.arc(m.pos.x, m.pos.y, m.r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = col; ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(m.kind === 'at' ? `☒ AT ×${m.charges}` : `☠ ×${m.charges}`, m.pos.x, m.pos.y);
    ctx.globalAlpha = 1;
  }
  for (const sp of state.supplies) {
    if (sp.side !== me && !ui.revealAll && !(inOwnTerritory(state, me, sp.pos) && !concealsAt(state.grid, sp.pos))) continue;
    ctx.save(); ctx.translate(sp.pos.x, sp.pos.y);
    ctx.fillStyle = C.supply; ctx.fillRect(-5, -5, 10, 10); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(-5, -5, 10, 10);
    ctx.beginPath(); ctx.moveTo(-5, -5); ctx.lineTo(5, 5); ctx.moveTo(5, -5); ctx.lineTo(-5, 5); ctx.stroke();
    ctx.restore();
    if (sp.side === me) {
      ctx.strokeStyle = 'rgba(217,179,107,0.5)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(sp.pos.x, sp.pos.y, CONFIG.SUPPLY_RADIUS, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C.supply; ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(`SUPPLIES READY · ${Math.ceil(sp.t)}s left`, sp.pos.x, sp.pos.y + 7); // lifetime, not a deploy timer
    }
  }
  for (const st of state.strafes) {
    ctx.strokeStyle = C.strafe; ctx.lineWidth = st.delay > 0 ? 1 : 2; ctx.setLineDash(st.delay > 0 ? [6, 4] : []);
    ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.moveTo(st.a.x, st.a.y); ctx.lineTo(st.b.x, st.b.y); ctx.stroke(); ctx.setLineDash([]);
    if (st.delay <= 0) {
      // the aircraft: a small chevron sweeping along the line
      const px = st.a.x + (st.b.x - st.a.x) * st.progress, py = st.a.y + (st.b.y - st.a.y) * st.progress;
      const ang = Math.atan2(st.b.y - st.a.y, st.b.x - st.a.x);
      ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-6, 5); ctx.lineTo(-3, 0); ctx.lineTo(-6, -5); ctx.closePath(); ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = C.strafe; ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(`STRAFE ${st.delay.toFixed(1)}`, (st.a.x + st.b.x) / 2, (st.a.y + st.b.y) / 2 - 6);
    }
    ctx.globalAlpha = 1;
  }
  for (const b of state.barrages) {
    ctx.strokeStyle = C.impact; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.arc(b.pos.x, b.pos.y, b.r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.impact; ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(b.delay > 0 ? `BARRAGE ${b.delay.toFixed(1)}` : `${b.shellsLeft} shells`, b.pos.x, b.pos.y - b.r - 3);
  }

  // ---- targeting previews ----
  if (ui.mode.kind === 'ability' && ui.mouseWorld) {
    const p = ui.mouseWorld;
    const m = ui.mode;
    ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
    if (m.ability === 'recon' || m.ability === 'barrage') {
      const r = m.ability === 'recon' ? CONFIG.RECON_RADIUS : CONFIG.BARRAGE_RADIUS;
      ctx.strokeStyle = m.ability === 'recon' ? '#bfe6ff' : C.impact;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
    } else if (m.ability === 'strafe') {
      ctx.strokeStyle = C.strafe;
      if (m.stage === 0) { ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.stroke(); }
      else {
        const a = m.first!; let b = p; const L = dist(a, b);
        if (L > CONFIG.STRAFE_MAX_LENGTH) b = v(a.x + ((b.x - a.x) * CONFIG.STRAFE_MAX_LENGTH) / L, a.y + ((b.y - a.y) * CONFIG.STRAFE_MAX_LENGTH) / L);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        // beaten zone
        const ang = Math.atan2(b.y - a.y, b.x - a.x), nx = -Math.sin(ang) * CONFIG.STRAFE_WIDTH, ny = Math.cos(ang) * CONFIG.STRAFE_WIDTH;
        ctx.globalAlpha = 0.25; ctx.fillStyle = C.strafe;
        ctx.beginPath(); ctx.moveTo(a.x + nx, a.y + ny); ctx.lineTo(b.x + nx, b.y + ny); ctx.lineTo(b.x - nx, b.y - ny); ctx.lineTo(a.x - nx, a.y - ny); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
      }
    } else if (m.ability === 'wire' || m.ability === 'trench') {
      const maxL = m.ability === 'wire' ? CONFIG.WIRE_MAX_LENGTH : CONFIG.TRENCH_MAX_LENGTH;
      ctx.strokeStyle = m.ability === 'wire' ? '#7a6a52' : 'rgba(66,50,32,0.95)';
      if (m.stage === 0) { ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.stroke(); }
      else {
        const a = m.first!; let b = p; const L = dist(a, b);
        if (L > maxL) b = v(a.x + ((b.x - a.x) * maxL) / L, a.y + ((b.y - a.y) * maxL) / L);
        ctx.lineWidth = m.ability === 'trench' ? CONFIG.TRENCH_HALF_W * 2 : 2; ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.globalAlpha = 1; ctx.lineWidth = 1;
      }
    } else if (m.ability === 'smoke') {
      ctx.strokeStyle = '#c9c7bf';
      if (m.stage === 0) { ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.stroke(); }
      else {
        const a3 = m.first!; let b3 = p; const L = dist(a3, b3);
        if (L > CONFIG.SMOKE_MAX_LENGTH) b3 = v(a3.x + ((b3.x - a3.x) * CONFIG.SMOKE_MAX_LENGTH) / L, a3.y + ((b3.y - a3.y) * CONFIG.SMOKE_MAX_LENGTH) / L);
        ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(a3.x, a3.y); ctx.lineTo(b3.x, b3.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.globalAlpha = 0.3;
        for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.arc(a3.x + ((b3.x - a3.x) * i) / 4, a3.y + ((b3.y - a3.y) * i) / 4, CONFIG.SMOKE_PUFF_R, 0, Math.PI * 2); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
    } else if (m.ability === 'napalm') {
      ctx.strokeStyle = '#ff8c42';
      if (m.stage === 0) { ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.stroke(); }
      else {
        const a = m.first!; let b = p; const L = dist(a, b);
        if (L > CONFIG.NAPALM_MAX_LENGTH) b = v(a.x + ((b.x - a.x) * CONFIG.NAPALM_MAX_LENGTH) / L, a.y + ((b.y - a.y) * CONFIG.NAPALM_MAX_LENGTH) / L);
        const ang = Math.atan2(b.y - a.y, b.x - a.x), nx = -Math.sin(ang) * CONFIG.NAPALM_HALF_W, ny = Math.cos(ang) * CONFIG.NAPALM_HALF_W;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.globalAlpha = 0.25; ctx.fillStyle = '#e25822';
        ctx.beginPath(); ctx.moveTo(a.x + nx, a.y + ny); ctx.lineTo(b.x + nx, b.y + ny); ctx.lineTo(b.x - nx, b.y - ny); ctx.lineTo(a.x - nx, a.y - ny); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
      }
    } else if (m.ability === 'traps' || m.ability === 'mines') {
      ctx.strokeStyle = m.ability === 'mines' ? '#d97979' : '#c8a165';
      ctx.beginPath(); ctx.arc(p.x, p.y, m.ability === 'mines' ? CONFIG.MINE_RADIUS : CONFIG.TRAP_RADIUS, 0, Math.PI * 2); ctx.stroke();
    } else if (m.ability === 'bunker') {
      ctx.strokeStyle = '#c8bfa5';
      ctx.strokeRect(p.x - 8, p.y - 6, 16, 12);
      ctx.beginPath(); ctx.arc(p.x, p.y, CONFIG.BUNKER_R, 0, Math.PI * 2); ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    } else if (m.ability === 'supply') {
      ctx.strokeStyle = C.supply;
      ctx.beginPath(); ctx.arc(p.x, p.y, CONFIG.SUPPLY_RADIUS, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = C.supply; ctx.fillRect(p.x - 5, p.y - 5, 10, 10);
    }
    ctx.setLineDash([]);
  }
  if (ui.mode.kind === 'pickGarrison') {
    for (const g of state.garrisons) {
      if (g.side !== me || g.state !== 'active') continue;
      const pulse = 0.5 + 0.5 * Math.sin(state.time * 6);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.4 + 0.6 * pulse;
      ctx.beginPath(); ctx.arc(g.pos.x, g.pos.y, 14 / Math.sqrt(cam.zoom), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }

  // garrison drag ghost
  if (ui.drag?.kind === 'garrison' && ui.drag.moved) {
    const g = state.garrisons[ui.drag.garrisonId]!;
    const p = ui.drag.pos;
    const err = garrisonPlacementError(state, me, p, { forRedeploy: true });
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(g.pos.x, g.pos.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 0.85;
    drawGarrison(ctx, { ...g, pos: p, disabled: false, state: 'active' }, state.time, cam.zoom);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = err ? '#f66' : '#8f8'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.arc(p.x, p.y, CONFIG.GARRISON_DISABLE_R, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }

  // placement preview
  if ((ui.mode.kind === 'placeGarrison' || ui.mode.kind === 'redeploy') && ui.mouseWorld) {
    const p = ui.mouseWorld;
    const err = garrisonPlacementError(state, me, p, { forRedeploy: ui.mode.kind === 'redeploy' });
    const ok = !err;
    ctx.globalAlpha = 0.85;
    drawGarrison(ctx, { id: -1, side: me, pos: p, hp: CONFIG.GARRISON_HP, revealUntil: 0, state: 'active', disabled: false, threatTimer: 0, packTimer: 0, packTarget: null }, state.time, cam.zoom);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ok ? '#8f8' : '#f66'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.arc(p.x, p.y, CONFIG.GARRISON_DISABLE_R, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    if (err) {
      ctx.fillStyle = '#f66'; ctx.font = `bold ${9 / Math.sqrt(cam.zoom)}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      const msg = { territory: 'OWN TERRITORY ONLY', point: '100px FROM UNHELD POINTS', locked: 'TOO CLOSE TO THE FIGHT', terrain: 'BAD GROUND', count: 'ALL PLACED', wb: `NEED ${CONFIG.ABILITY.garrison!.cost} WB`, cooldown: 'COOLDOWN', supply: 'NEEDS SUPPLY DROP', phase: '' }[err] ?? err;
      ctx.fillText(msg, p.x, p.y - 14 / Math.sqrt(cam.zoom));
    }
  }

  ctx.restore();
}
