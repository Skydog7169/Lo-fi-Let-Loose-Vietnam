// Everything is canvas primitives: flat terrain colours, dots, lines, glyphs.
// The static map layer is rendered once to an offscreen canvas at 2× and blitted.
import { CONFIG } from '../config';
import type { MapData, Shape } from '../map/an_cuong';
import { inOwnTerritory, sectorLineX, type Dot, type GameState, type Garrison, type Side, type Squad } from '../state';
import { isCoverAt } from '../map/grid';
import { garrisonPlacementError } from '../commander';
import type { UiState } from '../ui/input';
import { dist, fromAngle, v, type Vec } from '../vec';

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

function drawSquad(ctx: CanvasRenderingContext2D, state: GameState, sq: Squad, ui: UiState): void {
  const col = sideColor(sq.side);
  for (let i = 0; i < sq.dotIds.length; i++) {
    const d = state.dots[sq.dotIds[i]!]!;
    if (!d.alive || !visibleDot(state, ui, d)) continue;
    if (sq.kind === 'tank') { drawTank(ctx, d, col); continue; }
    if (sq.kind === 'artillery') { drawBattery(ctx, d, col); continue; }
    ctx.beginPath(); ctx.arc(d.pos.x, d.pos.y, CONFIG.DOT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill();
    if (d.slot === 0) { ctx.strokeStyle = C.leaderRing; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(d.pos.x, d.pos.y, CONFIG.DOT_RADIUS + 1.5, 0, Math.PI * 2); ctx.stroke(); }
    // tiny facing tick
    const f = fromAngle(d.facing, CONFIG.DOT_RADIUS + 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(d.pos.x, d.pos.y); ctx.lineTo(d.pos.x + f.x, d.pos.y + f.y); ctx.stroke();
    // "pinned" chevrons above suppressed dots
    if (d.suppression > 0.5) {
      ctx.strokeStyle = C.suppressed; ctx.lineWidth = 1.2;
      const y0 = d.pos.y - CONFIG.DOT_RADIUS - 3;
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
        ctx.strokeStyle = e.side === 'US' ? C.tracerUs : C.tracerPavn; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke();
        break;
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

function drawGarrison(ctx: CanvasRenderingContext2D, g: Garrison, time: number, zoom: number): void {
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

  // territory: tint the enemy side of the sector line, draw the line
  const lx = sectorLineX(state);
  ctx.fillStyle = C.fogEnemy;
  if (me === 'US') ctx.fillRect(lx, 0, state.map.width - lx, state.map.height); else ctx.fillRect(0, 0, lx, state.map.height);
  ctx.strokeStyle = C.sectorLine; ctx.lineWidth = 1.5; ctx.setLineDash([8, 6]);
  ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, state.map.height); ctx.stroke(); ctx.setLineDash([]);

  // capture points: owner tint, active progress ring with pulse
  for (let i = 0; i < state.points.length; i++) {
    const ps = state.points[i]!, pm = state.map.points[i]!;
    ctx.beginPath(); ctx.arc(pm.pos.x, pm.pos.y, CONFIG.POINT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = sideDim(ps.owner); ctx.fill();
    if (i === state.active) {
      const pulse = 0.6 + 0.4 * Math.sin(state.time * 4);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5 * pulse; ctx.beginPath(); ctx.arc(pm.pos.x, pm.pos.y, CONFIG.POINT_RADIUS + 4, 0, Math.PI * 2); ctx.stroke();
      if (ps.progress > 0) {
        ctx.strokeStyle = C.us; ctx.lineWidth = 5; ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.arc(pm.pos.x, pm.pos.y, CONFIG.POINT_RADIUS + 4, -Math.PI / 2, -Math.PI / 2 + ps.progress * Math.PI * 2); ctx.stroke();
      }
    } else if (i < state.active) {
      // locked behind the front
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
    drawGarrison(ctx, g, state.time, cam.zoom);
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
  for (const sp of state.supplies) {
    if (sp.side !== me && !ui.revealAll && !(inOwnTerritory(state, me, sp.pos) && !isCoverAt(state.grid, sp.pos))) continue;
    ctx.save(); ctx.translate(sp.pos.x, sp.pos.y);
    ctx.fillStyle = C.supply; ctx.fillRect(-5, -5, 10, 10); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(-5, -5, 10, 10);
    ctx.beginPath(); ctx.moveTo(-5, -5); ctx.lineTo(5, 5); ctx.moveTo(5, -5); ctx.lineTo(-5, 5); ctx.stroke();
    ctx.restore();
    if (sp.side === me) {
      ctx.strokeStyle = 'rgba(217,179,107,0.5)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(sp.pos.x, sp.pos.y, CONFIG.SUPPLY_RADIUS, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C.supply; ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(`${Math.ceil(sp.t)}s`, sp.pos.x, sp.pos.y + 7);
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

  // placement preview
  if ((ui.mode.kind === 'placeGarrison' || ui.mode.kind === 'redeploy') && ui.mouseWorld) {
    const p = ui.mouseWorld;
    const err = garrisonPlacementError(state, me, p, { forRedeploy: ui.mode.kind === 'redeploy' });
    const ok = !err;
    ctx.globalAlpha = 0.85;
    drawGarrison(ctx, { id: -1, side: me, pos: p, hp: CONFIG.GARRISON_HP, state: 'active', disabled: false, threatTimer: 0, packTimer: 0, packTarget: null }, state.time, cam.zoom);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ok ? '#8f8' : '#f66'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.arc(p.x, p.y, CONFIG.GARRISON_DISABLE_R, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    if (err) {
      ctx.fillStyle = '#f66'; ctx.font = `bold ${9 / Math.sqrt(cam.zoom)}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      const msg = { territory: 'OWN TERRITORY ONLY', point: '100px FROM POINTS', terrain: 'BAD GROUND', count: 'ALL PLACED', wb: 'NEED 300 WB', cooldown: 'COOLDOWN', supply: 'NEEDS SUPPLY DROP', phase: '' }[err];
      ctx.fillText(msg, p.x, p.y - 14 / Math.sqrt(cam.zoom));
    }
  }

  ctx.restore();
}
