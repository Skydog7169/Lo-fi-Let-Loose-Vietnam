// Named starting setups. 'default' is the placeholder match; the others are the
// Phase 2 verification scenes from CLAUDE.md. Select with ?scenario=name.
import { CONFIG } from './config';
import { createEmptyState, createGarrison, createSquad, type GameState, type MarkerKind, type Side, type SquadKind } from './state';
import { v, type Vec } from './vec';

/** Pure combat test: no setup phase, no reinforcements, no garrisons. */
function combatOnly(s: GameState): void {
  s.phase = 'play';
  s.rules.income = false;
  s.rules.respawn = false;
}

function garrison(s: GameState, side: Side, x: number, y: number) { return createGarrison(s, side, v(x, y)); }

function place(state: GameState, side: Side, kind: SquadKind, label: string, pos: Vec, marker?: { kind: MarkerKind; pos: Vec }) {
  const sq = createSquad(state, side, kind, label, pos);
  if (marker) sq.marker = { kind: marker.kind, pos: v(marker.pos.x, marker.pos.y) };
  return sq;
}

export const SCENARIOS: Record<string, (s: GameState) => void> = {
  /** The match: US attacks from the west HQ; PAVN defends with squads on/near point 1 and three garrisons.
   *  US garrisons are placed by the player during setup (auto-placed when setup is skipped). */
  default(s) {
    const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
    const hq = s.map.hqs.find((h) => h.side === 'US')!.rect;
    for (let i = 0; i < CONFIG.PLACEHOLDER_SQUADS_PER_SIDE; i++) {
      const y = hq.y + ((i + 1) * hq.h) / (CONFIG.PLACEHOLDER_SQUADS_PER_SIDE + 1);
      place(s, 'US', 'infantry', labels[i]!, v(hq.x + hq.w / 2, y));
    }
    place(s, 'PAVN', 'infantry', 'A', v(330, 470), { kind: 'defend', pos: v(250, 430) });
    place(s, 'PAVN', 'infantry', 'B', v(340, 300), { kind: 'defend', pos: v(330, 280) });
    place(s, 'PAVN', 'infantry', 'C', v(460, 330), { kind: 'defend', pos: v(440, 330) });
    garrison(s, 'PAVN', 360, 430);
    garrison(s, 'PAVN', 500, 250);
    garrison(s, 'PAVN', 700, 560);
    if (CONFIG.SKIP_SETUP) autoPlaceUsGarrisons(s);
  },
  /** Match with both sides' garrisons pre-placed and setup skipped. */
  match(s) {
    SCENARIOS['default']!(s);
    autoPlaceUsGarrisons(s);
    s.phase = 'play';
  },
  // ---- Phase 3 verification scenes ----
  /** A PAVN OP sits in the open near point 1; a US squad is ordered onto it. PAVN squad has no garrison → HQ fallback. */
  optouch(s) {
    s.phase = 'play';
    const p = place(s, 'PAVN', 'infantry', 'A', v(300, 520), { kind: 'defend', pos: v(300, 520) });
    p.op = v(300, 520);
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
    for (const p of s.map.points) place(s, 'US', 'infantry', String(p.id), v(p.pos.x, p.pos.y), { kind: 'defend', pos: v(p.pos.x, p.pos.y) });
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
    place(s, 'US', 'infantry', 'B', v(440, 720), { kind: 'attack', pos: v(260, 615) });
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
  garrison(s, 'US', 60, 300);
  garrison(s, 'US', 60, 520);
  garrison(s, 'US', 130, 300);
}

export function createInitialState(seed: number, scenario: string = CONFIG.SCENARIO): GameState {
  const state = createEmptyState(seed, scenario);
  (SCENARIOS[scenario] ?? SCENARIOS['default']!)(state);
  return state;
}
