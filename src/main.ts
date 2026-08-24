// Boot: canvas, letterboxed scaling, fixed-timestep loop decoupled from render.
import { CONFIG } from './config';
import { makeCommander } from './commander';
import { type Side } from './state';
import { createInitialState } from './scenarios';
import { stepSim, TICK_DT } from './sim';
import { toast, attachInput, createUiState, updateViewport } from './ui/input';
import { initAudio, toggleMute, updateAudio } from './audio';
import { drawHud } from './ui/hud';
import { buildStaticLayer, drawWorld } from './render/draw';
import { profilePaths, runAiMatch, runMany, runScenario } from './devtools';
import { makeCommanderAi } from './systems/commander_ai';
import { drawOrders } from './ui/orders';
import { drawRoster } from './ui/roster';
import {drawDraft, defaultDraft} from './ui/draft';
import { drawMenu } from './ui/menu';
import { autoPlaceUsGarrisons } from './scenarios';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 1);
let matchSeed = seed;
const scenario = params.get('scenario') ?? CONFIG.SCENARIO;
if (params.get('setup') === '0') (CONFIG as { SKIP_SETUP: boolean }).SKIP_SETUP = true;
const urlMode = params.get('mode');
if (urlMode === 'offensive' || urlMode === 'warfare') (CONFIG as { GAME_MODE: 'warfare' | 'offensive' }).GAME_MODE = urlMode;
{
  const diff = params.get('ai') ?? CONFIG.AI_DIFFICULTY;
  const preset = CONFIG.AI_DIFFICULTY_PRESETS[diff] ?? CONFIG.AI_DIFFICULTY_PRESETS['normal']!;
  (CONFIG as { AI_CADENCE: number }).AI_CADENCE = preset.cadence;
  (CONFIG as { AI_BONUS_WB: number }).AI_BONUS_WB = preset.bonusWb;
}
let state = createInitialState(seed, scenario);
if (CONFIG.SKIP_SETUP && state.phase === 'setup') state.phase = 'play';
const ui = createUiState();
const commanders: Record<Side, ReturnType<typeof makeCommander>> = {
  US: makeCommander(() => state, 'US'),
  PAVN: makeCommander(() => state, 'PAVN'),
};
const staticLayer = buildStaticLayer(state.map);
// The enemy commander: scripted AI behind the same interface as the human.
let ai = makeCommanderAi('PAVN', commanders.PAVN, state.map, state.grid, seed);
let autoPlaced = false;

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth, h = window.innerHeight;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  updateViewport(ui, w, h);
}
window.addEventListener('resize', resize);
resize();

attachInput(canvas, () => state, ui, commanders);

