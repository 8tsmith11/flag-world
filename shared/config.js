// Shared constants used by both server and client.
// Changing anything here affects simulation on both sides, so keep them in sync
// by only ever reading from this module.

// Shows an FPS counter and player coordinates on screen.
export const DEBUG = true;

export const PORT = 3000;

// World height in blocks. The X/Z size depends on the match's player count
// (see worldSize in worldgen.js).
export const WORLD_SIZE_Y = 32;
// X/Z size in chunks: a base plus one per player, capped.
export const WORLD_BASE_CHUNKS = 4;
export const WORLD_MAX_CHUNKS = 16;

// Chunks are cubes of CHUNK_SIZE blocks.
export const CHUNK_SIZE = 16;

// Client view distance in blocks (horizontal): chunks further away aren't
// meshed, and fog hides the edge. Players can change it within the range.
export const VIEW_DISTANCE = 160;
export const VIEW_DISTANCE_MIN = 64;
export const VIEW_DISTANCE_MAX = 320;

export const WATER_LEVEL = 12;

// Simulation runs at a fixed rate. Every client input represents exactly one tick.
export const TICK_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;

// Player physics (blocks, seconds).
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE_HEIGHT = 1.62;
export const WALK_SPEED = 4.3;
export const JUMP_VELOCITY = 8.4;
export const GRAVITY = 28;
export const TERMINAL_VELOCITY = 50;
export const SWIM_GRAVITY_SCALE = 0.25;
export const SWIM_UP_SPEED = 3;
export const SWIM_SPEED_SCALE = 0.6;
// Upward speed when jumping at the water surface: the smallest value (tuned at
// 20 Hz) that reliably lifts the feet above the surface, so you can climb onto
// shore blocks level with the water.
export const SWIM_EXIT_VELOCITY = 4;
// Crouching (Shift): walking speed scale (multiplies with carrying a flag),
// collision height (fits under 1.5 blocks), how far the eyes drop, and the
// biggest drop edge protection lets a crouched player walk off.
export const CROUCH_SPEED_SCALE = 0.3;
export const CROUCH_HEIGHT = 1.45;
export const CROUCH_EYE_DROP = 0.3;
export const CROUCH_MAX_DROP = 1;
// Towering: a player in the air may place a block in the cell their feet are
// in once they're at least this far up it; they're lifted on top of it.
export const TOWER_MIN_HEIGHT = 0.5;
// Ladders: climbing speed up or down (blocks/s).
export const CLIMB_SPEED = 3;

// Server drops queued inputs beyond this so a stalled client can't burst-move.
export const MAX_QUEUED_INPUTS = 10;

// Block interaction. Reach is measured from the eyes.
export const REACH_DISTANCE = 5;
// Tool strength of an empty hand; a block breaks only if strength >= its hardness.
export const HAND_STRENGTH = 1;

// Inventory: the hotbar is slots 0-8, the main grid the 27 after it.
export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36;
export const MAX_STACK = 64;

// Dropped items. Sizes in blocks, times in seconds, speeds in blocks/s.
export const ITEM_SIZE = 0.25;
export const ITEM_PICKUP_RADIUS = 1.5;
export const ITEM_DESPAWN_TIME = 300;
// Before an item can be picked up: a short beat for block drops so the pop is
// visible, longer for thrown items so they leave the thrower's pickup radius.
export const ITEM_PICKUP_DELAY = 0.5;
export const ITEM_THROW_PICKUP_DELAY = 2;
export const ITEM_THROW_SPEED = 6;
export const ITEM_POP_SPEED = 4;
// Per-tick velocity multipliers on X/Z.
export const ITEM_AIR_DRAG = 0.98;
export const ITEM_GROUND_FRICTION = 0.6;

// Combat. Times in seconds, speeds in blocks/s.
export const MAX_HP = 20;
export const REGEN_DELAY = 5;
export const REGEN_INTERVAL = 1;
export const ATTACK_DAMAGE = 2;
export const ATTACK_COOLDOWN = 0.4;
// The server grows hitboxes by this much when confirming a punch, since the
// attacker saw the target slightly in the past.
export const HIT_TOLERANCE = 0.3;
// Knockback launches the target, then fades: slowly in the air, quickly once
// they land. While it lasts it overrides their walking (see stepPlayer).
export const KNOCKBACK_SPEED = 8;
export const KNOCKBACK_UP = 6.5;
// Per-tick multipliers on knockback velocity.
export const KNOCKBACK_AIR_DECAY = 0.91;
export const KNOCKBACK_GROUND_DECAY = 0.6;
export const RESPAWN_DELAY = 3;
// Falling below this y kills the player.
export const VOID_Y = -20;
// A void or fall death is credited to whoever hit the player within this long before.
export const KILL_CREDIT_TIME = 5;
// Falls up to this many blocks are free; each block further costs 1 HP.
export const FALL_SAFE_DISTANCE = 3;

// Capture the flag. Sizes in blocks, times in seconds.
// Keeps: a KEEP_SIZE x KEEP_SIZE floor and a frame KEEP_HEIGHT blocks tall.
export const KEEP_SIZE = 7;
export const KEEP_HEIGHT = 5;
// Terrain around a keep is flattened this far out so it can be walked into from any side.
export const KEEP_MARGIN = 2;
// Keep centers sit on a circle around the world center, this fraction of the world size out.
export const KEEP_RING = 0.32;
export const FLAG_GRAB_TIME = 2;
export const FLAG_RETURN_TIME = 120;
// A player is on a flag when their feet are within this horizontal distance of its base.
export const FLAG_TOUCH_RADIUS = 0.8;
export const CARRY_SPEED_SCALE = 0.6;

// Furnace: seconds to smelt one item.
export const SMELT_TIME = 5;
