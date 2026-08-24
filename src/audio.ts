// Synthesized battle audio — WebAudio only, zero assets (bible: no assets in v1).
// Everything is noise bursts and simple oscillators shaped by envelopes.
// Volume falls off with distance from the camera's view centre; M toggles mute.
import { CONFIG } from './config';
import type { GameState } from './state';
import type { UiState } from './ui/input';
import type { Vec } from './vec';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;
let lastShotAt = 0;

export function audioMuted(): boolean { return muted; }
export function toggleMute(): boolean {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

/** Call from a user-gesture handler once; browsers refuse autoplay otherwise. */
export function initAudio(): void {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    // 1s of white noise, reused by every burst
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  } catch {
    ctx = null;
  }
}

/** 0..1 loudness for a world position given the current camera view. */
function attenuate(ui: UiState, p: Vec): number {
  const cx = ui.cam.x + CONFIG.LOGICAL_W / ui.cam.zoom / 2;
  const cy = ui.cam.y + CONFIG.LOGICAL_H / ui.cam.zoom / 2;
  const d = Math.hypot(p.x - cx, p.y - cy);
  const full = 320 / Math.min(1, ui.cam.zoom); // hear further when zoomed out
  return Math.max(0.06, Math.min(1, full / Math.max(full, d)));
}

function noiseBurst(vol: number, dur: number, freq: number, q = 1, drop = 0): void {
  if (!ctx || !master || !noiseBuf || muted || vol <= 0.01) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.7 + Math.random() * 0.6;
  const filt = ctx.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.value = freq * (0.85 + Math.random() * 0.3);
  filt.Q.value = q;
  if (drop > 0) filt.frequency.exponentialRampToValueAtTime(Math.max(60, freq - drop), ctx.currentTime + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  src.connect(filt); filt.connect(g); g.connect(master);
  src.start(); src.stop(ctx.currentTime + dur + 0.05);
}

function tone(vol: number, freq: number, dur: number, type: OscillatorType = 'square'): void {
  if (!ctx || !master || muted || vol <= 0.01) return;
  const o = ctx.createOscillator();
  o.type = type; o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  o.connect(g); g.connect(master);
  o.start(); o.stop(ctx.currentTime + dur + 0.05);
}

const seen = new WeakSet<object>();
let alarmAt = -99;
let stingerAt = -99;
let lastActive = -99;

/** Scan fresh effects each frame and voice them. Cheap: every sound is a filtered noise burst. */
export function updateAudio(state: GameState, ui: UiState, dt: number): void {
  if (!ctx || muted) return;
  const now = performance.now() / 1000;
  let shots = 0;
  for (const e of state.effects) {
    if (seen.has(e)) continue;
    seen.add(e);
    if (e.kind === 'tracer') {
      // distant small-arms crackle: cap the rate so mass fire reads as texture, not clipping
      if (shots < 4 && now - lastShotAt > 0.02) {
        shots++;
        lastShotAt = now;
        noiseBurst(0.10 * attenuate(ui, e.a), 0.05 + Math.random() * 0.05, 1600, 1.4);
      }
    } else if (e.kind === 'rocket') {
      noiseBurst(0.22 * attenuate(ui, e.a), 0.35, 700, 0.8, 500); // whoosh
    } else if (e.kind === 'impact') {
      noiseBurst(0.28 * attenuate(ui, e.pos), 0.30, 240, 0.9, 170); // crump
    } else if (e.kind === 'explosion') {
      const a = attenuate(ui, e.pos);
      noiseBurst(0.5 * a, 0.8, 130, 0.7, 90); // brew-up boom
      noiseBurst(0.3 * a, 1.2, 500, 0.4, 380);
    } else if (e.kind === 'death') {
      if (Math.random() < 0.25) noiseBurst(0.06 * attenuate(ui, e.pos), 0.08, 900, 1.2);
    }
  }
  // napalm roar while any strip burns on screen
  for (const f of state.fires) {
    if (f.delay <= 0 && Math.random() < dt * 6) noiseBurst(0.12 * attenuate(ui, f.a), 0.25, 420, 0.5);
  }
  // garrison-under-attack alarm (own side), at most every 6s
  const t = state.time;
  if (t - alarmAt > 6 && state.garrisons.some((g) => g.side === ui.player && g.state === 'active' && g.disabled)) {
    alarmAt = t;
    tone(0.15, 660, 0.12); setTimeout(() => tone(0.15, 520, 0.16), 140);
  }
  // front-moved stinger
  if (lastActive === -99) lastActive = state.active;
  if (state.active !== lastActive && t - stingerAt > 2) {
    stingerAt = t;
    const good = state.active > lastActive === (ui.player === 'US');
    tone(0.16, good ? 392 : 330, 0.14, 'triangle');
    setTimeout(() => tone(0.16, good ? 523 : 262, 0.2, 'triangle'), 150);
    lastActive = state.active;
  }
}
