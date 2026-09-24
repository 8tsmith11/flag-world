// Shared constants used by both server and client.
// Changing anything here affects simulation on both sides, so keep them in sync
// by only ever reading from this module.

// Shows an FPS counter and player coordinates on screen.
export const DEBUG = true;

export const PORT = 3000;

// World height in blocks. The X/Z size follows the selected island radius.
export const WORLD_SIZE_Y = 128;

// Chunks are cubes of CHUNK_SIZE blocks.
export const CHUNK_SIZE = 16;

// Client view distance in blocks (horizontal): chunks further away aren't
// meshed, and fog hides the edge. Players can change it within the range.
export const VIEW_DISTANCE = 160;
export const VIEW_DISTANCE_MIN = 64;
export const VIEW_DISTANCE_MAX = 320;


// Simulation runs at a fixed rate. Every client input represents exactly one tick.
export const TICK_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;

// Player physics (blocks, seconds).
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE_HEIGHT = 1.62;
export const WALK_SPEED = 4.3;
export const SPRINT_SPEED_SCALE = 1.5;
export const JUMP_VELOCITY = 8.4;
export const GRAVITY = 28;
export const TERMINAL_VELOCITY = 50;
export const SWIM_GRAVITY_SCALE = 0.25;
export const SWIM_UP_SPEED = 2.4;
export const SWIM_SPEED_SCALE = 0.4;
export const WATER_CURRENT_SPEED = 2.2;
export const GLIDE_SPEED = 8;
export const GLIDE_FALL_SPEED = 2;
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
export const REGEN_DELAY = 12;
export const REGEN_INTERVAL = 3;
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
export const FLAG_GRAB_TIME = 2;
export const FLAG_RETURN_TIME = 120;
// A player is on a flag when their feet are within this horizontal distance of its base.
export const FLAG_TOUCH_RADIUS = 0.8;
export const CARRY_SPEED_SCALE = 0.6;

// Bows. Times in seconds, speeds in blocks/s. Charge runs from the shortest
// draw that shoots (BOW_MIN_DRAW) to a full draw (BOW_FULL_DRAW); arrow speed
// and damage scale linearly across it.
export const BOW_FULL_DRAW = 1;
export const BOW_MIN_DRAW = 0.2;
export const BOW_COOLDOWN = 0.5;
export const BOW_DRAW_SPEED_SCALE = 0.5;
export const EAT_SPEED_SCALE = 0.45;
export const EAT_TIME = 1.5;
export const FOOD_HEAL_TIME = 3;
export const ARROW_SPEED = [15, 50];
export const ARROW_DAMAGE = [1, 5];
// Arrows fall slower than players (GRAVITY) so they arc gently, and lose a
// little speed each tick.
export const ARROW_GRAVITY = 12;
export const ARROW_DRAG = 0.99;
export const ARROW_STICK_TIME = 10;
// An arrow can't hit whoever shot it this soon after leaving the bow.
export const ARROW_SAFE_TIME = 0.2;
export const ARROW_KNOCKBACK = 3;

// Crossbows: hold right click CROSSBOW_LOAD_TIME to load, then click to fire.
// Bolts fly 1.6x a full bow draw with a flatter arc (less gravity).
export const CROSSBOW_LOAD_TIME = 1.2;
export const CROSSBOW_ARROW_SPEED = ARROW_SPEED[1] * 1.6;
export const CROSSBOW_ARROW_GRAVITY = 5;
export const CROSSBOW_ARROW_DAMAGE = 6;

// Rope Bundles hang a column of rope at most this many blocks long.
export const ROPE_LENGTH = 40;

// Grappling hooks: range of the hook (blocks), pull speed (blocks/s) and
// cooldown between shots (seconds).
export const GRAPPLE_RANGE = 30;
export const GRAPPLE_SPEED = 20;
export const GRAPPLE_COOLDOWN = 3;

// Cows: collision box, health, walking speeds (fractions of WALK_SPEED),
// herds (how many per square block of world, and their size), how long a
// herd panics after one of them is hurt, and what they drop.
export const COW_WIDTH = 0.9;
export const COW_HEIGHT = 1.3;
export const COW_HP = 10;
export const COW_WANDER_SPEED = 0.3;
export const COW_FLEE_SPEED = 0.85;
export const COW_HERD_AREA = 20000;
export const COW_HERD_SIZE = [3, 6];
export const COW_PANIC_TIME = 5;
export const COW_DROPS = { leather: [0, 2], beef: [1, 3] };

// Dragons patrol above the island and dive to breathe fire at nearby players.
export const DRAGON_HP = 30;
export const DRAGON_SPEED = 5.5;
export const DRAGON_SIGHT = 45;
export const DRAGON_FIRE_RANGE = 14;
export const DRAGON_FIRE_DAMAGE = 2.5;
export const DRAGON_FIRE_DURATION = 1.2;
export const DRAGON_FIRE_COOLDOWN = 4;
export const DRAGON_FIRE_INTERVAL = 0.3;
export const DRAGON_DROPS = { iron: [2, 5], leather: [2, 4], scales: [2, 4] };
// How far past its island a leashed dragon roams unless chasing: team
// islands, the central island and roosts (measured from the island's edge).
export const DRAGON_LEASH = { team: 15, center: 20, roost: 20 };

// Provocation: any damage from a player makes a Crawler, Void Eel or dragon
// chase that player, ignoring its aggro range and leash, until the player
// dies or it has lost sight of them this long (seconds).
export const PROVOKE_FORGET_TIME = 10;

// Crawlers: spider-like mobs in dungeons, underside ruins and dark caverns.
// Speeds in blocks/s, ranges in blocks, times in seconds.
export const CRAWLER_WIDTH = 0.9;
export const CRAWLER_HEIGHT = 0.6;
export const CRAWLER_HP = 12;
export const CRAWLER_DAMAGE = 3;
export const CRAWLER_ATTACK_COOLDOWN = 1;
export const CRAWLER_SPEED = 4.8;
export const CRAWLER_CLIMB_SPEED = 3;
// Bite reach, from the edge of its box to the edge of the target's.
export const CRAWLER_REACH = 0.6;
export const CRAWLER_AGGRO_RANGE = 12;
export const CRAWLER_GIVE_UP_RANGE = 24;
// Idle crawlers wander this far from where they spawned.
export const CRAWLER_WANDER_RADIUS = 5;
export const CRAWLER_DROPS = { silk: [0, 2] };

// Void Eels patrol under their home island, above the void.
export const EEL_HP = 30;
export const EEL_DAMAGE = 4;
export const EEL_ATTACK_COOLDOWN = 1.2;
export const EEL_SPEED = 4;
export const EEL_CHASE_SPEED = 8;
// Bite reach from the head's center to the target's box.
export const EEL_REACH = 1.2;
// Attacks players gliding, falling or climbing this close; loses them beyond
// EEL_LOSE_RANGE or once they're back on their feet.
export const EEL_AGGRO_RANGE = 15;
export const EEL_LOSE_RANGE = 30;
// Its patrol zone: from this far under the island's underside down to this far
// above the void kill height, within its island's radius.
export const EEL_ZONE = { belowUnderside: 4, depth: 22, aboveVoid: 6 };

// Day/night: one full cycle in seconds (half day, half night). Time of day is
// a fraction of the cycle: 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight.
// Matches start at DAY_START, in the morning.
export const DAY_LENGTH = 24 * 60;
export const DAY_START = 0.04;

// Furnace: seconds to smelt one item.
export const SMELT_TIME = 5;
