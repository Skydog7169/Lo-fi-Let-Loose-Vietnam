# TACMAP — Claude Code Build Prompt (CLAUDE.md)

Paste this file into the project root as `CLAUDE.md`. Keep `TACMAP_Design_Bible.md` alongside it — the bible is the source of truth for *why*; this file is the source of truth for *what to build and in what order*.

---

## Project

**Tacmap** — a lo-fi, top-down, real-time commander duel inspired by Hell Let Loose: Vietnam's tactical map. Two commanders (player vs. scripted AI in v1) fight over a 5-point offensive lane. All units are AI dots; the player only drafts forces, places spawns, drags attack/defend markers, and fires commander abilities. See the design bible for full rules.

## Stack & Standards

- **TypeScript (strict), Vite, Canvas 2D.** No frameworks, no game engines, no image/audio assets in v1 — everything is drawn with canvas primitives.
- Fixed logical resolution **1200×800**, letterboxed scaling to window. All game coordinates in logical space.
- Fixed-timestep simulation (60 Hz) decoupled from render. Deterministic given a seed — required for future PvP lockstep.
- **All numeric values in `src/config.ts`** — no magic numbers in systems code. Every value from the bible's tuning-knob index goes here.
- Entity data as plain objects in typed arrays/maps; systems as pure-ish functions over game state. No deep class hierarchies.
- **Both commanders sit behind the same `CommanderInterface`** (issue marker, buy ability, place garrison). The human's UI and the scripted AI both drive the sim only through this interface. Nothing may break this — it is the door to future PvP.
- Fog of war enforced at the *interface* level: each commander receives a filtered `VisibleState`, and the AI may only read its own `VisibleState`. No map hacks, even accidentally.

## File Layout

```
src/
  main.ts            // boot, canvas, loop
  config.ts          // ALL tuning knobs
  state.ts           // GameState types + factory
  map/an_cuong.ts    // terrain regions, points, HQs, grid labels (data, not art)
  systems/
    movement.ts      // pathing over coarse grid, terrain speed
    vision.ts        // territory vision, unit vision, concealment, ghosts
    combat.ts        // engagement, cover, suppression, flanking, counters
    spawning.ts      // garrisons, OPs, waves, manpower gate
    capture.ts       // point control, sector line, timer
    economy.ts       // WB/Mun/Man/Fuel income + spend
    abilities.ts     // orders panel effects
    squad_ai.ts      // per-squad state machine
    commander_ai.ts  // scripted enemy commander (priority list)
  ui/
    hud.ts           // top bar, capture strip, resources
    orders.ts        // ability cards panel
    roster.ts        // squad chips
    input.ts         // marker drag, placement modes, camera
  render/
    draw.ts          // terrain, units, tracers, markers, fog
```

## Build Phases

Do the phases in order. **Each phase must run in the browser and be visually verifiable before starting the next.** At the end of each phase, list what was built, how to verify it, and any deviations from this prompt.

### Phase 1 — Map, dots, movement
- Canvas boot, fixed timestep, camera pan/zoom (mouse drag + wheel).
- Render the An Cuong-alike map from data: terrain regions (open tan, woods green, village gray blocks, river blue with 2 bridges + 1 ford, roads), 5 capture-point circles, grid overlay with letters, HQ zones.
- Spawn placeholder squads (6 dots, leader ringed) for both sides. Click-drag an attack marker; squads path to it over a coarse walkability grid (A*), respecting terrain speed and the impassable river. Woods-preference routing per bible §10.1.
- **Verify:** dots route around the river via bridges, slow down in woods, and reach dragged markers.

### Phase 2 — Combat & firefights
- Implement bible §9 in full: engagement-range stop-and-fire, tracers + muzzle flashes, per-dot HP, cover modifiers, suppression with decay and its accuracy/speed penalties, flanking bearing check, tank rules (small-arms immunity, AT damage, woods spotting penalty), artillery zone fire.
- Squad state machine (`MOVING/ENGAGING/SUPPRESSED/FALLBACK`), defend-marker cover-seeking behavior.
- **Verify:** two squads meeting in open ground stop at a gap and trade fire; a squad in woods beats an equal squad crossing open ground; a frontal-pin + woods-flank kills a covered defender; a tank massacres open infantry and dies to an AT squad ambush from trees. **The mosh-pit test: at no point should opposing dots overlap into a blob.**

### Phase 3 — Spawning, capture, economy, fog
- Garrisons: setup-phase placement (3 each), disable radius, 10s destroy timer, permanent loss, redeploy packing state. OPs: per-squad auto-drop/update on the bible's timer, instant delete on enemy touch, fallback-to-garrison respawn logic. Wave respawns gated by Manpower.
- Capture: active-point contest by dot-count superiority in the circle, progress ring, sector line moves on capture, +3:00 timer, lock chain in HUD.
- Economy: all four pools with base + per-point income; HUD readouts with /min.
- Fog of war per bible §5, including territory-vision-except-concealment, unit vision radii, last-known ghosts, and enemy spawn visibility rules. Build the `VisibleState` filter now.
- Win/loss: attacker point-5 win, defender timeout win, annihilation rule.
- **Verify:** touching an OP deletes it and the squad falls back to a garrison; camping a garrison for 10s destroys it permanently; a hidden squad in the wooded corridor is invisible inside your territory until it exits the trees; match ends correctly on all three conditions.

### Phase 4 — Draft, orders panel, commander AI, game feel
- Pre-match draft screen: 1000 WB budget, unit table with costs/caps from config, unspent WB carries in. Setup phase for garrison placement follows the draft.
- Orders panel (right side, HLL-style cards): all six abilities from bible §8 with costs, cooldown sweeps, placement/targeting modes (line for strafing, circle for barrage/recon, point for supply/garrison).
- Scripted commander AI per bible §10.2 — priority list on a 5s cadence, driven only by its `VisibleState`, using the same `CommanderInterface` as the player. One difficulty knob set in config.
- Game feel pass: capture ring pulse, garrison-under-attack alarm pulse, suppression chevrons, roster chips with alive-count and spawn status, end screen with basic stats (points held time, casualties, garrisons lost).
- **Verify:** a full match is playable and losable start to finish against the AI; the AI infiltrates the wooded corridor and punishes an undefended flank; the annihilation "hunt the last garrison" endgame is reachable and dramatic.

## Definition of Done (v1)

A stranger can open the game, draft a force, place three garrisons, and play a complete 15-minute match against the AI where: firefights visibly stop-and-shoot with tracers and suppression, the wooded flank matters, losing a garrison hurts, and all three end conditions work. Deterministic sim behind a seed. Zero assets, zero frameworks, all knobs in `config.ts`.

## Style Rules for the Agent

- Small commits per system with plain-English messages.
- When a bible rule is ambiguous, choose the simplest interpretation, implement it behind a config flag, and note the decision in `DECISIONS.md` rather than asking.
- Never add features not in this prompt; park ideas in `IDEAS.md`.
- Performance target: 200 dots + effects at 60fps on a mid laptop; profile before optimizing.
