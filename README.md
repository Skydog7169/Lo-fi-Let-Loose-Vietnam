# TACMAP

Lo-fi top-down commander duel (HLL: Vietnam tactical map, as a game). See `TACMAP_Design_Bible.md` for the design and `CLAUDE.md` for the build plan.

```bash
npm install
npm run dev       # http://localhost:5174
npm run build     # typecheck + production build
```

**How to play:** draft a force (1000 WB), place 3 garrisons in your territory during setup (`G` + click, Enter when ready), then command: left-drag a squad (its dots or its flag) and drop = attack order, right-drag = defend; left-drag a garrison to move it (free during setup; 75 WB + 30 s packing in play); click an Orders card (or keys `1–6`) and click the map to fire recon / strafing (two clicks: line) / barrage / supply drop / new garrison / redeploy; click a roster chip to find a squad. Capture all five points before the clock runs out; lose every garrison and every squad and you lose.

Other keys: drag map = pan; wheel = zoom; `F` = reveal fog (debug); `P` = paths; `R` = reset camera; `Esc` cancels a placement.

URL params: `?scenario=<name>` (see `src/scenarios.ts`; `endgame` is the hunt-the-last-garrison finale), `?seed=<n>`, `?setup=0` (1-second setup with auto-placed garrisons), `?ai=easy|normal|hard`.

Dev: `tacmap.step(n)` in the console advances the sim `n` ticks deterministically; `npm run headless -- all|checks|aimatch|infiltrate|perf|<scenario>` runs the Node verification suites (combat scenarios, Phase 3 checks, AI-vs-AI matches, AI infiltration, performance).
