// Named starting setups. 'default' is the placeholder match; the others are the
// Phase 2 verification scenes from CLAUDE.md. Select with ?scenario=name.
import { CONFIG } from './config';
import { AN_CUONG } from './map/an_cuong';
import { createEmptyState, createGarrison, createSquad, type GameState, type MarkerKind, type Side, type SquadKind } from './state';
import { v, type Vec } from './vec';
import { applyDraft } from './systems/draft';

/** Pure combat test: no setup phase, no reinforcements, no garrisons. */
function combatOnly(s: GameState): void {
  s.phase = 'play';
  s.rules.income = false;
  s.rules.respawn = false;
}

function garrison(s: GameState, side: Side, x: number, y: number) { return createGarrison(s, side, sc(v(x, y))); }

// Scenario coordinates are authored on the original 1200×800 map; scale to the shipped map.
const SK = AN_CUONG.width / 1200;
const sc = (p: Vec): Vec => v(p.x * SK, p.y * SK);

function place(state: GameState, side: Side, kind: SquadKind, label: string, pos: Vec, marker?: { kind: MarkerKind; pos: Vec }) {
  pos = sc(pos);
  if (marker) marker = { kind: marker.kind, pos: sc(marker.pos) };
  const sq = createSquad(state, side, kind, label, pos);
  if (marker) sq.marker = { kind: marker.kind, pos: v(marker.pos.x, marker.pos.y) };
  return sq;
}

