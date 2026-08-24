// Camera + pointer handling. Converts screen → logical → world, drags markers
// through the CommanderInterface, pans/zooms the camera. No sim mutation here.
import { CONFIG } from '../config';
import { AN_CUONG } from '../map/an_cuong';
import { garrisonPlacementError, type CommanderInterface } from '../commander';
import type { AbilityKind, GameState, Garrison, MarkerKind, Side, Squad } from '../state';
import { applyDraftHit, defaultDraft, draftHit, type DraftUi } from './draft';
import { orderCardAt, startAbilityMode } from './orders';
import { chipAt, focusSquad } from './roster';
import { abilityError } from '../systems/abilities';
import { draftError } from '../systems/draft';
import { ABILITIES } from '../state';
import { ABILITY_INFO } from './orders';
import { clamp, dist, v, type Vec } from '../vec';

export interface Camera { x: number; y: number; zoom: number }

export interface Viewport { scale: number; ox: number; oy: number; cssW: number; cssH: number }

export interface UiState {
  cam: Camera;
  view: Viewport;
  mouseWorld: Vec | null;
  hoverSquadId: number | null;
  drag:
    | { kind: 'pan'; startScreen: Vec; startCam: Vec }
    | { kind: 'marker'; squadId: number; markerKind: MarkerKind; pos: Vec }
    | { kind: 'garrison'; garrisonId: number; pos: Vec; moved: boolean }
    | null;
  showPaths: boolean;
  revealAll: boolean; // F: debug fog toggle (render only; the sim still enforces fog)
  controllable: Side[];
  /** Which side the human plays (HUD, fog, placement). */
  player: Side;
  mode:
    | { kind: 'none' }
    | { kind: 'placeGarrison' }
    | { kind: 'pickGarrison' }
    | { kind: 'redeploy'; garrisonId: number }
    | { kind: 'ability'; ability: AbilityKind; stage: 0 | 1; first: Vec | null };
  draft: DraftUi;
  toast: { text: string; t: number } | null; // short feedback line (e.g. why a drop was rejected)
}

export const MARKER_HIT_R = 18;
export const SQUAD_HIT_R = 14; // grabbing a squad by its dots also starts an order drag

export function createUiState(): UiState {
  return {
    cam: { x: 0, y: 0, zoom: CONFIG.CAM_MIN_ZOOM },
    view: { scale: 1, ox: 0, oy: 0, cssW: CONFIG.LOGICAL_W, cssH: CONFIG.LOGICAL_H },
    mouseWorld: null,
    hoverSquadId: null,
    drag: null,
    showPaths: CONFIG.DEBUG_DRAW_PATHS,
    revealAll: CONFIG.DEBUG_REVEAL_ALL,
    controllable: CONFIG.DEBUG_CONTROL_BOTH_SIDES ? ['US', 'PAVN'] : ['US'],
    player: 'US',
    mode: { kind: 'none' },
    draft: { comp: defaultDraft(), done: false },
    toast: null,
  };
}

export function toast(ui: UiState, text: string, seconds = 2.5): void { ui.toast = { text, t: seconds }; }

export const PLACEMENT_MSG: Record<string, string> = {
  territory: 'Own territory only (west of the dashed line)',
  point: 'Must be 100px from a point you don\'t hold',
  locked: 'Too close to the contested point (spawns there are locked)',
  terrain: 'Can\'t place on water',
  count: 'All garrisons placed',
  wb: 'Not enough War Bonds',
  cooldown: 'Still on cooldown',
  supply: 'Needs a Supply Drop within 75px',
  phase: '',
  cost: 'Can\'t afford that',
  target: 'Invalid target',
};

export function updateViewport(ui: UiState, cssW: number, cssH: number): void {
  const scale = Math.min(cssW / CONFIG.LOGICAL_W, cssH / CONFIG.LOGICAL_H);
  ui.view = { scale, ox: (cssW - CONFIG.LOGICAL_W * scale) / 2, oy: (cssH - CONFIG.LOGICAL_H * scale) / 2, cssW, cssH };
}

