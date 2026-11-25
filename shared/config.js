// All tunable game constants live here. Shared by the server and the browser.
// Units: metres, seconds (unless the name says _MS), metres/second.

export const CONFIG = {
  // ---------------------------------------------------------------- networking
  TICK_RATE: 20,            // server broadcasts per second
  SEND_RATE: 20,            // client position updates per second
  INTERP_DELAY_MS: 100,     // remote players are rendered this far in the past

  // ---------------------------------------------------------------- lobby
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 8,
  NAME_MAX_LENGTH: 16,
  COLORS: ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6'],
  COLOR_NAMES: ['Red', 'Green', 'Yellow', 'Blue', 'Orange', 'Purple', 'Cyan', 'Pink'],

  // Host-adjustable round settings: defaults and allowed ranges.
  DEFAULT_SETTINGS: {
    roundTime: 300,          // seconds of seeking (after the hiding phase)
    hideTime: 30,            // seconds of hiding phase
    tasksNeeded: 4,          // tasks a hider must finish before the exit unlocks for them
    seekerMode: 'random',    // 'random' | 'chosen'
    seekerId: null,          // used when seekerMode === 'chosen'
  },
  ROUND_TIME_RANGE: [60, 1200],
  HIDE_TIME_RANGE: [5, 120],
  TASKS_NEEDED_RANGE: [1, 10],

  // ---------------------------------------------------------------- player body
  PLAYER_RADIUS: 0.3,
  HEIGHT_STAND: 1.7,
  HEIGHT_CROUCH: 0.8,
  EYE_STAND: 1.55,
  EYE_CROUCH: 0.65,
  CROUCH_LERP: 12,          // how quickly the camera moves between eye heights

  // ---------------------------------------------------------------- movement
  WALK_SPEED: 3.6,
  SPRINT_SPEED: 6.0,
  CROUCH_SPEED: 1.6,
  SEEKER_SPEED_MULT: 1.05,  // the seeker is a touch faster
  ACCELERATION: 45,         // m/s^2 towards target velocity on the ground
  GRAVITY: 22,
  MAX_FALL_SPEED: 30,
  STEP_HEIGHT: 0.45,        // max ledge you can walk up (stairs)
  GROUND_SNAP: 0.45,        // max drop you stay glued to the floor (walking down stairs)
  STAMINA_MAX: 100,
  STAMINA_DRAIN: 28,        // per second while sprinting
  STAMINA_REGEN: 16,        // per second while not sprinting
  STAMINA_MIN_TO_SPRINT: 15,

  // ---------------------------------------------------------------- anti-cheat
  SPEED_TOLERANCE: 1.35,    // allowed multiple of the max speed between updates
  MOVE_SLACK: 0.35,         // extra metres allowed per update (jitter)
  WALL_TOLERANCE: 0.35,     // server re-simulates the move; bigger mismatch = correction
  FLY_TOLERANCE: 0.25,      // max height above ground while rising

  // ---------------------------------------------------------------- gameplay
  CATCH_DISTANCE: 1.5,      // seeker eye -> nearest point of hider body
  CATCH_FACING_DOT: 0.5,    // cos(60deg): hider must be within 60deg of where the seeker looks
  CATCH_COOLDOWN_MS: 600,
  TASK_DISTANCE: 2.0,       // max distance to a station to open its task
  EXIT_DISTANCE: 1.3,       // walk this close to the exit door to escape
  HEARTBEAT_RANGE: 8,
  END_SCREEN_MIN_MS: 1500,

  // ---------------------------------------------------------------- audio
  FOOTSTEP_RANGE: 20,
  STRIDE_WALK: 0.7,
  STRIDE_SPRINT: 0.95,
  STRIDE_CROUCH: 0.55,
  FOOTSTEP_VOL_WALK: 0.45,
  FOOTSTEP_VOL_SPRINT: 1.0,
  FOOTSTEP_VOL_CROUCH: 0.04,
  LOCAL_FOOTSTEP_VOL: 0.35,

  // ---------------------------------------------------------------- lighting
  AMBIENT_INTENSITY: 0.55,
  ROOM_LIGHT_INTENSITY: 9,
  ROOM_LIGHT_DISTANCE: 13,
  HIDER_LIGHT_INTENSITY: 1.6,
  HIDER_LIGHT_DISTANCE: 4.5,
  FLASHLIGHT_INTENSITY: 40,
  FLASHLIGHT_DISTANCE: 22,
  FLASHLIGHT_ANGLE: 0.42,   // radians (half-angle)
};

export const eyeHeight = (crouched) => (crouched ? CONFIG.EYE_CROUCH : CONFIG.EYE_STAND);
export const bodyHeight = (crouched) => (crouched ? CONFIG.HEIGHT_CROUCH : CONFIG.HEIGHT_STAND);
