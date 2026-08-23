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
