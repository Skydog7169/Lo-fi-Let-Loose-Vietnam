# DECISIONS

Ambiguities resolved while building. Each is the simplest reading of the bible, behind a config knob where it makes sense.

## Phase 1

- **Every squad always has a marker.** A squad with "no marker" (bible §10.1: defend current position) is modelled as a *defend* marker at its spawn point, so every squad always has a draggable flag. Left-drag a flag = attack marker, right-drag = defend marker.
- **Cover preference in pathing** (bible §10.1 "prefer cover tiles when a route through them costs <30% extra"): A* enter-cost for a cover cell is `timeCost / WOODS_ROUTE_PREFERENCE` (1.3). A woods route is therefore chosen whenever its travel time is under 1.3× the open route's. Path smoothing never shortcuts across a cover/no-cover boundary, so a woods-hugging route stays in the woods.
- **Ford placement.** The bible asks for 2 bridges + 1 ford. Both bridges sit on roads mid-lane; the ford is hidden inside the north woods corridor so the "infiltration highway" has its own concealed crossing. The south flank has no crossing on purpose.
- **Roads are infantry-neutral** (100%) and only speed vehicles (`ROAD_VEHICLE_SPEED`), per §4.2.
- **Per-dot detours.** Formation offsets can push a dot off a bridge edge; a dot that cannot move at all re-paths itself to its current waypoint (`DETOUR_COOLDOWN_TICKS`) instead of freezing. Smoothed segments also require `PATH_CLEARANCE` px of walkable space either side.
- **Debug control of both sides** (`DEBUG_CONTROL_BOTH_SIDES`) is on for Phase 1–2 verification and must be turned off when the commander AI lands in Phase 4.
- **Extra files** beyond the prescribed layout: `src/commander.ts` (CommanderInterface + command queue), `src/map/grid.ts` (terrain raster shared by movement/vision/combat), `src/sim.ts` (tick order), `src/vec.ts`, `src/rng.ts`.
- **Headless hook.** `window.tacmap.step(n)` advances the sim deterministically without rAF (background tabs throttle rAF), used for verification scripts.

## Phase 2

- **Halt, face, fire is per dot.** A dot with a target does not move (no firing on the move). Dots following an *attack* marker keep closing on their target until it is within `ENGAGE_STOP_FRACTION` × range (and never while any enemy is inside `ENGAGE_MIN_DIST`); defend-marker dots halt where they stand. Hard `ENEMY_SEPARATION` floor between opposing dots as anti-blob insurance.
- **Target choice spreads fire:** a dot picks randomly among in-range enemies no farther than `TARGET_PICK_SLACK` × the nearest, and keeps its target while valid.
- **AT squads:** slots 1..`AT_GUNNERS_PER_SQUAD` (2) carry the AT weapon; the rest are riflemen. Only AT gunners and tanks can target armour; plain infantry ignore tanks entirely (cannot damage them).
- **Tank concealment penalty:** a tank can only target a unit in cover within `TANK_COVER_SPOT_RANGE` (60px). Side-level fog arrives in Phase 3.
- **Suppression** is per incoming shot (hit or miss), decays linearly over `SUPPRESS_DECAY_S`; vehicles immune. Squad avg above `SUPPRESS_PIN_THRESHOLD` → `SUPPRESSED` (holds position, keeps firing).
- **FALLBACK** (unspecified in the bible): pinned *and* at/below `FALLBACK_STRENGTH_FRACTION` alive → run `FALLBACK_DISTANCE` directly away from the local enemy mass, not shooting; resume the marker once suppression drops below `FALLBACK_RECOVER_SUPPRESSION`. Defend-marker squads already in cover hold instead (`FALLBACK_DEFENDERS_IN_COVER`).
- **Defend spots** prefer cover cells on the edge facing the *threat direction* (nearest enemy dot, else enemy HQ), weighted by `DEFEND_EDGE_BONUS`. Idle defenders face the threat direction.
- **Artillery battery** is a static 1-dot "squad" drafted like any unit, firing `ARTY_SHELLS` at its attack marker zone with scatter `ARTY_ZONE_R`; shells take `ARTY_FLIGHT_TIME` and splash/suppress on impact. Vision gating ("blind without spotters") is deferred to Phase 3's fog.
- **Determinism hygiene:** squads are processed in alternating order each tick, all squads scan for targets on the same ticks, and formation rings rotate with the squad's heading (spawned that way too) — each of these removed a measurable positional/ordering win bias found by the headless suite (`npm run headless -- all 200`).
- **A\*** uses a 2% heuristic weight for tie-breaking and greedy-forward string-pull smoothing; ~0.4 ms per cross-map path in Node.

## Phase 3

- **Initial ownership:** PAVN owns all 5 points; point 1 is active. The **sector line** is the vertical line midway between the last point taken (or the US HQ edge) and the active point; US territory is west of it. The active point itself sits in defender territory until captured (HLL-like).
- **Capture rate** = superiority (attacker dots − defender dots inside the circle, capped at `CAPTURE_MAX_SUPERIORITY`) / `CAPTURE_SECONDS_PER_DOT` per second; equal numbers freeze progress; defender superiority rolls it back. Captured points are locked for good (offensive mode). Artillery batteries never count.
- **Garrison threat timer** accumulates only while an enemy dot is inside `GARRISON_DISABLE_R` and resets when clear. A packing garrison is inert but still destroyable. Redeploy: garrison packs for 30s at its old spot, then re-appears at the target. Setup-phase placement is free and capped at 3; later placements cost WB and (when `GARRISON_REQUIRES_SUPPLY`) need a Phase 4 supply drop.
- **OP drop conditions:** squad centroid within `OP_NEAR_MARKER_R` of its resolved goal, centroid speed < `OP_SLOW_SPEED`, no member has a target, avg suppression < 0.2, not falling back — for `OP_DROP_SECONDS` continuously. OP lands on the leader's position.
- **Spawn choice:** OP → nearest active, non-disabled garrison → HQ (HQ only while the side still owns a garrison or has a living squad on the field). Respawned members appear around the spawn and path back to their squad's centroid (`RESPAWN_REJOIN`). Tanks do not wave-respawn (Fuel purchase, Phase 4). A whole dead squad re-paths to its marker when it comes back.
- **Annihilation:** a squad is "living" if any member is alive, or (respawn rules on) it has manpower and a valid spawn. Zero owned garrisons and zero living squads = loss.
- **Fog:** unit vision against targets in cover is reduced to `VISION_COVER_MULT` × radius (90px infantry, 150 recon); tanks additionally need `TANK_COVER_SPOT_RANGE` to *target* concealed infantry. Targeting is gated on the shooter side's `VisibleState`. Enemy muzzle flashes only draw when the shooter is visible; tracers always draw (the "contact" tell). Ghosts last `GHOST_SECONDS`.
- **Economy starts** with `START_*` pools (WB 200 until the Phase 4 draft replaces it with the unspent budget); income accrues per tick.
- Scenarios can turn off `rules.income` / `rules.respawn` so pure combat tests are not polluted by reinforcements; `npm run headless -- checks` runs the Phase 3 check suite.
- `DEBUG_CONTROL_BOTH_SIDES` is now off (enemy markers would leak through fog).
