# TACMAP — Design Bible
### Working title: *Tacmap* (lo-fi HLL-Vietnam commander duel)

**Version 1.0 — August 2026**
**Stack: TypeScript + Vite + Canvas 2D (no frameworks, no assets — everything drawn in code)**

---

## 1. One-Paragraph Pitch

Two commanders face off over a top-down tactical map styled after Hell Let Loose: Vietnam's map screen. Soldiers are dots. Nobody aims a rifle. All player skill lives in the commander layer: drafting your force with a fixed War Bond budget, placing and protecting a tiny number of precious garrisons, issuing attack/defend markers to AI squads, and spending resource income on abilities (recon, strafing runs, artillery, supply). Squads fight their own firefights — stopping at engagement range, using cover, suppressing, flanking — while you play the real-time chess match above them. Lose all your garrisons and all your squads and you lose the war.

---

## 2. Design Pillars

1. **Commander, not general.** The player never steers a dot. Intent only: spawn placement, markers, abilities, economy. If a feature requires micro, cut it.
2. **Spawns are the strategy.** Ported straight from HLL: the fight is won by where troops *appear*, not how they shoot. Garrisons are scarce, expensive, permanent losses. OPs are cheap, automatic, fragile.
3. **Firefights, not mosh pits.** Dots stop, shoot, suppress, and use cover. Two squads meeting produces a front line with a gap, tracers across it, and a stalemate that breaks only via flank, armor, or ability.
4. **Readable at a glance.** Everything is dots, rectangles, lines, and flat terrain colors. A spectator should understand the state of the battle in three seconds.
5. **Simple to play, hard to master.** Few verbs, deep consequences. (House philosophy.)

---

## 3. Match Structure

### 3.1 Mode
Offensive mode, mirroring the An Cuong screenshots: a single lane of **5 capture points** in sequence. Attacker (US) must capture all 5 before the timer expires; Defender (PAVN) wins by holding any point at time-out. Only the current active point is contestable; points behind the front are locked.

- **Match length:** 15:00 default (tuning knob). Capturing a point adds +3:00.
- **v1 opponent:** hotseat is not viable for real-time; v1 ships **player vs. scripted commander AI** (see §10). Architecture keeps both commanders symmetric so PvP (WebRTC/socket) can come later.

### 3.2 Pre-Match: The Draft
Before deployment, both commanders spend an identical **War Bond** budget (default **1000 WB**) on force composition, within hard caps:

| Unit | Cost (WB) | Cap | Notes |
|---|---|---|---|
| Infantry Squad (6 dots) | 100 | 6 total squad slots | Baseline unit |
| AT Infantry Squad (6 dots) | 150 | counts vs. 6 | Carries AT weapon: can damage armor |
| Recon Squad (4 dots) | 125 | counts vs. 6 | Wider vision radius, weaker in fights |
| Tank (1 unit) | 250 | 2 armor max | Immune to small arms; killed by AT/artillery |
| Artillery Battery (static) | 200 | 1 max | Off-map style: fires at marked zones, limited shells |

Unspent WB carries into the match as starting currency for abilities/garrisons. Symmetric budget, asymmetric builds — comp choice is the first strategic decision.

### 3.3 Loss Conditions (either ends the match instantly)
- **Attacker:** captures point 5 → wins.
- **Defender:** holds any point at 0:00 → wins.
- **Annihilation (either side):** a side with **zero garrisons AND zero living squads** loses immediately — no way to project force. The "hunt the last garrison" endgame is intended drama.

---

## 4. The Map

### 4.1 Structure
- Fixed 1200×800 logical canvas, lettered grid overlay (A–J × 1–8) for flavor/callouts, HLL-style.
- **5 capture points** on a west→east lane, each a circle (radius ~60px) with a sector band around it.
- **HQ zones** at each map edge: indestructible ultimate-fallback spawn *only while you still own ≥1 garrison or squad* (it is NOT a garrison and does not prevent the annihilation loss).

### 4.2 Terrain (flat color regions, painted in code)
| Terrain | Color language | Movement | Cover | Concealment |
|---|---|---|---|---|
| Open ground / paddy | tan/khaki | 100% | none | none |
| Woods / jungle | dark green | 70% | +damage reduction | **hides units from territory vision** |
| Village / buildings | gray blocks | 85% | +damage reduction | hides units |
| River | blue | impassable except at fords/bridges | — | — |
| Roads | pale lines | 120% (vehicles only) | none | none |

