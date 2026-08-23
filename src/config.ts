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
  INF_HIT_CHANCE: 0.12,
  INF_DAMAGE: 20,
  RECON_DAMAGE_MULT: 0.7, // recon squads are weaker in fights
  AT_GUNNERS_PER_SQUAD: 2, // slots 1..N of an AT squad carry the AT weapon
  AT_FIRE_INTERVAL: 3.0,
  AT_HIT_CHANCE: 0.5,
  AT_DAMAGE: 150,
  TANK_MG_FIRE_INTERVAL: 0.3,
  TANK_MG_HIT_CHANCE: 0.35,
  TANK_MG_DAMAGE: 34,
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
  CAPTURE_SECONDS_PER_DOT: 60, // 1 dot of superiority captures in this long; rate scales with superiority
  CAPTURE_MAX_SUPERIORITY: 3, // superiority beyond this does not speed capture

  // ---- Spawning (bible §6) ----
  GARRISONS_AT_START: 3,
  GARRISON_MIN_POINT_DIST: 100, // px from any capture point
  GARRISON_DISABLE_R: 50, // enemy dot inside → no spawns
  GARRISON_DESTROY_SECONDS: 10, // continuous enemy presence → destroyed
  GARRISON_COST_WB: 300,
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
  WB_BASE: 10, WB_PER_POINT: 15,
  MUN_BASE: 50, MUN_PER_POINT: 25,
  MAN_BASE: 50, MAN_PER_POINT: 25,
  FUEL_BASE: 50, FUEL_PER_POINT: 25,
  START_WB: 200, // Phase 4 replaces with unspent draft budget
  START_MUN: 300,
  START_MAN: 300,
  START_FUEL: 150,

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
    letterbox: '#0b0d0f',
  },
} as const;

export type TerrainKey = keyof typeof CONFIG.TERRAIN_SPEED;