export const SCENARIOS: Record<string, (s: GameState) => void> = {
  /** The match. Both sides draft (human via the draft screen, the scripted AI automatically),
   *  place garrisons in setup, then play. Nothing is pre-placed. */
  default(_s) {},
  /** Match with both sides auto-drafted (AI template) and garrisons pre-placed; setup skipped. For headless tests. */
  match(s) {
    applyDraft(s, 'US', { ...CONFIG.AI_DRAFT } as Record<SquadKind, number>);
    applyDraft(s, 'PAVN', { ...CONFIG.AI_DRAFT } as Record<SquadKind, number>);
    autoPlaceUsGarrisons(s);
    garrison(s, 'PAVN', 360, 430);
    garrison(s, 'PAVN', 500, 250);
    garrison(s, 'PAVN', 700, 560);
    s.phase = 'play';
  },
  /** Playable endgame: hunt the last garrison. US has two squads and one garrison; PAVN has one squad
   *  and one garrison hidden in the south-east woods, no income. Find it and kill it before the clock runs out. */
  endgame(s) {
    s.phase = 'play';
    s.timer = 5 * 60;
    s.active = 4; // point 5 contested; 1–4 already US
    for (let i = 0; i < 4; i++) { s.points[i]!.owner = 'US'; s.points[i]!.progress = 1; }
    s.rules.income = true;
    s.res.PAVN.man = 60;
    garrison(s, 'US', 640, 420);
    garrison(s, 'PAVN', 1010, 690);
    place(s, 'US', 'infantry', 'A', v(700, 450), { kind: 'attack', pos: v(1030, 430) });
    place(s, 'US', 'recon', 'B', v(700, 480), { kind: 'attack', pos: v(900, 600) });
    place(s, 'PAVN', 'infantry', 'A', v(1000, 660), { kind: 'defend', pos: v(1000, 660) });
  },
  // ---- Phase 3 verification scenes ----
  /** A PAVN OP sits in the open near point 1; a US squad is ordered onto it. PAVN squad has no garrison → HQ fallback. */
  optouch(s) {
    s.phase = 'play';
    const p = place(s, 'PAVN', 'infantry', 'A', v(300, 520), { kind: 'defend', pos: v(300, 520) });
    p.op = sc(v(300, 520));
    garrison(s, 'PAVN', 700, 560);
    place(s, 'US', 'infantry', 'A', v(120, 520), { kind: 'attack', pos: v(300, 520) });
    place(s, 'US', 'infantry', 'B', v(120, 560), { kind: 'attack', pos: v(300, 560) });
    garrison(s, 'US', 60, 560);
  },
  /** A US squad camps a PAVN garrison: disabled at once, destroyed after 10s. */
  garrisoncamp(s) {
    s.phase = 'play';
    garrison(s, 'PAVN', 360, 430);
    garrison(s, 'PAVN', 700, 560);
    place(s, 'US', 'infantry', 'A', v(300, 600), { kind: 'attack', pos: v(360, 440) });
    garrison(s, 'US', 60, 560);
  },
  /** A PAVN squad moves through the north woods corridor inside US territory: invisible until it exits the trees. */
  hidden(s) {
    s.phase = 'play';
    s.rules.respawn = false;
    place(s, 'US', 'infantry', 'A', v(60, 400), { kind: 'defend', pos: v(60, 400) });
    garrison(s, 'US', 60, 560);
    place(s, 'PAVN', 'infantry', 'A', v(140, 60), { kind: 'attack', pos: v(140, 300) });
    garrison(s, 'PAVN', 700, 560);
  },
  /** US squads parked on every point, defenders absent → US should capture 1..5 and win. */
  win_capture(s) {
    s.phase = 'play';
    garrison(s, 'US', 60, 560); garrison(s, 'PAVN', 1150, 300);
    // p.pos is already in map coordinates; place() scales, so pass base coords
    for (const p of s.map.points) { const b = v(p.pos.x / SK, p.pos.y / SK); place(s, 'US', 'infantry', String(p.id), b, { kind: 'defend', pos: b }); }
    place(s, 'PAVN', 'infantry', 'A', v(1150, 400), { kind: 'defend', pos: v(1150, 400) });
  },
  /** Nobody does anything → PAVN wins at time-out. */
  win_timeout(s) {
    s.phase = 'play';
    s.timer = 30;
    garrison(s, 'US', 60, 560); garrison(s, 'PAVN', 1150, 300);
    place(s, 'US', 'infantry', 'A', v(45, 400));
    place(s, 'PAVN', 'infantry', 'A', v(1150, 400));
  },
  /** PAVN has one squad and no garrisons; US kills it → annihilation. */
  win_annihilate(s) {
    s.phase = 'play';
    s.rules.respawn = false;
    garrison(s, 'US', 60, 560);
    place(s, 'PAVN', 'infantry', 'A', v(700, 440), { kind: 'defend', pos: v(700, 440) });
    place(s, 'US', 'infantry', 'A', v(500, 440), { kind: 'attack', pos: v(700, 440) });
    place(s, 'US', 'infantry', 'B', v(500, 470), { kind: 'attack', pos: v(700, 470) });
    place(s, 'US', 'infantry', 'C', v(500, 410), { kind: 'attack', pos: v(700, 410) });
  },
  /** Two equal squads meet in open paddy between points 3 and 5. */
  meet(s) {
    combatOnly(s);
    place(s, 'US', 'infantry', 'A', v(640, 250), { kind: 'attack', pos: v(940, 250) });
    place(s, 'PAVN', 'infantry', 'A', v(940, 250), { kind: 'attack', pos: v(640, 250) });
  },
  /** Trench line: two US squads man a trench in the open; two PAVN squads attack frontally across open ground. */
  trenchline(s) {
    combatOnly(s);
    s.trenches.push({ side: 'US', a: sc(v(520, 210)), b: sc(v(520, 310)) });
    place(s, 'US', 'infantry', 'A', v(510, 230), { kind: 'defend', pos: v(516, 235) });
    place(s, 'US', 'infantry', 'B', v(510, 280), { kind: 'defend', pos: v(516, 285) });
    place(s, 'PAVN', 'infantry', 'A', v(700, 230), { kind: 'attack', pos: v(530, 235) });
    place(s, 'PAVN', 'infantry', 'B', v(700, 280), { kind: 'attack', pos: v(530, 285) });
  },
  /** Control for trenchline: same fight, no trench. */
  trenchline_bare(s) {
    combatOnly(s);
    place(s, 'US', 'infantry', 'A', v(510, 230), { kind: 'defend', pos: v(516, 235) });
    place(s, 'US', 'infantry', 'B', v(510, 280), { kind: 'defend', pos: v(516, 285) });
    place(s, 'PAVN', 'infantry', 'A', v(700, 230), { kind: 'attack', pos: v(530, 235) });
    place(s, 'PAVN', 'infantry', 'B', v(700, 280), { kind: 'attack', pos: v(530, 285) });
  },
  /** Dig-in: a US squad holds a defend flag in the open paddy for 30 s (entrenches), then an equal PAVN squad attacks across open ground. */
  dugin(s) {
    combatOnly(s);
    place(s, 'US', 'infantry', 'A', v(1060, 280), { kind: 'defend', pos: v(1060, 280) }); // no cover within 100px
    // attacker starts a long walk away so the defender has time to dig (≈ 1000px ≈ 25 s > DIG_IN_SECONDS)
    place(s, 'PAVN', 'infantry', 'A', v(100, 560), { kind: 'attack', pos: v(1040, 280) });
  },
  /** Numbers: two US squads vs one PAVN squad in the open — should be quick and end with a push. */
  outnumber(s) {
    combatOnly(s);
    place(s, 'PAVN', 'infantry', 'A', v(660, 440), { kind: 'defend', pos: v(660, 440) });
    place(s, 'US', 'infantry', 'A', v(920, 420), { kind: 'attack', pos: v(640, 430) });
    place(s, 'US', 'infantry', 'B', v(920, 470), { kind: 'attack', pos: v(640, 460) });
  },
  /** Numbers vs cover: three US squads vs one PAVN squad dug into the SW woods edge. */
  outnumber_cover(s) {
    combatOnly(s);
    place(s, 'PAVN', 'infantry', 'A', v(300, 560), { kind: 'defend', pos: v(300, 560) });
    place(s, 'US', 'infantry', 'A', v(480, 520), { kind: 'attack', pos: v(300, 560) });
    place(s, 'US', 'infantry', 'B', v(480, 560), { kind: 'attack', pos: v(300, 580) });
    place(s, 'US', 'infantry', 'C', v(480, 600), { kind: 'attack', pos: v(300, 600) });
  },
  /** Mirror of meet (PAVN starts west) — checks for side-order bias. */
  meet_rev(s) {
    combatOnly(s);
    place(s, 'PAVN', 'infantry', 'A', v(640, 250), { kind: 'attack', pos: v(940, 250) });
    place(s, 'US', 'infantry', 'A', v(940, 250), { kind: 'attack', pos: v(640, 250) });
  },
  /** meet with creation order swapped (east squad created first) — isolates order bias from position bias. */
  meet_order(s) {
    combatOnly(s);
    place(s, 'US', 'infantry', 'A', v(940, 250), { kind: 'attack', pos: v(640, 250) });
    place(s, 'PAVN', 'infantry', 'A', v(640, 250), { kind: 'attack', pos: v(940, 250) });
  },
  /** Vertical meeting (north vs south) in the open east paddies — checks x/y symmetry. */
  meet_ns(s) {
    combatOnly(s);
    place(s, 'US', 'infantry', 'A', v(1060, 200), { kind: 'attack', pos: v(1060, 560) });
    place(s, 'PAVN', 'infantry', 'A', v(1060, 560), { kind: 'attack', pos: v(1060, 200) });
  },
  /** Defender sits in the south-west woods; an equal attacker crosses open ground toward it. */
  woods(s) {
    combatOnly(s);
    place(s, 'PAVN', 'infantry', 'A', v(280, 600), { kind: 'defend', pos: v(280, 600) });
    place(s, 'US', 'infantry', 'A', v(520, 640), { kind: 'attack', pos: v(300, 610) });
  },
  /** Covered defender; one US squad pins frontally from the open, a second swings through the woods to flank. */
  flank(s) {
    combatOnly(s);
    place(s, 'PAVN', 'infantry', 'A', v(300, 560), { kind: 'defend', pos: v(300, 560) });
    place(s, 'US', 'infantry', 'A', v(440, 520), { kind: 'attack', pos: v(330, 550) });
    place(s, 'US', 'infantry', 'B', v(440, 720), { kind: 'attack', pos: v(295, 580) });
  },
  /** Same as flank but without the flanker — control: the frontal push alone should stall/lose. */
  frontal(s) {
    combatOnly(s);
    place(s, 'PAVN', 'infantry', 'A', v(300, 560), { kind: 'defend', pos: v(300, 560) });
    place(s, 'US', 'infantry', 'A', v(440, 520), { kind: 'attack', pos: v(330, 550) });
  },
  /** A tank rolls through two infantry squads in the open, then into an AT ambush in the trees. */
  tank(s) {
    combatOnly(s);
    place(s, 'US', 'tank', 'T', v(700, 430), { kind: 'attack', pos: v(940, 640) });
    place(s, 'PAVN', 'infantry', 'A', v(760, 470), { kind: 'defend', pos: v(760, 470) });
    place(s, 'PAVN', 'infantry', 'B', v(800, 520), { kind: 'defend', pos: v(800, 520) });
    place(s, 'PAVN', 'at', 'C', v(960, 660), { kind: 'defend', pos: v(960, 660) });
  },
  /** Perf: ~200 dots in a brawl across the mid-lane. */
  stress(s) {
    combatOnly(s);
    for (let i = 0; i < 16; i++) {
      const y = 200 + i * 28;
      place(s, 'US', i % 5 === 4 ? 'at' : 'infantry', String(i), v(420 + (i % 3) * 20, y), { kind: 'attack', pos: v(900, y) });
      place(s, 'PAVN', i % 5 === 4 ? 'at' : 'infantry', String(i), v(900 - (i % 3) * 20, y), { kind: 'attack', pos: v(420, y) });
    }
    place(s, 'US', 'tank', 'T', v(400, 450), { kind: 'attack', pos: v(900, 450) });
    place(s, 'PAVN', 'tank', 'T', v(920, 450), { kind: 'attack', pos: v(400, 450) });
  },
  /** Artillery battery at the US HQ shelling a PAVN squad holding the village at point 2. */
  arty(s) {
    combatOnly(s);
    place(s, 'US', 'artillery', 'G', v(45, 400), { kind: 'attack', pos: v(440, 330) });
    place(s, 'PAVN', 'infantry', 'A', v(440, 330), { kind: 'defend', pos: v(440, 330) });
  },
};

