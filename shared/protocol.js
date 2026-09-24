// WebSocket message type names. Every message is JSON: { type, ...fields }.
// PROTOCOL.md documents the fields of each; keep the two in sync.

// Client -> server
export const C2S = {
  HELLO: 'hello',
  LOBBY_UPDATE: 'lobbyUpdate',
  START_MATCH: 'startMatch',
  RECLAIM: 'reclaim',
  INPUT: 'input',
  RESPAWN: 'respawn',
  INVENTORY_CLICK: 'inventoryClick',
  INVENTORY_CLOSE: 'inventoryClose',
  CRAFT: 'craft',
  OPEN_CONTAINER: 'openContainer',
};

// Server -> client
export const S2C = {
  LOBBY: 'lobby',
  MATCH_IN_PROGRESS: 'matchInProgress',
  ERROR: 'error',
  WELCOME: 'welcome',
  STATE: 'state',
  BLOCK_CHANGE: 'blockChange',
  ENTITY_SPAWN: 'entitySpawn',
  ENTITY_DESPAWN: 'entityDespawn',
  INVENTORY: 'inventory',
  DAMAGE: 'damage',
  DEATH: 'death',
  FLAG_EVENT: 'flagEvent',
  MATCH_END: 'matchEnd',
  SWING: 'swing',
  CONTAINER: 'container',
  CONTAINER_CLOSE: 'containerClose',
  FURNACE_LIT: 'furnaceLit',
  PORTAL_SPAWN: 'portalSpawn',
  PORTAL_DESPAWN: 'portalDespawn',
  EMBER_BURST: 'emberBurst',
};

// Where a flag is, in FlagState.
export const FLAG_STATE = {
  HOME: 'home',
  CARRIED: 'carried',
  DROPPED: 'dropped',
  // Captured by another player; gone for good and its owner is flagless.
  CAPTURED: 'captured',
};

// FLAG_EVENT kinds.
export const FLAG_EVENT = {
  TAKEN: 'taken',
  DROPPED: 'dropped',
  RETURNED: 'returned',
  CAPTURED: 'captured',
};

// Why a player died, in DEATH messages.
export const DEATH_CAUSE = {
  PLAYER: 'player',
  VOID: 'void',
  FALL: 'fall',
};

// Server phases.
export const PHASE = {
  LOBBY: 'lobby',
  PLAYING: 'playing',
};

export const MAX_NAME_LENGTH = 16;
export const TEAMS = [
  { name: 'Red', color: 0xd64a4a },
  { name: 'Blue', color: 0x4a78dc },
  { name: 'Green', color: 0x4bae67 },
  { name: 'Yellow', color: 0xe6c44a },
];

// Entity type names, used by the client to pick a renderer.
export const ENTITY_TYPE = {
  PLAYER: 'player',
  ITEM: 'item',
  ARROW: 'arrow',
  COW: 'cow',
  DRAGON: 'dragon',
};