export const screenToLogical = (ui: UiState, s: Vec): Vec => v((s.x - ui.view.ox) / ui.view.scale, (s.y - ui.view.oy) / ui.view.scale);
export const logicalToWorld = (ui: UiState, l: Vec): Vec => v(l.x / ui.cam.zoom + ui.cam.x, l.y / ui.cam.zoom + ui.cam.y);
export const screenToWorld = (ui: UiState, s: Vec): Vec => logicalToWorld(ui, screenToLogical(ui, s));
export const worldToLogical = (ui: UiState, w: Vec): Vec => v((w.x - ui.cam.x) * ui.cam.zoom, (w.y - ui.cam.y) * ui.cam.zoom);

export function clampCamera(cam: Camera): void {
  const mapW = AN_CUONG.width, mapH = AN_CUONG.height;
  cam.zoom = clamp(cam.zoom, CONFIG.CAM_MIN_ZOOM, CONFIG.CAM_MAX_ZOOM);
  const vw = CONFIG.LOGICAL_W / cam.zoom, vh = CONFIG.LOGICAL_H / cam.zoom;
  cam.x = clamp(cam.x, 0, Math.max(0, mapW - vw));
  cam.y = clamp(cam.y, 0, Math.max(0, mapH - vh));
}

function markerHit(state: GameState, ui: UiState, world: Vec): Squad | null {
  // hit radius in world px shrinks as we zoom in so flags stay grabbable but precise
  const r = MARKER_HIT_R / ui.cam.zoom;
  let best: Squad | null = null, bestD = Infinity;
  for (const sq of state.squads) {
    if (!sq.marker || !ui.controllable.includes(sq.side)) continue;
    const d = dist(sq.marker.pos, world);
    if (d <= r && d < bestD) { best = sq; bestD = d; }
  }
  return best;
}

/** Squad whose living dots are under the cursor (own/controllable sides only). */
function squadBodyHit(state: GameState, ui: UiState, world: Vec): Squad | null {
  const r = SQUAD_HIT_R / Math.sqrt(ui.cam.zoom);
  let best: Squad | null = null, bestD = Infinity;
  for (const d of state.dots) {
    if (!d.alive) continue;
    const sq = state.squads[d.squadId]!;
    if (!ui.controllable.includes(sq.side) || sq.kind === 'artillery') continue;
    const dd = dist(d.pos, world);
    if (dd <= r && dd < bestD) { best = sq; bestD = dd; }
  }
  return best;
}

/** Flag first (precise), then the squad body. */
function orderHit(state: GameState, ui: UiState, world: Vec): Squad | null {
  return markerHit(state, ui, world) ?? squadBodyHit(state, ui, world);
}

function garrisonHit(state: GameState, ui: UiState, world: Vec): Garrison | null {
  const r = MARKER_HIT_R / ui.cam.zoom;
  for (const g of state.garrisons) {
    if (g.side !== ui.player || g.state !== 'active') continue;
    if (dist(g.pos, world) <= r) return g;
  }
  return null;
}