Terrain layout **is** the level design. Ship map v1 ("An Cuong-alike"): a river cutting the lane with 2 bridges + 1 ford, a wooded corridor along the north flank (the infiltration highway), open paddies mid-lane, a village cluster on points 2 and 4.

---

## 5. Vision & Fog of War

- Each side owns **territory**: everything behind your side of the active point's sector line.
- **In your territory:** enemy units in *open* terrain are visible automatically. Enemy units in woods/buildings are hidden.
- **In enemy territory:** you see nothing except what your units spot (each dot has a vision radius, ~120px; recon squads ~200px).
- **Recon ability** (see §8) reveals everything — including concealed units — in a radius for a duration.
- Enemy garrisons/OPs follow the same rules: hidden in cover, visible if in the open inside your territory or inside your units' vision.
- Last-known-position ghosts: when a spotted unit breaks contact, draw a fading outline for 5s. Cheap, hugely readable.

---

## 6. Spawning — The Heart of the Game

### 6.1 Garrisons
- Start of match: **3 garrisons** per side, placed by the player during a 60-second setup phase (anywhere in own territory, ≥100px from a capture point).
- **Permanent loss when destroyed.** An enemy dot within 50px disables the garrison (no spawns); if the enemy holds proximity for 10s, it's destroyed.
- Replacements are bought as a commander ability: **300 WB + cooldown 2:00**, placed in own territory only. Painfully expensive on purpose — a garrison should feel like a rook.
- Garrisons may be **redeployed** (picked up and moved) for a smaller cost (75 WB) with a 30s "packing" delay during which they're inert and vulnerable. This is the conservative-play valve: reposition rather than lose it.
- Spawn wave: dead squad members respawn at the squad's active spawn in waves every 20s, gated by Manpower (see §7).

### 6.2 Outposts (OPs)
- Each squad **auto-drops its own OP** on a timer: whenever the squad has been stationary-or-slow near its marker and out of combat for 15s, its OP relocates to the squad's position. One OP per squad, always updating — mirrors HLL SLs replacing OPs as they push.
- **Enemy touch deletes an OP instantly** (any enemy dot within 30px). No damage step. Gone.
- A squad whose OP is gone respawns at the **nearest owned garrison** (or HQ if none). This creates the intended rhythm: push on OPs → forward position collapses → fall back to the precious garrison → rebuild.

### 6.3 Why this economy works (design note)
HLL garrisons are cheap because human players do risky work to build them. With AI dots, scarcity must come from the commander economy instead: 3 lives, expensive replacements, redeploy-or-lose decisions. The OP layer keeps the *tempo* aggressive while garrisons stay conservative.

---

## 7. Resources & Income

Three pools, HLL-style, plus War Bonds as the master currency:

| Resource | Earned | Spent on |
|---|---|---|
| **War Bonds** | +10/min base from HQ (even when losing — the pressure-release valve); +15/min per held capture point | Garrisons, redeploys, premium abilities |
| **Munitions** | +50/min, +25/min per held point | Strafing run, artillery shells, bombardment |
| **Manpower** | +50/min, +25/min per held point | Respawn waves draw from Manpower (5 per soldier). Empty pool = respawns pause. This caps reinforcement rate — no zerging. |
| **Fuel** | +50/min, +25/min per held point | Tank respawn (expensive, 1 per match per tank slot), supply drop |

All numbers are tuning knobs; keep them in one `config.ts`.

---

## 8. Commander Abilities (the Orders panel)

Right-side panel of ability cards with cost + cooldown, visually cribbed from the HLL Orders UI in the reference screenshots.

| Ability | Cost | Cooldown | Effect |
|---|---|---|---|
| **Recon Flight** | 150 Mun | 2:00 | Reveal all units (incl. concealed) in 200px radius for 30s |
| **Strafing Run** | 300 Mun | 4:00 | Line attack, heavy damage to infantry in the open, halved by cover |
| **Artillery Barrage** | 250 Mun | 3:00 | Area shells over 10s; damages everything, cracks suppression stalemates, can hit spawns |
| **Supply Drop** | 100 Fuel | 1:30 | Required within 75px to *place* a new garrison (bought garrisons need supplies — ties the two systems together) |
| **New Garrison** | 300 WB | 2:00 | Place on a supplied location in own territory |
| **Redeploy Garrison** | 75 WB | 1:00 | Pack (30s inert) and move an existing garrison |

Defender gets a flavor swap (e.g., Ambush Trap instead of Strafing Run) in v2; v1 keeps both sides identical for balance sanity.

---

## 9. Combat Model — Making Firefights Read as Firefights