let last = performance.now();
let acc = 0;
window.addEventListener('pointerdown', () => initAudio(), { once: false });
window.addEventListener('keydown', (e) => { initAudio(); if (e.key === 'm' || e.key === 'M') { const m = toggleMute(); toast(ui, m ? 'sound muted' : 'sound on', 1.2); } });
const watched = { garrisonsLost: 0, active: -99, owners: '' };
let fps = 0;
function frame(now: number): void {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > CONFIG.MAX_FRAME_DT) dt = CONFIG.MAX_FRAME_DT;
  fps = fps * 0.9 + (1 / Math.max(dt, 1e-6)) * 0.1;
  acc += dt;
  if (ui.menuOpen) acc = 0; // paused
  if (ui.toast) { ui.toast.t -= dt; if (ui.toast.t <= 0) ui.toast = null; }
  updateAudio(state, ui, dt);
  if (ui.menuRequest) {
    const req = ui.menuRequest;
    ui.menuRequest = null;
    if (req.kind === 'sound') { const m = toggleMute(); toast(ui, m ? 'sound muted' : 'sound on', 1.2); }
    else if (req.kind === 'mode') { (CONFIG as { GAME_MODE: 'warfare' | 'offensive' }).GAME_MODE = req.mode; toast(ui, `next battle: ${req.mode.toUpperCase()}`, 2); }
    else if (req.kind === 'ai') {
      ui.aiLevel = req.level;
      const preset = CONFIG.AI_DIFFICULTY_PRESETS[req.level]!;
      (CONFIG as { AI_CADENCE: number }).AI_CADENCE = preset.cadence;
      (CONFIG as { AI_BONUS_WB: number }).AI_BONUS_WB = preset.bonusWb;
      toast(ui, `next battle: ${req.level.toUpperCase()} AI`, 2);
    } else {
      const newSeed = req.kind === 'new' ? (Date.now() % 100000) : matchSeed;
      matchSeed = newSeed;
      resetMatch(newSeed);
      ui.menuOpen = false;
      ui.mode = { kind: 'none' };
      watched.garrisonsLost = 0; watched.active = -99; watched.owners = '';
      toast(ui, req.kind === 'new' ? 'new battle' : 'rematch — same map', 2);
    }
  }
  // battlefield event feedback: sector flips and garrison losses
  {
    const st = state;
    const myLost = st.stats[ui.player].garrisonsLost;
    if (myLost > watched.garrisonsLost && st.phase === 'play') toast(ui, myLost - watched.garrisonsLost > 1 ? `${myLost - watched.garrisonsLost} GARRISONS DESTROYED` : 'GARRISON DESTROYED', 3.5);
    watched.garrisonsLost = myLost;
    const owners = st.points.map((p) => p.owner ?? 'n').join(',');
    if (st.active !== watched.active && st.phase === 'play') {
      if (watched.active >= 0 && watched.active < st.points.length) {
        const p = st.points[watched.active]!;
        const name = st.map.points[watched.active]!.name;
        const prevOwner = watched.owners.split(',')[watched.active];
        if (p.owner === ui.player && prevOwner !== ui.player) toast(ui, `${name} SECURED — front advances`, 3.5);
        else if (p.owner && p.owner !== ui.player && prevOwner === ui.player) toast(ui, `${name} LOST — spawns in the sector are gone, fall back`, 4);
        else if (p.owner && p.owner !== ui.player) toast(ui, `Attack on ${name} repelled — the front falls back`, 3.5);
        else if (p.owner === ui.player) toast(ui, `Enemy attack on ${name} repelled — front advances`, 3.5);
      }
      watched.active = st.active;
    }
    watched.owners = owners;
  }
  while (acc >= TICK_DT) {
    tickOnce();
    acc -= TICK_DT;
  }
  render();
  requestAnimationFrame(frame);
}

function tickOnce(): void {
  ai.update(state.time);
  if (CONFIG.SKIP_SETUP && state.phase === 'setup' && !autoPlaced) { autoPlaceUsGarrisons(state); commanders.US.setupDone(); autoPlaced = true; }
  stepSim(state);
}

function render(): void {
  const dpr = window.devicePixelRatio || 1;
  const { scale, ox, oy } = ui.view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = CONFIG.COLORS.letterbox;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, CONFIG.LOGICAL_W, CONFIG.LOGICAL_H); ctx.clip();
  drawWorld(ctx, staticLayer, state, ui);
  drawHud(ctx, state, ui, fps);
  drawOrders(ctx, state, ui);
  drawRoster(ctx, state, ui);
  if (state.phase === 'draft') drawDraft(ctx, state, ui, ui.draft);
  drawMenu(ctx, state, ui);
  ctx.restore();
}

requestAnimationFrame(frame);

function resetMatch(s2: number, sc?: string): void {
  state = createInitialState(s2, sc ?? state.scenario);
  if (CONFIG.SKIP_SETUP && state.phase === 'setup') state.phase = 'play';
  ai = makeCommanderAi('PAVN', commanders.PAVN, state.map, state.grid, s2);
  autoPlaced = false;
  ui.draft.done = false;
  ui.draft.comp = defaultDraft();
}

// expose for console poking during development
(window as unknown as { tacmap: unknown }).tacmap = {
  get state() { return state; },
  ui,
  commanders,
  reset: resetMatch,
  /** Advance the sim n ticks (AI included) and redraw — used for headless/background-tab testing. */
  step: (n: number) => { for (let i = 0; i < n; i++) tickOnce(); render(); },
  runAiMatch,
  render,
  runScenario,
  runMany,
  profilePaths,
};