export function attachInput(
  canvas: HTMLCanvasElement,
  state: () => GameState,
  ui: UiState,
  commanders: Record<Side, CommanderInterface>,
): void {
  const screenOf = (e: MouseEvent): Vec => {
    const r = canvas.getBoundingClientRect();
    return v(e.clientX - r.left, e.clientY - r.top);
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('mousedown', (e) => {
    const s = screenOf(e);
    const l = screenToLogical(ui, s);
    const w = screenToWorld(ui, s);
    const st = state();
    // ---- UI layer first ----
    if (st.phase === 'draft') {
      if (e.button !== 0) return;
      const hit = draftHit(l);
      if (hit?.kind === 'deploy') {
        if (!ui.draft.done && !draftError(ui.draft.comp)) { commanders[ui.player].draft(ui.draft.comp); ui.draft.done = true; }
      } else applyDraftHit(ui.draft, hit);
      return;
    }
    if (e.button === 0) {
      const card = orderCardAt(l);
      if (card) { if (st.phase === 'play') startAbilityMode(ui, card); return; }
      const chip = chipAt(st, ui, l);
      if (chip) { focusSquad(st, ui, chip); return; }
    }
    if (ui.mode.kind === 'ability') {
      if (e.button === 2) { ui.mode = { kind: 'none' }; return; }
      if (e.button !== 0) return;
      const m = ui.mode;
      if (ABILITY_INFO[m.ability].mode === 'line') { // strafe / wire / trench: two clicks
        if (m.stage === 0) { ui.mode = { kind: 'ability', ability: m.ability, stage: 1, first: w }; return; }
        const e2 = abilityError(st, ui.player, m.ability, m.first!, w);
        if (e2) toast(ui, PLACEMENT_MSG[e2] ?? e2); else { commanders[ui.player].buyAbility(m.ability, m.first!, w); ui.mode = { kind: 'none' }; }
        return;
      }
      const e1 = abilityError(st, ui.player, m.ability, w);
      if (e1) toast(ui, PLACEMENT_MSG[e1] ?? e1); else { commanders[ui.player].buyAbility(m.ability, w); ui.mode = { kind: 'none' }; }
      return;
    }
    if (ui.mode.kind === 'pickGarrison') {
      if (e.button === 2) { ui.mode = { kind: 'none' }; return; }
      const g = garrisonHit(st, ui, w);
      if (g) ui.mode = { kind: 'redeploy', garrisonId: g.id };
      return;
    }
    if (ui.mode.kind !== 'none') {
      if (e.button === 2) { ui.mode = { kind: 'none' }; return; } // right-click cancels
      if (e.button !== 0) return;
      if (ui.mode.kind === 'placeGarrison') {
        const err = garrisonPlacementError(st, ui.player, w);
        if (err) toast(ui, PLACEMENT_MSG[err] ?? err);
        else {
          commanders[ui.player].placeGarrison(w);
          const owned = st.garrisons.filter((g) => g.side === ui.player && g.state !== 'destroyed').length + 1;
          if (st.phase !== 'setup' || owned >= CONFIG.GARRISONS_AT_START) ui.mode = { kind: 'none' };
        }
      } else if (ui.mode.kind === 'redeploy') {
        const err = garrisonPlacementError(st, ui.player, w, { forRedeploy: true }) ?? (st.phase === 'play' ? abilityError(st, ui.player, 'redeploy', w, undefined, ui.mode.garrisonId) : null);
        if (err) toast(ui, PLACEMENT_MSG[err] ?? err);
        else { commanders[ui.player].redeployGarrison(ui.mode.garrisonId, w); ui.mode = { kind: 'none' }; }
      }
      return;
    }
    // Left-drag one of our garrisons and drop = move it (free in setup; redeploy 75 WB / 30s pack in play).
    const gHit = garrisonHit(st, ui, w);
    if (gHit && e.button === 0 && st.phase !== 'ended') {
      ui.drag = { kind: 'garrison', garrisonId: gHit.id, pos: w, moved: false };
      canvas.style.cursor = 'grabbing';
      return;
    }
    // Left-drag a squad (its dots or its flag) and drop = attack order; right-drag = defend order.
    const hit = orderHit(state(), ui, w);
    if (hit && (e.button === 0 || e.button === 2)) {
      ui.drag = { kind: 'marker', squadId: hit.id, markerKind: e.button === 2 ? 'defend' : 'attack', pos: w };
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button === 0 || e.button === 1) {
      ui.drag = { kind: 'pan', startScreen: s, startCam: v(ui.cam.x, ui.cam.y) };
      canvas.style.cursor = 'move';
    }
  });

  window.addEventListener('mousemove', (e) => {
    const s = screenOf(e);
    const w = screenToWorld(ui, s);
    ui.mouseWorld = w;
    if (ui.drag?.kind === 'pan') {
      const dx = (s.x - ui.drag.startScreen.x) / (ui.view.scale * ui.cam.zoom);
      const dy = (s.y - ui.drag.startScreen.y) / (ui.view.scale * ui.cam.zoom);
      ui.cam.x = ui.drag.startCam.x - dx;
      ui.cam.y = ui.drag.startCam.y - dy;
      clampCamera(ui.cam);
    } else if (ui.drag?.kind === 'marker') {
      ui.drag.pos = v(clamp(w.x, 0, AN_CUONG.width), clamp(w.y, 0, AN_CUONG.height));
    } else if (ui.drag?.kind === 'garrison') {
      ui.drag.pos = v(clamp(w.x, 0, AN_CUONG.width), clamp(w.y, 0, AN_CUONG.height));
      ui.drag.moved = true;
    } else {
      const l = screenToLogical(ui, s);
      const chip = chipAt(state(), ui, l);
      const hit = chip ?? orderHit(state(), ui, w);
      ui.hoverSquadId = hit ? hit.id : null;
      const overGarrison = !hit && !chip && !!garrisonHit(state(), ui, w);
      canvas.style.cursor = chip ? 'pointer' : hit || overGarrison ? 'grab' : ui.mode.kind !== 'none' ? 'crosshair' : 'default';
    }
  });

  window.addEventListener('mouseup', () => {
    const st = state();
    if (ui.drag?.kind === 'marker') {
      const sq = st.squads[ui.drag.squadId];
      if (sq) commanders[sq.side].issueMarker(sq.id, ui.drag.markerKind, ui.drag.pos);
    } else if (ui.drag?.kind === 'garrison') {
      const g = st.garrisons[ui.drag.garrisonId];
      if (g && ui.drag.moved && dist(ui.drag.pos, g.pos) > 4) {
        const err = garrisonPlacementError(st, ui.player, ui.drag.pos, { forRedeploy: true }) ?? (st.phase === 'play' ? abilityError(st, ui.player, 'redeploy', ui.drag.pos, undefined, g.id) : null);
        if (err) toast(ui, PLACEMENT_MSG[err] ?? err);
        else {
          commanders[ui.player].redeployGarrison(g.id, ui.drag.pos);
          if (st.phase === 'play') toast(ui, `Redeploying garrison — packs for ${CONFIG.REDEPLOY_PACK_SECONDS}s, costs ${CONFIG.ABILITY.redeploy!.cost} WB`);
        }
      }
    }
    ui.drag = null;
    canvas.style.cursor = 'default';
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const s = screenOf(e);
    const before = screenToWorld(ui, s);
    const factor = e.deltaY < 0 ? CONFIG.CAM_WHEEL_ZOOM_STEP : 1 / CONFIG.CAM_WHEEL_ZOOM_STEP;
    ui.cam.zoom = clamp(ui.cam.zoom * factor, CONFIG.CAM_MIN_ZOOM, CONFIG.CAM_MAX_ZOOM);
    // keep the world point under the cursor fixed
    const l = screenToLogical(ui, s);
    ui.cam.x = before.x - l.x / ui.cam.zoom;
    ui.cam.y = before.y - l.y / ui.cam.zoom;
    clampCamera(ui.cam);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') ui.showPaths = !ui.showPaths;
    if (e.key === 'r' || e.key === 'R') { ui.cam = { x: 0, y: 0, zoom: 1 }; }
    if (e.key === 'f' || e.key === 'F') ui.revealAll = !ui.revealAll;
    if (e.key === 'g' || e.key === 'G') ui.mode = ui.mode.kind === 'placeGarrison' ? { kind: 'none' } : { kind: 'placeGarrison' };
    if (e.key === 'Escape') ui.mode = { kind: 'none' };
    const n = Number(e.key);
    if (n >= 1 && n <= ABILITIES.length && state().phase === 'play') startAbilityMode(ui, ABILITIES[n - 1]!);
    if (e.key === 'Enter' && state().phase === 'setup') commanders[ui.player].setupDone();
  });
}