The anti-mosh-pit rules. Five mechanics, all cheap to implement:

### 9.1 Engagement range & stopping
A dot that spots an enemy within weapon range **halts, faces, and fires**. Movement resumes only when no target is in range. Ranges: infantry ~80px, AT ~90px vs. armor, tank ~150px, artillery map-wide (marked zones only). Firing draws a brief tracer line + muzzle flash pixel. **This one rule creates front lines** — two squads stop with a gap between them and trade fire across it.

### 9.2 Cover
In woods/buildings: incoming hit chance −40%, damage −30% (knobs). AI prefers to stop *inside* cover at the edge facing the enemy. Attackers crossing open ground toward covered defenders get punished — the HLL open-field push, reproduced.

### 9.3 Suppression
Each incoming near-miss/hit adds suppression (decays over 3s). Suppressed dots: fire rate −50%, accuracy −50%, move speed −50% at max. **Suppression is what makes fights last** — mutual suppression = stalemate, broken only by:
- **Flanking:** fire from a second bearing ≥60° off the defender's facing ignores the cover bonus. Two squads, one pinning frontal, one swinging through woods = combined arms from three rules.
- **Armor arriving** (immune to small-arms suppression).
- **A commander ability** landing.

### 9.4 Counters (rock-paper-scissors)
- Infantry beat infantry via cover/flanks.
- Tanks: immune to small arms, delete infantry in the open, poor vs. concealed infantry in woods (spotting penalty), killed by AT squads and artillery.
- Artillery kills everything slowly and is blind without spotters — pairs with recon.

### 9.5 Casualties, not wipes
Squads are 6 individual dots with individual HP. Dead dots respawn in waves (§6.1) at the squad's spawn while Manpower lasts. Attrition is visible: you can watch a defense thin out and time the push. A "squad" is *dead* (for the annihilation condition) only when all members are dead **and** it has no valid spawn or Manpower to return.

---

## 10. Squad AI & the Enemy Commander

### 10.1 Squad AI (both sides — identical)
State machine per squad: `MOVING → ENGAGING → SUPPRESSED → FALLBACK`.
- Path toward current marker (attack or defend) with simple flow-field or waypoint A* over a coarse grid; prefer cover tiles when a route through them costs <30% extra.
- Attack marker: advance, engage on contact, resume when clear.
- Defend marker: occupy nearest cover within 100px of marker, hold facing toward likely threat (toward enemy territory), engage anything in range.
- No marker: defend current position.

### 10.2 Enemy commander AI (v1, scripted-priority, not fancy)
Evaluate every 5s against a priority list: (1) keep 2 squads on the active point; (2) send 1 squad through the concealment corridor toward the enemy rear if one exists; (3) buy recon when contact is lost; (4) buy garrison when down to 1; (5) fire strafing/artillery at the largest visible enemy cluster; (6) redeploy rear garrisons forward as the front moves. Difficulty = tighter timers + bigger starting WB, never map hacks. AI respects fog of war (only acts on what its side can see).

---

## 11. Presentation

- Dots: 6px circles, blue (US) vs. red (PAVN), white ring = squad leader (the OP carrier). Tanks: 14×10 rectangles. Garrisons: house-shaped glyph; OPs: small triangle.
- Markers: chevron flags (attack = solid, defend = outlined), draggable.
- HUD: top bar = timer, point capture strip (the lock chain from the screenshots), resource readouts with /min income; right panel = Orders ability cards; bottom = squad roster chips showing members alive/spawn status.
- Tracers, muzzle flashes, suppression indicator (small "pinned" chevrons above dots), capture progress ring, garrison-under-attack pulsing alarm.
- Audio (v2): distant small-arms crackle scaling with active firefights; single alarm stinger for garrison contact.

---

## 12. Explicitly Out of Scope for v1

Online PvP, more than one map, defender-unique abilities, night/weather, campaign, replays, unit veterancy, off-map naval support. All are v2+ candidates; nothing in the v1 architecture may preclude PvP (keep both commanders behind the same interface).

---

## 13. Tuning-Knob Index

Every number in this document lives in `src/config.ts` and is a default, not a decision: match timer, WB budget, unit costs/caps, income rates, garrison count/cost/redeploy rules, OP timer/touch radius, wave timer, Manpower-per-soldier, all ranges, cover/suppression modifiers, ability costs/cooldowns, AI evaluation cadence. First playtest questions: does a lost early garrison snowball too hard (raise HQ WB trickle), and do firefights stalemate too long (lower suppression decay or cheapen artillery)?