export function autoPlaceUsGarrisons(s: GameState): void {
  if (s.mode === 'warfare') {
    // one spawn per owned sector — the sector-wipe rule punishes clustering
    garrison(s, 'US', 60, 300); // HQ rear
    garrison(s, 'US', 290, 480); // point-1 sector
    garrison(s, 'US', 385, 295); // point-2 sector
  } else {
    garrison(s, 'US', 60, 300);
    garrison(s, 'US', 60, 520);
    garrison(s, 'US', 130, 300);
  }
}

export function createInitialState(seed: number, scenario: string = CONFIG.SCENARIO): GameState {
  const state = createEmptyState(seed, scenario);
  if (scenario === 'match' || scenario === 'default') { // full matches start with the map's standing fortifications
    const d = state.map.defenses;
    for (const w of d.wires) state.wires.push({ side: 'US', a: v(w.a.x, w.a.y), b: v(w.b.x, w.b.y), hp: CONFIG.WIRE_HP });
    for (const t of d.trenches) state.trenches.push({ side: t.side, a: v(t.a.x, t.a.y), b: v(t.b.x, t.b.y) });
    for (const b of d.bunkers) state.bunkers.push({ side: b.side, pos: v(b.pos.x, b.pos.y), hp: CONFIG.BUNKER_HP });
  }
  (SCENARIOS[scenario] ?? SCENARIOS['default']!)(state);
  return state;
}
