import { BLOCK, facedBlock, ladderBlock } from '../blocks.js';
import { GOBLIN_GEN } from '../config.js';
const B = BLOCK.GOBLIN_BRICKS;
const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const put = (p, x, y, z, id) => p.blocks.push({ x, y, z, id });
const connector = (x, y, z, facing) => ({ name: 'walk', x, y, z, facing, pool: 'rooms', maxStep: 0, width: GOBLIN_GEN.corridorWidth });

export function fortressContent(C = GOBLIN_GEN) {
  const halls = new Map(), shafts = new Map();
  function room(type, table, width = C.roomWidth, height = C.roomHeight) {
    const half = width >> 1;
    const p = { id: type, type, x0: -half, x1: half, z0: -half, z1: half, y0: 0, y1: height + 1,
      tags: ['room'], blocks: [], connectors: [], route: [], loot: [] };
    for (let z = -half; z <= half; z++) for (let x = -half; x <= half; x++) for (let y = 0; y <= height + 1; y++) {
      const shell = y === 0 || y === height + 1 || Math.abs(x) === half || Math.abs(z) === half;
      put(p, x, y, z, shell ? B : BLOCK.AIR);
    }
    for (let facing = 0; facing < dirs.length; facing++) {
      const [dx, dz] = dirs[facing]; p.connectors.push(connector(dx * half, 1, dz * half, facing));
    }
    // Furniture and pillars stay away from the central crossing and doors.
    const details = { barracks: BLOCK.PLANKS, storeroom: BLOCK.CHEST, mushroomFarm: BLOCK.MUSHROOM,
      forge: BLOCK.FURNACE, shrine: BLOCK.WOOD, prison: BLOCK.STONE_BRICKS,
      trophyHall: BLOCK.IRON_ORE, treasureVault: BLOCK.ANVIL, totemHall: BLOCK.WOOD,
      royalVault: BLOCK.ANVIL, midRoom: BLOCK.PLANKS, messHall: BLOCK.WORKBENCH };
    for (const [x, z] of [[-half + 1, -half + 1], [half - 1, half - 1]]) {
      put(p, x, 1, z, details[type] ?? BLOCK.PLANKS);
    }
    if (['shrine', 'totemHall', 'royalVault'].includes(type)) for (let y = 2; y < height; y++) {
      put(p, -half + 1, y, -half + 1, BLOCK.WOOD); put(p, half - 1, y, half - 1, BLOCK.WOOD);
    }
    if (type === 'barracks' || type === 'quarters') for (const z of [-half + 1, half - 1]) {
      put(p, -half + 2, 1, z, BLOCK.PLANKS); put(p, -half + 3, 1, z, BLOCK.PLANKS);
    }
    if (type === 'prison') for (let y = 2; y < height; y++) for (const z of [-half + 1, half - 1]) put(p, -half + 1, y, z, BLOCK.WOOD);
    if (type === 'mushroomFarm') for (let z = -half + 1; z < half; z++) put(p, -half + 1, 1, z, BLOCK.MUSHROOM);
    if (table) {
      const chest = { x: half - 1, y: 1, z: -half + 1, table };
      put(p, chest.x, chest.y, chest.z, facedBlock(BLOCK.CHEST, 2)); p.loot.push(chest);
    }
    // Mounted above furniture, away from each doorway.
    for (const z of [-half + 2, half - 2]) {
      put(p, -half + 1, Math.min(3, height), z, facedBlock(BLOCK.TORCH, 3));
      put(p, half - 1, Math.min(3, height), z, facedBlock(BLOCK.TORCH, 1));
    }
    return p;
  }
  function hall(length, trap = false, protrusion = false) {
    const key = `${length}:${trap}:${protrusion}`;
    if (halls.has(key)) return halls.get(key);
    const half = length >> 1, side = (C.corridorWidth >> 1) + 1;
    const p = { id: `hall${length}${trap ? 'trap' : ''}${protrusion ? 'cliff' : ''}`, type: trap ? 'trapCorridor' : 'hall',
      x0: -side, x1: side, z0: -half, z1: half, y0: 0, y1: C.passageHeight + 1,
      tags: protrusion ? ['protrusion'] : [], blocks: [], route: [], traps: [], loot: [],
      connectors: [connector(0, 1, half, 2), connector(0, 1, -half, 0)] };
    // Even-length halls are represented without pretending their footprint is odd.
    p.z1 = p.z0 + length - 1; p.connectors[0].z = p.z1;
    for (let z = p.z0; z <= p.z1; z++) {
      p.route.push({ x: 0, y: 1, z });
      for (let x = -side; x <= side; x++) for (let y = 0; y <= p.y1; y++) {
        put(p, x, y, z, y === 0 || y === p.y1 || Math.abs(x) === side || z === p.z0 || z === p.z1 ? B : BLOCK.AIR);
      }
    }
    for (let z = p.z0 + 2; z <= p.z1 - 2; z += C.torchSpacing) {
      put(p, side - 1, C.passageHeight, z, facedBlock(BLOCK.TORCH, 1));
    }
    if (trap) {
      put(p, -side, 2, 0, facedBlock(BLOCK.POISON_TRAP, 1));
      p.traps.push({ x: -side, y: 2, z: 0, facing: 1, sensor: { x: 0, y: 1, z: 0 } });
    }
    if (protrusion) {
      // A sealed terminus with one tiny arrow slit; no walkable exit connector.
      p.connectors.pop(); put(p, 0, C.windowHeight, p.z0, BLOCK.AIR);
      p.windows = [{ x: 0, y: C.windowHeight, z: p.z0 }];
    }
    halls.set(key, p); return p;
  }
  function shaft(drop, axisFacing) {
    const key = `${drop}:${axisFacing}`;
    if (shafts.has(key)) return shafts.get(key);
    // The support face is perpendicular to both hall entrances.
    const support = (axisFacing + 1) % 4, [sx, sz] = dirs[support];
    const low = (axisFacing + 2) % 4, [dx, dz] = dirs[axisFacing];
    const p = { id: `ladderShaft${drop}`, type: 'ladderShaft', x0: -1, x1: 1, z0: -1, z1: 1,
      y0: 0, y1: drop + C.passageHeight + 1, blocks: [], route: [], loot: [],
      connectors: [connector(-dx, drop + 1, -dz, low), connector(dx, 1, dz, axisFacing)].map(c => ({ ...c, width: 1 })) };
    for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) for (let y = 0; y <= p.y1; y++) put(p, x, y, z, B);
    for (let y = 1; y < p.y1; y++) {
      put(p, 0, y, 0, ladderBlock(support)); p.route.push({ x: 0, y, z: 0 });
      put(p, sx, y, sz, B);
    }
    shafts.set(key, p); return p;
  }
  const rooms = Object.fromEntries([...C.uniqueRooms, ...C.commonRooms, 'midRoom', 'totemHall', 'royalVault'].map(type => [type,
    room(type, type === 'treasureVault' ? C.loot.best : C.loot.middle,
      type === 'totemHall' ? C.totemWidth : C.roomWidth, type === 'totemHall' ? C.totemHeight : C.roomHeight)]));
  const pools = { rooms: { entries: [...C.uniqueRooms.map(id => ({ id, weight: 1, unique: true })),
    ...C.commonRooms.map(id => ({ id, weight: 1 }))], fallback: 'junction' } };
  return { rooms, pools, hall, shaft };
}
