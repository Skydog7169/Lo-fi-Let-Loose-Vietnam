// ALL tuning knobs live here. Systems code must not contain magic numbers.
// Every value is a default, not a decision — see TACMAP_Design_Bible.md §13.

export const CONFIG = {
  // ---- Canvas / loop ----
  LOGICAL_W: 1200,
  LOGICAL_H: 800,
  TICK_HZ: 60,
  MAX_FRAME_DT: 0.25, // seconds; clamp spiral-of-death

  // ---- Camera ----
  CAM_MIN_ZOOM: 1,
  CAM_MAX_ZOOM: 4,
  CAM_WHEEL_ZOOM_STEP: 1.1, // multiplicative per wheel notch

  // ---- Map grid overlay (flavor) ----
  GRID_COLS: 10, // A–J
  GRID_ROWS: 8, // 1–8

  // ---- Pathing grid ----
  PATH_CELL: 10, // px per walkability cell
  // Squad AI prefers cover tiles when the route through them costs < this much extra time.
  WOODS_ROUTE_PREFERENCE: 1.3,
  PATH_SMOOTHING: true,
  PATH_CLEARANCE: 4,
  PATH_HEURISTIC_WEIGHT: 1.02, // slight A* tie-break (≤2% suboptimal paths, far fewer expansions) // px either side of a smoothed segment that must also be walkable
  DETOUR_COOLDOWN_TICKS: 60, // a blocked dot re-paths to its waypoint at most this often

  // ---- Terrain movement multipliers (bible §4.2) ----
  TERRAIN_SPEED: {
    open: 1.0,
    woods: 0.7,
    village: 0.85,
    river: 0, // impassable
    road: 1.0, // infantry; vehicles use ROAD_VEHICLE_SPEED
    bridge: 1.0,
    ford: 0.6,
    hq: 1.0,
  } as Record<string, number>,
  ROAD_VEHICLE_SPEED: 1.2,
  TERRAIN_IS_COVER: {
    open: false,
    woods: true,
    village: true,
    river: false,
    road: false,
    bridge: false,
    ford: false,
    hq: false,
  } as Record<string, boolean>,

  // ---- Units ----
  INFANTRY_SPEED: 45, // px/s at 100% terrain
  RECON_SPEED: 50,
  TANK_SPEED: 60,
  SQUAD_SIZE: { infantry: 6, at: 6, recon: 4, tank: 1, artillery: 1 } as Record<string, number>,
  DOT_HP: 100,
  TANK_HP: 600,
  DOT_RADIUS: 3,
  FORMATION_RADIUS: 11, // px ring around squad centre for member slots
  DOT_SEPARATION: 7, // px; same-side dots push apart below this
  DOT_SEPARATION_FORCE: 30, // px/s
  WAYPOINT_ARRIVE_R: 6,
  MARKER_ARRIVE_R: 10,

  // ---- Combat (bible §9) ----
  TARGET_SCAN_INTERVAL_TICKS: 6, // re-acquire targets ~10×/s
  INF_RANGE: 80,
  AT_RANGE_VS_ARMOR: 90,
  TANK_RANGE: 150,
  TANK_COVER_SPOT_RANGE: 60, // tanks only see concealed infantry this close (woods spotting penalty)
  INF_FIRE_INTERVAL: 0.6, // s between shots per dot
  INF_HIT_CHANCE: 0.13,
  INF_DAMAGE: 20,
  RECON_DAMAGE_MULT: 0.7, // recon squads are weaker in fights
  AT_GUNNERS_PER_SQUAD: 2, // slots 1..N of an AT squad carry the AT weapon
  AT_FIRE_INTERVAL: 2.0,
  AT_HIT_CHANCE: 0.6,
  AT_DAMAGE: 150,
  // tank: HE rounds vs infantry (area), AP vs armour. Tanks stand off — they never push/close like infantry.
  TANK_HE_FIRE_INTERVAL: 2.0,
  TANK_HE_HIT_CHANCE: 0.7, // lands on the target; a miss scatters TANK_HE_SCATTER px
  TANK_HE_SCATTER: 14,
  TANK_HE_DAMAGE: 55, // to every enemy infantry dot within TANK_HE_SPLASH_R
  TANK_HE_COVER_MULT: 0.5, // woods/buildings soak splash
  TANK_HE_SPLASH_R: 18,
  TANK_HE_SUPPRESS_R: 36,
  TANK_HE_SUPPRESS: 0.6,
  TANK_HE_FLIGHT: 0.35,
  TANK_STANDOFF_FRACTION: 0.9, // tanks hold at this × range and never close further
  TANK_GUN_FIRE_INTERVAL: 2.5,
  TANK_GUN_HIT_CHANCE: 0.6,
  TANK_GUN_DAMAGE: 150,
  // cover
  COVER_HIT_MULT: 0.6, // incoming hit chance −40%
  COVER_DMG_MULT: 0.7, // damage −30%
  FLANK_ANGLE_DEG: 60, // fire from ≥ this many degrees off the target's facing ignores cover
  COVER_SEEK_R: 24,
  ENGAGE_STOP_FRACTION: 0.8,
  ENGAGE_MIN_DIST: 40, // a closing dot never voluntarily advances while any enemy is this close
  ENEMY_SEPARATION: 12, // hard floor between opposing dots (anti-blob) // attacking dots keep closing until the target is within this × range (defenders halt at once)
  TARGET_PICK_SLACK: 1.3, // pick randomly among in-range enemies no farther than nearest × this (spreads fire)
  FALLBACK_DISTANCE: 120, // px a broken squad retreats directly away from the enemy // an engaging dot in the open steps into cover this close
  // suppression
  SUPPRESS_PER_SHOT: 0.25, // added per incoming shot (hit or near miss)
  SUPPRESS_DECAY_S: 3, // full decay time
  SUPPRESS_FIRE_MULT_MAX: 0.5, // fire rate ×(1 − 0.5·s)
  SUPPRESS_ACC_MULT_MAX: 0.5,
  SUPPRESS_SPEED_MULT_MAX: 0.5,
  SUPPRESS_PIN_THRESHOLD: 0.6, // squad avg suppression above this = SUPPRESSED (holds position)
  SUPPRESSED_TARGET_VULNERABILITY: 0.25, // hit chance vs a target × (1 + this × its suppression): pinned men are easier to hit
  // local numbers (friends vs enemies within LOCAL_RATIO_R of the squad centre)
  LOCAL_RATIO_R: 110,
  SUPERIORITY_RATIO: 1.5, // friends:enemies at/above this = superior (push); at/below 1/this = outnumbered
  SHAKEN_FIRE_MULT: 0.35, // an outnumbered + pinned ("shaken") squad fires at this fraction
  SHAKEN_HIT_BONUS: 0.5, // ...and is hit this much more often
  PUSH_STOP_FRACTION: 0.3, // superior attackers keep closing to this × range (instead of ENGAGE_STOP_FRACTION)
  OVERRUN_DIST: 26, // a shaken dot with an enemy this close is overrun (routed/killed)
  FALLBACK_ENABLED: true,
  FALLBACK_STRENGTH_FRACTION: 0.34, // pinned AND at/below this fraction alive → FALLBACK
  FALLBACK_RECOVER_SUPPRESSION: 0.2,
  FALLBACK_DEFENDERS_IN_COVER: false, // a defend-marker squad already in cover holds rather than running into the open // resume marker once avg suppression drops below this
  // artillery battery (drafted unit; static, fires at its marker zone)
  ARTY_SHELLS: 30,
  ARTY_SHELL_INTERVAL: 2.0,
  ARTY_FLIGHT_TIME: 1.5,
  ARTY_ZONE_R: 40, // shells scatter within this radius of the marker
  ARTY_SPLASH_R: 18,
  ARTY_SHELL_DAMAGE: 60,
  ARTY_SUPPRESS_R: 40,
  ARTY_SUPPRESS: 0.5,
  ARTY_HP: 300,
  // defend marker
  DEFEND_COVER_SEARCH_R: 100, // occupy nearest cover within this radius of a defend marker
  DEFEND_EDGE_BONUS: 60, // px-equivalent preference for cover cells on the edge facing the enemy
  // effects
  TRACER_TTL: 0.12,
  FLASH_TTL: 0.06,
  IMPACT_TTL: 0.5,
  DEATH_TTL: 1.5,
  MAX_EFFECTS: 600,

  // ---- Match (bible §3) ----
  MATCH_SECONDS: 15 * 60,
  CAPTURE_BONUS_SECONDS: 3 * 60,
  SETUP_SECONDS: 60,
  SKIP_SETUP: false, // overridden by ?setup=0 for quick testing

  // ---- Capture points ----
  POINT_RADIUS: 60,
  POINT_COUNT: 5,
  CAPTURE_SECONDS_PER_DOT: 45, // 1 dot of superiority captures in this long; rate scales with superiority
  CAPTURE_ROLLBACK_MULT: 0.5, // defender superiority rolls progress back at this fraction of the capture rate
  CAPTURE_MAX_SUPERIORITY: 4, // superiority beyond this does not speed capture
  ASSAULT_R: 40, // an attack flag within this of the active point = assault: dots push into the circle regardless of odds

  // ---- Spawning (bible §6) ----
  GARRISONS_AT_START: 3,
  GARRISON_MIN_POINT_DIST: 100, // px from any capture point
  GARRISON_DISABLE_R: 50, // enemy dot inside → no spawns
  GARRISON_DESTROY_SECONDS: 10, // continuous enemy presence → destroyed
  SPAWN_HUNT_R: 90, // a squad whose goal is within this of a visible enemy garrison/OP walks onto it instead
  GARRISON_COST_WB: 200,
  GARRISON_COOLDOWN: 120,
  GARRISON_REQUIRES_SUPPLY: true, // Phase 4: needs a supply drop within SUPPLY_RADIUS
  SUPPLY_RADIUS: 75,
  REDEPLOY_COST_WB: 75,
  REDEPLOY_COOLDOWN: 60,
  REDEPLOY_PACK_SECONDS: 30,
  OP_DROP_SECONDS: 15, // squad stationary near marker and out of combat this long → OP relocates to squad
  OP_NEAR_MARKER_R: 80,
  OP_TOUCH_R: 30, // enemy dot this close deletes the OP
  OP_SLOW_SPEED: 8, // px/s centroid speed below which a squad counts as stationary
  WAVE_SECONDS: 20,
  MANPOWER_PER_SOLDIER: 5,
  HQ_SPAWN_SPREAD: 30,
  RESPAWN_REJOIN: true, // respawned dots path back to their squad

  // ---- Economy (bible §7), per minute ----
  // base up / per-point down vs the bible so holding 4 points does not out-reinforce the attacker 2:1
  WB_BASE: 15, WB_PER_POINT: 15,
  MUN_BASE: 70, MUN_PER_POINT: 15,
  MAN_BASE: 80, MAN_PER_POINT: 15,
  FUEL_BASE: 70, FUEL_PER_POINT: 15,
  START_WB: 200, // Phase 4 replaces with unspent draft budget
  START_MUN: 300,
  START_MAN: 300,
  START_FUEL: 150,

  // ---- Draft (bible §3.2) ----
  DRAFT_BUDGET_WB: 1000,
  UNIT_COST: { infantry: 100, at: 150, recon: 125, tank: 250, artillery: 200 } as Record<string, number>, // artillery is no longer draftable (barrage ability only)
  SQUAD_SLOTS: 6, // infantry + at + recon together
  TANK_CAP: 2,
  ARTILLERY_CAP: 0, // batteries removed from the draft; artillery = the Barrage order
  AI_DRAFT: { infantry: 3, at: 1, recon: 1, tank: 1, artillery: 0 } as Record<string, number>, // 3×100+150+125+250 = 825 → 175 WB carried
  TANK_RESPAWN_FUEL: 150, // Fuel per tank respawn (at the HQ, on the wave)
  TANK_RESPAWNS_PER_SLOT: 99, // bible says 1; playtest wanted tanks back in the fight

  // ---- Commander abilities (bible §8) ----
  ABILITY: {
    recon: { cost: 150, pool: 'mun', cooldown: 120 },
    strafe: { cost: 300, pool: 'mun', cooldown: 240 },
    barrage: { cost: 250, pool: 'mun', cooldown: 180 },
    supply: { cost: 100, pool: 'fuel', cooldown: 90 },
    garrison: { cost: 200, pool: 'wb', cooldown: 120 },
    redeploy: { cost: 75, pool: 'wb', cooldown: 60 },
  } as Record<string, { cost: number; pool: 'wb' | 'mun' | 'man' | 'fuel'; cooldown: number }>,
  RECON_RADIUS: 200,
  RECON_DURATION: 30,
  STRAFE_MAX_LENGTH: 320,
  STRAFE_WIDTH: 22, // half-width of the beaten zone
  STRAFE_DURATION: 1.6, // seconds the run sweeps along the line
  STRAFE_DAMAGE: 80, // infantry in the open; halved by cover
  STRAFE_TANK_DAMAGE: 60,
  STRAFE_SUPPRESS: 0.8,
  STRAFE_DELAY: 2.0, // seconds from order to first rounds (the plane has to arrive)
  BARRAGE_RADIUS: 50,
  BARRAGE_SHELLS: 12,
  BARRAGE_DURATION: 10,
  BARRAGE_DELAY: 3.0,
  SUPPLY_LIFETIME: 120, // seconds a drop stays usable
  GARRISON_HP: 100, // shells: a garrison dies to a few direct hits
  SHELL_SPAWN_DAMAGE: 60,

  // ---- Dig in (playtest addition): a squad holding a defend flag, still and out of contact, entrenches ----
  DIG_IN_SECONDS: 20,
  DIG_IN_HIT_MULT: 0.65, // like cover: incoming hit chance ×, damage × (does NOT conceal)
  DIG_IN_DMG_MULT: 0.75,
  DIG_IN_MOVE_BREAK: 6, // px a dot may drift before its entrenchment is lost

  // ---- Commander AI (bible §10.2) ----
  AI_DIFFICULTY: 'normal' as 'easy' | 'normal' | 'hard', // the one knob; ?ai=easy|normal|hard overrides
  AI_DIFFICULTY_PRESETS: {
    easy: { cadence: 9, bonusWb: 0 },
    normal: { cadence: 5, bonusWb: 0 },
    hard: { cadence: 3, bonusWb: 300 },
  } as Record<string, { cadence: number; bonusWb: number }>,
  AI_CADENCE: 5, // seconds between evaluations (set from the preset at boot)
  AI_BONUS_WB: 0, // extra draft/starting WB for the AI (set from the preset at boot)
  AI_CONTACT_LOST_SECONDS: 25, // no visible enemy this long → buy recon
  AI_CLUSTER_R: 45, // radius for "largest visible enemy cluster"
  AI_CLUSTER_MIN: 4, // dots needed to justify a strike
  AI_REAR_GARRISON_DIST: 320, // a garrison this far behind the sector line gets redeployed forward
  AI_FORWARD_GARRISON_DIST: 160, // ...to about this far behind the line
  AI_POINT_SQUADS: 2, // squads kept on the active point

  // ---- Offensive-mode asymmetry (playtest): the attacker gets more bodies, like HLL offensive tickets ----
  ATTACKER_MANPOWER_MULT: 1.35,
  SPAWN_REVEAL_R: 220, // a garrison/OP that spawns troops with an enemy dot this close is revealed…
  SPAWN_REVEAL_S: 8, // …for this long (the noise of a spawn wave)
  ACTIVE_POINT_SPAWN_LOCK_R: 190, // garrisons/OPs this close to the contested point cannot spawn (both sides) — no 2-second reinforcement loops
  FIRE_REVEAL_S: 1.5, // a dot that fires is visible to the enemy this long, even in cover (tracers give it away)…
  FIRE_REVEAL_R: 260, // …if any enemy dot is this close

  // ---- Vision & fog (bible §5) ----
  VISION_INTERVAL_TICKS: 3,
  VISION_INF: 120,
  VISION_RECON: 200,
  VISION_TANK: 120,
  VISION_COVER_MULT: 0.75, // unit vision against targets in cover is reduced to this fraction
  GHOST_SECONDS: 5,
  DEBUG_REVEAL_ALL: false, // F toggles

  // ---- Placeholder forces (until the Phase 4 draft) ----
  PLACEHOLDER_SQUADS_PER_SIDE: 3,
  SCENARIO: 'default', // overridden by ?scenario= — see scenarios.ts

  // ---- Debug ----
  DEBUG_CONTROL_BOTH_SIDES: false, // dev: let the human drag both sides' markers (turn off — fog would leak)
  DEBUG_DRAW_PATHS: false,

  // ---- Palette (lo-fi flat colours) ----
  COLORS: {
    open: '#b9a97a',
    woods: '#41683a',
    village: '#8a8a86',
    villageEdge: '#55554f',
    river: '#4c7eab',
    road: '#d8ccA0',
    bridge: '#8c6f4c',
    ford: '#7da3c4',
    hq: '#b9a97a',
    grid: 'rgba(0,0,0,0.18)',
    gridLabel: 'rgba(0,0,0,0.45)',
    us: '#3c8cff',
    pavn: '#e8473c',
    usDim: 'rgba(60,140,255,0.25)',
    pavnDim: 'rgba(232,71,60,0.25)',
    leaderRing: '#ffffff',
    pointRing: '#f4f1e6',
    markerAttack: '#ffffff',
    debugPath: 'rgba(255,255,255,0.5)',
    tracerUs: 'rgba(255,240,160,0.9)',
    tracerPavn: 'rgba(120,255,140,0.9)',
    flash: '#fff6c8',
    impact: '#ffb347',
    suppressed: '#ffd23c',
    shell: '#333',
    ghost: 'rgba(255,255,255,0.55)',
    fogEnemy: 'rgba(0,0,0,0.10)',
    sectorLine: 'rgba(255,255,255,0.75)',
    garrison: '#f2e9c8',
    opGlyph: '#ffffff',
    alarm: '#ff3b2f',
    hudBg: 'rgba(10,12,14,0.82)',
    hudText: '#e8e4d8',
    hudDim: '#9a968c',
    cardBg: 'rgba(20,24,28,0.92)',
    cardEdge: '#4a5058',
    cardReady: '#8fd18f',
    cardCool: '#555c66',
    supply: '#d9b36b',
    recon: 'rgba(120,200,255,0.18)',
    strafe: '#ffb347',
    letterbox: '#0b0d0f',
  },
} as const;

export type TerrainKey = keyof typeof CONFIG.TERRAIN_SPEED;
