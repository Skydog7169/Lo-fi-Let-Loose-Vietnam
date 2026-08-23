// Scripted enemy commander (bible §10.2). Priority list evaluated every AI_CADENCE
// seconds, driven ONLY by its CommanderInterface + VisibleState (no map hacks).
// The same code can run either side, so AI-vs-AI matches are a headless test.
import { CONFIG } from '../config';
import type { CommanderInterface } from '../commander';
import type { MapData } from '../map/an_cuong';
import { isCoverAt, isWalkable, type TerrainGrid } from '../map/grid';
import { makeRng, rand, type Rng } from '../rng';
import type { Garrison, Side, Squad, SquadKind, VisibleState } from '../state';
import { dist, v, type Vec } from '../vec';

interface Plan { waypoints: Vec[]; idx: number }

export interface CommanderAi {
  readonly side: Side;
  update(time: number): void;
}

export function makeCommanderAi(side: Side, cmd: CommanderInterface, map: MapData, grid: TerrainGrid, seed: number): CommanderAi {
  const rng: Rng = makeRng(seed ^ (side === 'US' ? 0x51 : 0xa7));
  let nextEval = 0;
  let lastContact = 0;
  let drafted = false, setupDone = false;
  const plans = new Map<number, Plan>();
  let infiltratorId: number | null = null;
  let garrisonSpot: Vec | null = null;
  const dirToEnemy = side === 'US' ? 1 : -1; // +x for US

  // ---- helpers (static map knowledge is public) ----
  const pointPos = (i: number): Vec => map.points[Math.min(i, map.points.length - 1)]!.pos;

  /** Best walkable spot near `ideal` for a garrison: in own territory, ≥100px from points, cover preferred. */
  function garrisonSpotNear(vs: VisibleState, ideal: Vec, forRedeploy = false): Vec | null {
    let best: Vec | null = null, bestScore = Infinity;
    const R = 140;
    for (let dy = -R; dy <= R; dy += 20) for (let dx = -R; dx <= R; dx += 20) {
      const p = v(ideal.x + dx, ideal.y + dy);
      if (p.x < 10 || p.y < 10 || p.x > map.width - 10 || p.y > map.height - 10) continue;
      if (!isWalkable(grid, p)) continue;
      const own = side === 'US' ? p.x < vs.pub.sectorX : p.x >= vs.pub.sectorX;
      if (!own) continue;
      let nearPoint = false;
      for (const q of map.points) if (dist(q.pos, p) < CONFIG.GARRISON_MIN_POINT_DIST + 5) { nearPoint = true; break; }
      if (nearPoint) continue;
      // keep away from our other garrisons
      let crowded = false;
      for (const g of vs.own.garrisons) if (dist(g.pos, p) < 90) { crowded = true; break; }
      if (crowded && !forRedeploy) continue;
      const score = dist(p, ideal) + (isCoverAt(grid, p) ? -60 : 0) + rand(rng) * 5;
      if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  /** Ideal garrison x: `behind` px behind the sector line on our side. */
  const behindLine = (vs: VisibleState, behind: number): number => {
    const x = vs.pub.sectorX - dirToEnemy * behind;
    return Math.max(30, Math.min(map.width - 30, x));
  };

  function squadCenter(sq: Squad): Vec | null {
    return sq.lastCentroid ?? (sq.marker ? sq.marker.pos : null);
  }

  function isInfantryLike(k: SquadKind): boolean { return k === 'infantry' || k === 'at' || k === 'recon'; }

  /** Largest cluster of visible enemy dots: centre and member positions. */
  function largestCluster(vs: VisibleState): { center: Vec; n: number; members: Vec[] } | null {
    const pts = vs.enemyDots.map((d) => d.pos);
    if (pts.length < CONFIG.AI_CLUSTER_MIN) return null;
    let best: { center: Vec; n: number; members: Vec[] } | null = null;
    const R2 = CONFIG.AI_CLUSTER_R ** 2;
    for (const p of pts) {
      const members = pts.filter((q) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= R2);
      if (members.length >= CONFIG.AI_CLUSTER_MIN && (!best || members.length > best.n)) {
        const cx = members.reduce((a, q) => a + q.x, 0) / members.length, cy = members.reduce((a, q) => a + q.y, 0) / members.length;
        best = { center: v(cx, cy), n: members.length, members };
      }
    }
    return best;
  }

  /** Waypoints through the north wooded corridor toward the enemy rear. */
  function corridorPlan(vs: VisibleState): Vec[] {
    const y = 85;
    const rearX = Math.max(120, Math.min(map.width - 120, vs.pub.sectorX - dirToEnemy * 140));
    const xs = side === 'PAVN' ? [900, 700, 552, 380] : [200, 380, 552, 760];
    const wps: Vec[] = [];
    for (const x of xs) {
      // stop adding once we are past the rear target
      if (side === 'PAVN' ? x < rearX : x > rearX) break;
      wps.push(v(x, y));
    }
    wps.push(v(rearX, 110));
    return wps;
  }

  function update(time: number): void {
    const vs = cmd.getVisibleState();
    if (vs.pub.phase === 'draft') {
      if (!drafted) { cmd.draft({ ...CONFIG.AI_DRAFT } as Record<SquadKind, number>); drafted = true; }
      return;
    }
    if (vs.pub.phase === 'setup') {
      if (setupDone) return;
      const active = pointPos(vs.pub.active);
      const ideals = [
        v(behindLine(vs, 170), active.y + (rand(rng) - 0.5) * 120),
        v(behindLine(vs, 330), active.y + (rand(rng) - 0.5) * 220),
        v(behindLine(vs, 520), map.height / 2 + (rand(rng) - 0.5) * 200),
      ];
      const placed: Vec[] = [];
      for (const ideal of ideals) {
        // pretend the previously chosen spots are garrisons so we spread out
        const fakeVs: VisibleState = { ...vs, own: { ...vs.own, garrisons: [...vs.own.garrisons, ...placed.map((p, i) => ({ id: -1 - i, side, pos: p, hp: 1, revealUntil: 0, state: 'active', disabled: false, threatTimer: 0, packTimer: 0, packTarget: null }) as Garrison)] } };
        const spot = garrisonSpotNear(fakeVs, ideal);
        if (spot) { cmd.placeGarrison(spot); placed.push(spot); }
      }
      cmd.setupDone();
      setupDone = true;
      return;
    }
    if (vs.pub.phase !== 'play') return;
    if (vs.enemyDots.length) lastContact = time;
    if (time < nextEval) return;
    nextEval = time + CONFIG.AI_CADENCE;

    const active = vs.pub.active;
    const activePos = pointPos(active);
    const squads = vs.own.squads.filter((s) => s.kind !== 'artillery');
    const infantry = squads.filter((s) => isInfantryLike(s.kind));
    const onField = infantry; // all drafted squads exist (dead ones respawn)

    // ---- (2) infiltrator: one squad through the concealment corridor ----
    if (infiltratorId === null || !squads.some((s) => s.id === infiltratorId)) {
      const recon = onField.find((s) => s.kind === 'recon');
      const cand = recon ?? (onField.length > CONFIG.AI_POINT_SQUADS ? onField[onField.length - 1]! : undefined);
      if (cand) { infiltratorId = cand.id; plans.set(cand.id, { waypoints: corridorPlan(vs), idx: 0 }); }
    }
    // ---- (1) keep N squads on the active point ----
    const pointSquads = onField
      .filter((s) => s.id !== infiltratorId)
      .map((s) => ({ s, d: squadCenter(s) ? dist(squadCenter(s)!, activePos) : 9999 }))
      .sort((a, b) => a.d - b.d)
      // defender keeps AI_POINT_SQUADS on the point and screens with the rest; attacker masses everything
      // (numbers win firefights — see SUPERIORITY_RATIO), spreading squads around the point rather than stacking
      .slice(0, side === 'US' ? 99 : CONFIG.AI_POINT_SQUADS)
      .map((x) => x.s);
    const pointIds = new Set(pointSquads.map((s) => s.id));
    pointSquads.forEach((s, i) => {
      const off = v(-dirToEnemy * 30 + (i ? 0 : 10), ((i % 2 ? 1 : -1) * (35 + Math.floor(i / 2) * 30)));
      const want = side === 'US' ? { kind: 'attack' as const, pos: v(activePos.x + off.x * 0.5, activePos.y + off.y * 0.5) } : { kind: 'defend' as const, pos: v(activePos.x + off.x, activePos.y + off.y) };
      if (!s.marker || s.marker.kind !== want.kind || dist(s.marker.pos, want.pos) > 12) cmd.issueMarker(s.id, want.kind, want.pos);
    });
    // remaining infantry: attacker flanks the point from the side; defender screens the approach
    for (const s of onField) {
      if (pointIds.has(s.id) || s.id === infiltratorId) continue;
      const flankY = activePos.y + (s.id % 2 ? 110 : -110);
      const want = side === 'US'
        ? { kind: 'attack' as const, pos: v(activePos.x + 20, Math.max(30, Math.min(map.height - 30, flankY))) }
        : { kind: 'defend' as const, pos: v(activePos.x - dirToEnemy * -70, Math.max(30, Math.min(map.height - 30, flankY))) };
      if (!s.marker || s.marker.kind !== want.kind || dist(s.marker.pos, want.pos) > 12) cmd.issueMarker(s.id, want.kind, want.pos);
    }
    // tanks: attacker pushes the point along the road, defender holds behind it
    for (const s of squads) {
      if (s.kind !== 'tank') continue;
      const want = side === 'US' ? { kind: 'attack' as const, pos: v(activePos.x - 20, activePos.y) } : { kind: 'defend' as const, pos: v(activePos.x + 90, activePos.y + 20) };
      if (!s.marker || s.marker.kind !== want.kind || dist(s.marker.pos, want.pos) > 12) cmd.issueMarker(s.id, want.kind, want.pos);
    }
    // artillery battery: shell the largest visible cluster, else the active point when enemies are there
    const cluster = largestCluster(vs);
    for (const s of vs.own.squads) {
      if (s.kind !== 'artillery') continue;
      const tgt = cluster ? cluster.center : vs.enemyDots.some((d) => dist(d.pos, activePos) < CONFIG.POINT_RADIUS) ? activePos : null;
      if (tgt && (!s.marker || s.marker.kind !== 'attack' || dist(s.marker.pos, tgt) > 20)) cmd.issueMarker(s.id, 'attack', tgt);
      if (!tgt && s.marker && s.marker.kind === 'attack') cmd.issueMarker(s.id, 'defend', s.marker.pos); // hold fire
    }
    // infiltrator plan: advance waypoints; at the end, hit a visible rear spawn or hold in the trees
    if (infiltratorId !== null) {
      const s = squads.find((q) => q.id === infiltratorId);
      const plan = plans.get(infiltratorId);
      if (s && plan) {
        const c = squadCenter(s);
        let target = plan.waypoints[plan.idx]!;
        if (c && dist(c, target) < 50 && plan.idx < plan.waypoints.length - 1) { plan.idx++; target = plan.waypoints[plan.idx]!; }
        const atEnd = plan.idx >= plan.waypoints.length - 1;
        let want: { kind: 'attack' | 'defend'; pos: Vec } = { kind: 'attack', pos: target };
        if (atEnd) {
          const rearSpawn = [...vs.enemyGarrisons.map((g) => g.pos), ...vs.enemyOps.map((o) => o.pos)]
            .filter((p) => side === 'US' ? p.x > vs.pub.sectorX : p.x < vs.pub.sectorX)
            .sort((a, b) => dist(a, c ?? target) - dist(b, c ?? target))[0];
          want = rearSpawn ? { kind: 'attack', pos: rearSpawn } : { kind: 'defend', pos: target };
        }
        if (!s.marker || s.marker.kind !== want.kind || dist(s.marker.pos, want.pos) > 12) cmd.issueMarker(s.id, want.kind, want.pos);
      }
    }
    // ---- (3) recon when contact is lost ----
    if (time - lastContact > CONFIG.AI_CONTACT_LOST_SECONDS && vs.own.cooldowns.recon <= 0 && vs.own.res.mun >= CONFIG.ABILITY.recon!.cost) {
      const ghost = vs.ghosts[vs.ghosts.length - 1];
      const at = ghost ? ghost.pos : v(activePos.x - dirToEnemy * 60, activePos.y);
      cmd.buyAbility('recon', at);
      lastContact = time; // don't spam
    }
    // ---- (4) garrison when down to 1 ----
    if (vs.own.garrisons.length <= 1 && vs.own.cooldowns.garrison <= 0 && vs.own.res.wb >= CONFIG.ABILITY.garrison!.cost) {
      const ideal = v(behindLine(vs, CONFIG.AI_FORWARD_GARRISON_DIST), activePos.y);
      if (!garrisonSpot) garrisonSpot = garrisonSpotNear(vs, ideal);
      if (garrisonSpot) {
        const suppliedHere = vs.own.supplies.some((sp) => dist(sp.pos, garrisonSpot!) <= CONFIG.SUPPLY_RADIUS);
        if (suppliedHere) { cmd.buyAbility('garrison', garrisonSpot); garrisonSpot = null; }
        else if (vs.own.cooldowns.supply <= 0 && vs.own.res.fuel >= CONFIG.ABILITY.supply!.cost) cmd.buyAbility('supply', garrisonSpot);
      }
    } else garrisonSpot = null;
    // ---- (5) strike the largest visible cluster ----
    if (cluster) {
      if (vs.own.cooldowns.barrage <= 0 && vs.own.res.mun >= CONFIG.ABILITY.barrage!.cost) cmd.buyAbility('barrage', cluster.center);
      else if (vs.own.cooldowns.strafe <= 0 && vs.own.res.mun >= CONFIG.ABILITY.strafe!.cost) {
        // run along the cluster's longest axis
        let a = cluster.members[0]!, b = cluster.members[0]!, best = -1;
        for (const p of cluster.members) for (const q of cluster.members) { const d = dist(p, q); if (d > best) { best = d; a = p; b = q; } }
        if (best < 20) { a = v(cluster.center.x - 60, cluster.center.y); b = v(cluster.center.x + 60, cluster.center.y); }
        else { const ex = (b.x - a.x) / best * 60, ey = (b.y - a.y) / best * 60; a = v(a.x - ex, a.y - ey); b = v(b.x + ex, b.y + ey); }
        cmd.buyAbility('strafe', a, b);
      }
    }
    // ---- (6) redeploy rear garrisons forward ----
    if (vs.own.cooldowns.redeploy <= 0 && vs.own.res.wb >= CONFIG.ABILITY.redeploy!.cost) {
      const rear = vs.own.garrisons
        .filter((g) => g.state === 'active' && (side === 'US' ? vs.pub.sectorX - g.pos.x : g.pos.x - vs.pub.sectorX) > CONFIG.AI_REAR_GARRISON_DIST)
        .sort((a, b) => dist(b.pos, activePos) - dist(a.pos, activePos))[0];
      if (rear) {
        const spot = garrisonSpotNear(vs, v(behindLine(vs, CONFIG.AI_FORWARD_GARRISON_DIST), activePos.y + (rand(rng) - 0.5) * 160), true);
        if (spot && dist(spot, rear.pos) > 120) cmd.buyAbility('redeploy', spot, undefined, rear.id);
      }
    }
  }

  return { side, update };
}

