// Camera + pointer handling. Converts screen → logical → world, drags markers
// through the CommanderInterface, pans/zooms the camera. No sim mutation here.
import { CONFIG } from '../config';
import { garrisonPlacementError, type CommanderInterface } from '../commander';
import type { AbilityKind, GameState, Garrison, MarkerKind, Side, Squad } from '../state';
import { applyDraftHit, defaultDraft, draftHit, type DraftUi } from './draft';
import { orderCardAt, startAbilityMode } from './orders';
import { chipAt, focusSquad } from './roster';
import { abilityError } from '../systems/abilities';
import { draftError } from '../systems/draft';
import { ABILITIES } from '../state';
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
}

export const MARKER_HIT_R = 14;

export function createUiState(): UiState {
  return {
    cam: { x: 0, y: 0, zoom: 1 },
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
  };
}

export function updateViewport(ui: UiState, cssW: number, cssH: number): void {
  const scale = Math.min(cssW / CONFIG.LOGICAL_W, cssH / CONFIG.LOGICAL_H);
  ui.view = { scale, ox: (cssW - CONFIG.LOGICAL_W * scale) / 2, oy: (cssH - CONFIG.LOGICAL_H * scale) / 2, cssW, cssH };
}

export const screenToLogical = (ui: UiState, s: Vec): Vec => v((s.x - ui.view.ox) / ui.view.scale, (s.y - ui.view.oy) / ui.view.scale);
export const logicalToWorld = (ui: UiState, l: Vec): Vec => v(l.x / ui.cam.zoom + ui.cam.x, l.y / ui.cam.zoom + ui.cam.y);
export const screenToWorld = (ui: UiState, s: Vec): Vec => logicalToWorld(ui, screenToLogical(ui, s));
export const worldToLogical = (ui: UiState, w: Vec): Vec => v((w.x - ui.cam.x) * ui.cam.zoom, (w.y - ui.cam.y) * ui.cam.zoom);

export function clampCamera(cam: Camera): void {
  cam.zoom = clamp(cam.zoom, CONFIG.CAM_MIN_ZOOM, CONFIG.CAM_MAX_ZOOM);
  const vw = CONFIG.LOGICAL_W / cam.zoom, vh = CONFIG.LOGICAL_H / cam.zoom;
  cam.x = clamp(cam.x, 0, CONFIG.LOGICAL_W - vw);
  cam.y = clamp(cam.y, 0, CONFIG.LOGICAL_H - vh);
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
      if (m.ability === 'strafe') {
        if (m.stage === 0) { ui.mode = { kind: 'ability', ability: 'strafe', stage: 1, first: w }; return; }
        if (!abilityError(st, ui.player, 'strafe', m.first!, w)) { commanders[ui.player].buyAbility('strafe', m.first!, w); ui.mode = { kind: 'none' }; }
        return;
      }
      if (!abilityError(st, ui.player, m.ability, w)) { commanders[ui.player].buyAbility(m.ability, w); ui.mode = { kind: 'none' }; }
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
        if (!garrisonPlacementError(st, ui.player, w)) {
          commanders[ui.player].placeGarrison(w);
          const owned = st.garrisons.filter((g) => g.side === ui.player && g.state !== 'destroyed').length + 1;
          if (st.phase !== 'setup' || owned >= CONFIG.GARRISONS_AT_START) ui.mode = { kind: 'none' };
        }
      } else if (ui.mode.kind === 'redeploy') {
        if (!garrisonPlacementError(st, ui.player, w, { forRedeploy: true }) && (st.phase !== 'play' || !abilityError(st, ui.player, 'redeploy', w, undefined, ui.mode.garrisonId))) {
          commanders[ui.player].redeployGarrison(ui.mode.garrisonId, w);
          ui.mode = { kind: 'none' };
        }
      }
      return;
    }
    // clicking one of our garrisons starts a redeploy
    const gHit = garrisonHit(state(), ui, w);
    if (gHit && e.button === 0 && state().phase !== 'ended') { ui.mode = { kind: 'redeploy', garrisonId: gHit.id }; return; }
    const hit = markerHit(state(), ui, w);
    if (hit && (e.button === 0 || e.button === 2)) {
      // left-drag = attack marker, right-drag = defend marker
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
      ui.drag.pos = v(clamp(w.x, 0, CONFIG.LOGICAL_W), clamp(w.y, 0, CONFIG.LOGICAL_H));
    } else {
      const l = screenToLogical(ui, s);
      const chip = chipAt(state(), ui, l);
      const hit = chip ?? markerHit(state(), ui, w);
      ui.hoverSquadId = hit ? hit.id : null;
      canvas.style.cursor = chip ? 'pointer' : hit ? 'grab' : ui.mode.kind !== 'none' ? 'crosshair' : 'default';
    }
  });

  window.addEventListener('mouseup', () => {
    if (ui.drag?.kind === 'marker') {
      const sq = state().squads[ui.drag.squadId];
      if (sq) commanders[sq.side].issueMarker(sq.id, ui.drag.markerKind, ui.drag.pos);
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
