// Camera + pointer handling. Converts screen → logical → world, drags markers
// through the CommanderInterface, pans/zooms the camera. No sim mutation here.
import { CONFIG } from '../config';
import type { CommanderInterface } from '../commander';
import type { GameState, MarkerKind, Side, Squad } from '../state';
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
  controllable: Side[];
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
    controllable: CONFIG.DEBUG_CONTROL_BOTH_SIDES ? ['US', 'PAVN'] : ['US'],
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
    const w = screenToWorld(ui, s);
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
      const hit = markerHit(state(), ui, w);
      ui.hoverSquadId = hit ? hit.id : null;
      canvas.style.cursor = hit ? 'grab' : 'default';
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
  });
}
