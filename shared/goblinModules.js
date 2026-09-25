// The Goblin Fortress: modules on a 3D grid of cells, joined through their
// faces. Module types are data (MODULE_TYPES); a fortress is a plain,
// JSON-friendly graph (createFortress) that world gen fills in and that the
// server keeps in world.goblinFortress, so goblins can path over it and
// later phases can add modules at runtime (addModule, then connectModules or
// autoConnect). Blocks go through world.setBlock, so runtime additions reach
// clients as ordinary block changes.
//
// A cell is CELL_SIZE x CELL_HEIGHT x CELL_SIZE blocks, its own walls,
// floor and ceiling included, so neighbouring modules stand wall to wall and
// a doorway cuts through both walls. Doorways are DOOR.width wide and
// DOOR.height tall, at the same offset on every cell, so they always line up.
// Faces: N (-Z), E (+X), S (+Z), W (-X), U (up), D (down).

import { BLOCK, ladderBlock, isLadder } from './blocks.js';

export const CELL_SIZE = 7;
export const CELL_HEIGHT = 6;
// First column of a doorway (local to the cell, across the face), its width and height.
export const DOOR = { offset: 3, width: 2, height: 3 };
// Corridors: the local columns (inclusive) of the middle square and of each arm across it.
export const CORRIDOR = { from: 2, to: 5 };
// Headroom inside a one-level module (floor at local 0, ceiling at CELL_HEIGHT - 1).
export const ROOM_HEIGHT = CELL_HEIGHT - 2;
// Where a shaft's ladder hangs (local x, z) for each wall it can be on.
const LADDER_SPOTS = { N: [3, 1], E: [5, 3], S: [3, 5], W: [1, 3] };

export const FACES = {
  N: { dir: [0, 0, -1], facing: 0, opposite: 'S' },
  E: { dir: [1, 0, 0], facing: 1, opposite: 'W' },
  S: { dir: [0, 0, 1], facing: 2, opposite: 'N' },
  W: { dir: [-1, 0, 0], facing: 3, opposite: 'E' },
  U: { dir: [0, 1, 0], opposite: 'D' },
  D: { dir: [0, -1, 0], opposite: 'U' },
};
export const HORIZONTAL = ['N', 'E', 'S', 'W'];

// Module types.
//   shape       'room' (hollow inside), 'corridor' (a passage from the middle
//               to each of its faces) or 'shaft' (hollow, with a ladder up
//               one wall through its U/D connections)
//   size        [x, levels, z] in cells
//   faces       horizontal faces that can connect, as laid out at rotation 0
//               (turned clockwise with the module), or 'any'
//   vertical    which of U and D can connect (rooms can open up into a
//               ladder shaft above; shafts both ways)
//   doorLevels  levels whose perimeter faces can connect (default: all)
//   feature     what's built inside: 'totem' (the Goblin Totem stands in the
//               middle), 'bunks'
//               (BUNKS against the walls) or 'entrance' (the bottom of a
//               surface shaft, whose ladders climb its ladderFace wall)
//   capacity    goblins it houses (the Totem Hall's is GOBLINS.population.hallCapacity)
//   brick       counts toward the brick module cap (default true)
export const MODULE_TYPES = {
  room: { label: 'Room', shape: 'room', size: [1, 1, 1], faces: 'any', vertical: ['U'] },
  hallway: { label: 'Hallway', shape: 'corridor', size: [1, 1, 1], faces: ['N', 'S'] },
  corner: { label: 'Corner', shape: 'corridor', size: [1, 1, 1], faces: ['N', 'E'] },
  junctionT: { label: 'T junction', shape: 'corridor', size: [1, 1, 1], faces: ['E', 'S', 'W'] },
  junctionCross: { label: 'Cross junction', shape: 'corridor', size: [1, 1, 1], faces: ['N', 'E', 'S', 'W'] },
  deadEnd: { label: 'Dead end', shape: 'corridor', size: [1, 1, 1], faces: ['N'] },
  ladderShaft: { label: 'Ladder shaft', shape: 'shaft', size: [1, 1, 1], faces: 'any', vertical: ['U', 'D'] },
  totemHall: { label: 'Totem Hall', shape: 'room', size: [2, 2, 2], faces: 'any', doorLevels: [0], feature: 'totem' },
  bunkRoom: { label: 'Bunk Room', shape: 'room', size: [1, 1, 1], faces: 'any', vertical: ['U'], feature: 'bunks', capacity: 2 },
  entrance: { label: 'Shaft base', shape: 'room', size: [1, 1, 1], faces: 'any', feature: 'entrance' },
};

// Bunk Room details, in a room's local block coordinates (feet level is
// y 1): [x, y, z, 'wood' | 'planks']. Three bunks in the corners that no
// doorway passes: a log post and two plank beds, one above the other.
export const BUNKS = [[1, 1], [5, 1], [1, 5]].flatMap(([x, z], i) => {
  const bed = [[1, 2], [5, 2], [2, 5]][i];
  return [[x, 1, z, 'wood'], [x, 2, z, 'wood'], [x, 3, z, 'wood'],
    [bed[0], 1, bed[1], 'planks'], [bed[0], 3, bed[1], 'planks']];
});

// Materials by block: what a goblin spends placing it.
export const MATERIAL_OF = {
  [BLOCK.GOBLIN_BRICKS]: 'bricks',
  [BLOCK.PLANKS]: 'planks',
  [BLOCK.WOOD]: 'wood',
  [BLOCK.STONE]: 'stone',
  [BLOCK.DIRT]: 'dirt',
  [BLOCK.GRASS]: 'dirt',
  [BLOCK.SAPLING]: 'saplings',
};
export function materialOf(id) {
  if (isLadder(id)) return 'planks';
  return MATERIAL_OF[id] ?? null;
}

const randInt = (random, min, max) => min + Math.floor(random() * (max - min + 1));
export const cellKey = (cx, cy, cz) => `${cx},${cy},${cz}`;
export const stepCell = ([cx, cy, cz], face) => {
  const [dx, dy, dz] = FACES[face].dir;
  return [cx + dx, cy + dy, cz + dz];
};

export function rotateFace(face, turns) {
  let index = HORIZONTAL.indexOf(face);
  if (index < 0) return face;
  return HORIZONTAL[(index + turns) % 4];
}

// A module's connectable horizontal faces after rotation, or 'any'.
export function moduleFaces(module) {
  const faces = MODULE_TYPES[module.type].faces;
  return faces === 'any' ? 'any' : faces.map((face) => rotateFace(face, module.rotation));
}

export function createFortress(origin) {
  return { origin: { ...origin }, modules: [], connections: [], cells: {} };
}

// Block coordinates of a cell's lowest corner.
export function cellOrigin(fortress, [cx, cy, cz]) {
  const { x, y, z } = fortress.origin;
  return { x: x + cx * CELL_SIZE, y: y + cy * CELL_HEIGHT, z: z + cz * CELL_SIZE };
}

export function footprint(type, rotation) {
  const [sx, sy, sz] = MODULE_TYPES[type].size;
  return rotation % 2 ? [sz, sy, sx] : [sx, sy, sz];
}

// The cells a module of this type would cover with its lowest corner at `cell`.
export function footprintCells(type, cell, rotation = 0) {
  const [sx, sy, sz] = footprint(type, rotation);
  const cells = [];
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    cells.push([cell[0] + x, cell[1] + y, cell[2] + z]);
  }
  return cells;
}

export function canAddModule(fortress, type, cell, rotation = 0) {
  return !!MODULE_TYPES[type]
    && footprintCells(type, cell, rotation).every((c) => !(cellKey(...c) in fortress.cells));
}

// The module in a cell, or null (reserved cells hold a string, not a module id).
export function moduleAtCell(fortress, cell) {
  const id = fortress.cells[cellKey(...cell)];
  return typeof id === 'number' ? fortress.modules[id] : null;
}

export function cellOfBlock(fortress, x, y, z) {
  const { origin } = fortress;
  return [Math.floor((x - origin.x) / CELL_SIZE), Math.floor((y - origin.y) / CELL_HEIGHT),
    Math.floor((z - origin.z) / CELL_SIZE)];
}

// The module a point (feet position) is in, or null.
export function moduleAt(fortress, x, y, z) {
  return moduleAtCell(fortress, cellOfBlock(fortress, Math.floor(x), Math.floor(y), Math.floor(z)));
}

// Registers a module in the fortress graph without building anything.
// Returns it, or null if a cell it needs is taken.
export function registerModule(fortress, { type, cell, rotation = 0, ladderFace = null }) {
  if (!canAddModule(fortress, type, cell, rotation)) return null;
  const size = footprint(type, rotation);
  const low = cellOrigin(fortress, cell);
  const box = { x0: low.x, y0: low.y, z0: low.z,
    x1: low.x + size[0] * CELL_SIZE - 1, y1: low.y + size[1] * CELL_HEIGHT - 1, z1: low.z + size[2] * CELL_SIZE - 1 };
  const module = {
    id: fortress.modules.length, type, cell: [...cell], size, rotation, ladderFace, box,
    floorY: box.y0 + 1,
    center: { x: (box.x0 + box.x1 + 1) / 2, y: box.y0 + 1, z: (box.z0 + box.z1 + 1) / 2 },
    feature: null,
  };
  const def = MODULE_TYPES[type];
  if (def.feature === 'totem') module.feature = { kind: 'totem', x: module.center.x, y: box.y0 + 1, z: module.center.z };
  else if (def.feature) module.feature = { kind: def.feature };
  fortress.modules.push(module);
  for (const c of footprintCells(type, cell, rotation)) fortress.cells[cellKey(...c)] = module.id;
  return module;
}

// The blocks a module is made of: [{ x, y, z, id }], its shell and solid
// parts as Goblin Bricks and its hollow as air, plus its feature. Doorways
// and ladders come from its connections (connectionBlocks).
export function moduleBlocks(module) {
  const def = MODULE_TYPES[module.type];
  const { box } = module;
  const air = new Set();
  const hollow = (x0, y0, z0, x1, y1, z1) => {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) air.add(`${x},${y},${z}`);
  };
  if (def.shape === 'corridor') {
    const { from, to } = CORRIDOR;
    const top = box.y0 + ROOM_HEIGHT;
    const carve = (a0, b0, a1, b1) => hollow(box.x0 + a0, box.y0 + 1, box.z0 + b0, box.x0 + a1, top, box.z0 + b1);
    carve(from, from, to, to);
    for (const face of moduleFaces(module)) {
      if (face === 'N') carve(from, 1, to, to);
      if (face === 'S') carve(from, from, to, CELL_SIZE - 2);
      if (face === 'E') carve(from, from, CELL_SIZE - 2, to);
      if (face === 'W') carve(1, from, to, to);
    }
  } else {
    hollow(box.x0 + 1, box.y0 + 1, box.z0 + 1, box.x1 - 1, box.y1 - 1, box.z1 - 1);
  }
  const special = new Map();
  if (def.feature === 'bunks') {
    for (const [x, y, z, material] of BUNKS) {
      special.set(`${box.x0 + x},${box.y0 + y},${box.z0 + z}`, material === 'wood' ? BLOCK.WOOD : BLOCK.PLANKS);
    }
  }
  const blocks = [];
  for (let y = box.y0; y <= box.y1; y++) for (let z = box.z0; z <= box.z1; z++) for (let x = box.x0; x <= box.x1; x++) {
    const key = `${x},${y},${z}`;
    blocks.push({ x, y, z, id: special.get(key) ?? (air.has(key) ? BLOCK.AIR : BLOCK.GOBLIN_BRICKS) });
  }
  return blocks;
}

// Registers a module and builds its bricks, hollow and feature at once
// (world gen). Returns the module, or null if a cell it needs is taken.
// Doorways are cut later, by connectModules / autoConnect.
export function addModule(world, fortress, spec) {
  const module = registerModule(fortress, spec);
  if (!module) return null;
  for (const { x, y, z, id } of moduleBlocks(module)) world.setBlock(x, y, z, id);
  return module;
}

// Whether `module` can open `face` in its footprint cell `cell`.
export function opens(module, face, cell) {
  const def = MODULE_TYPES[module.type];
  if (face === 'U' || face === 'D') return (def.vertical ?? []).includes(face);
  const level = cell[1] - module.cell[1];
  if (def.doorLevels && !def.doorLevels.includes(level)) return false;
  // A shaft base keeps its ladder wall whole.
  if (def.feature === 'entrance' && face === module.ladderFace) return false;
  const faces = moduleFaces(module);
  return faces === 'any' || faces.includes(face);
}

// Where the ladder hangs in a cell whose lowest corner is `base`, on `wall`,
// shifted `offset` blocks along the wall (a wider shaft).
export function ladderSpot(base, wall, offset = 0) {
  const [lx, lz] = LADDER_SPOTS[wall];
  const alongX = wall === 'N' || wall === 'S';
  return { x: base.x + lx + (alongX ? offset : 0), z: base.z + lz + (alongX ? 0 : offset) };
}

// Plans joining module `a`, through `face` of its cell `cellA`, to the module
// in the next cell: { connection, blocks } where blocks ([{ x, y, z, id }])
// are the doorway (or, for U/D, the ladder hole and ladder) and the
// connection has the points a goblin walks through, in order from a to b.
// Null if either side can't open that way or they're already joined there.
export function planConnection(fortress, a, face, cellA = a.cell, { existing = false } = {}) {
  const cellB = stepCell(cellA, face);
  const b = moduleAtCell(fortress, cellB);
  if (!b || b === a || !opens(a, face, cellA) || !opens(b, FACES[face].opposite, cellB)) return null;
  if (!existing && fortress.connections.some((c) => (c.a === a.id && c.b === b.id || c.a === b.id && c.b === a.id)
    && (c.cellA.join() === cellA.join() && c.face === face
      || c.cellA.join() === cellB.join() && c.face === FACES[face].opposite))) return null;
  const low = cellOrigin(fortress, cellA);
  const blocks = [];
  let points;
  let kind = 'door';
  if (face === 'U' || face === 'D') {
    kind = 'ladder';
    const lower = face === 'U' ? a : b;
    const upper = face === 'U' ? b : a;
    const lowerCell = face === 'U' ? cellA : cellB;
    const wall = lower.ladderFace ?? upper.ladderFace ?? 'N';
    lower.ladderFace = upper.ladderFace = wall;
    const base = cellOrigin(fortress, lowerCell);
    const { x, z } = ladderSpot(base, wall);
    // Built from the ladder itself, bottom up (see goblinProjects' wireShaftTasks).
    const climb = { x, z, wall, floorY: base.y + 1, topY: base.y + CELL_HEIGHT + 1 };
    for (let y = base.y + 1; y <= base.y + CELL_HEIGHT + 1; y++) blocks.push({ x, y, z, id: ladderBlock(FACES[wall].facing), climb });
    const bottom = { x: x + 0.5, y: base.y + 1, z: z + 0.5, wall };
    const top = { x: x + 0.5, y: base.y + CELL_HEIGHT + 1, z: z + 0.5, wall };
    points = face === 'U'
      ? [{ ...bottom, kind: 'ladderBottom' }, { ...top, kind: 'ladderTop' }]
      : [{ ...top, kind: 'ladderTop' }, { ...bottom, kind: 'ladderBottom' }];
  } else {
    const [dx, , dz] = FACES[face].dir;
    const alongX = dx !== 0;
    const boundary = alongX ? low.x + (dx > 0 ? CELL_SIZE : 0) : low.z + (dz > 0 ? CELL_SIZE : 0);
    const sign = alongX ? dx : dz;
    const across = (alongX ? low.z : low.x) + DOOR.offset;
    for (let y = low.y + 1; y <= low.y + DOOR.height; y++) {
      for (let w = 0; w < DOOR.width; w++) for (const depth of [boundary - 1, boundary]) {
        blocks.push(alongX ? { x: depth, y, z: across + w, id: BLOCK.AIR } : { x: across + w, y, z: depth, id: BLOCK.AIR });
      }
    }
    const middle = across + DOOR.width / 2;
    const at = (d) => (alongX ? { x: d, y: low.y + 1, z: middle } : { x: middle, y: low.y + 1, z: d });
    points = [{ ...at(boundary - sign * 1.5), kind: 'door' }, { ...at(boundary + sign * 1.5), kind: 'door' }];
  }
  return { connection: { a: a.id, b: b.id, face, cellA: [...cellA], kind, points }, blocks };
}

// The blocks of a connection already in the graph.
export function connectionBlocks(fortress, connection) {
  const a = fortress.modules[connection.a];
  return planConnection(fortress, a, connection.face, connection.cellA, { existing: true })?.blocks ?? [];
}

// Records a planned connection in the graph.
export function registerConnection(fortress, connection) {
  const made = { id: fortress.connections.length, ...connection };
  fortress.connections.push(made);
  return made;
}

// Joins two modules at once (world gen): plans the connection, builds its
// blocks and records it. Returns the connection, or null.
export function connectModules(world, fortress, a, face, cellA = a.cell) {
  const plan = planConnection(fortress, a, face, cellA);
  if (!plan) return null;
  for (const { x, y, z, id } of plan.blocks) world.setBlock(x, y, z, id);
  return registerConnection(fortress, plan.connection);
}

// Every connection a module could make with its neighbours, planned:
// [{ connection, blocks }].
export function planAutoConnect(fortress, module) {
  const plans = [];
  for (const cell of footprintCells(module.type, module.cell, module.rotation)) {
    for (const face of Object.keys(FACES)) {
      const other = moduleAtCell(fortress, stepCell(cell, face));
      if (!other || other === module) continue;
      const plan = planConnection(fortress, module, face, cell);
      if (plan) plans.push(plan);
    }
  }
  return plans;
}

// Connects a module to every neighbour both sides allow, at once.
export function autoConnect(world, fortress, module) {
  return planAutoConnect(fortress, module).map((plan) => {
    for (const { x, y, z, id } of plan.blocks) world.setBlock(x, y, z, id);
    return registerConnection(fortress, plan.connection);
  });
}

// Connections touching a module, each as { connection, other, points } with
// the points in walking order out of `module`.
export function exitsOf(fortress, module) {
  const exits = [];
  for (const connection of fortress.connections) {
    if (connection.a === module.id) exits.push({ connection, other: fortress.modules[connection.b], points: connection.points });
    else if (connection.b === module.id) {
      exits.push({ connection, other: fortress.modules[connection.a], points: [...connection.points].reverse() });
    }
  }
  return exits;
}

// The corridor type and rotation with exactly these open horizontal faces.
function corridorFor(faces) {
  for (const type of ['deadEnd', 'hallway', 'corner', 'junctionT', 'junctionCross']) {
    const base = MODULE_TYPES[type].faces;
    if (base.length !== faces.size) continue;
    for (let rotation = 0; rotation < 4; rotation++) {
      if (base.every((face) => faces.has(rotateFace(face, rotation)))) return { type, rotation };
    }
  }
  return null;
}

// A starting fortress in cell coordinates, with the Totem Hall at (0, 0, 0):
// { modules: [{ type, cell, rotation, ladderFace }], links: [{ a, face, cellA }] }
// (links index into modules). A path of connector modules leads from a hall
// The hall begins alone; workers dig the first connection toward the surface.
export function planStartingLayout(random) {
  return { modules: [{ type: 'totemHall', cell: [0, 0, 0], rotation: 0, ladderFace: null }],
    links: [], firstFace: HORIZONTAL[Math.floor(random() * HORIZONTAL.length)] };
}

// Every cell of a layout ({ modules }) with its footprint, in cell coordinates.
export function layoutCells(layout) {
  return layout.modules.flatMap((m) => footprintCells(m.type, m.cell, m.rotation));
}

// Builds a planned layout into the world with its lowest corner cell (0, 0, 0)
// at `origin`. Returns the fortress.
export function buildLayout(world, origin, layout) {
  const fortress = createFortress(origin);
  fortress.firstFace = layout.firstFace;
  const modules = layout.modules.map((spec) => addModule(world, fortress, spec));
  for (const link of layout.links) connectModules(world, fortress, modules[link.a], link.face, link.cellA);
  return fortress;
}

// ---- Surface buildings ----
//
// Templates are layers of rows in a local frame: x across (row characters),
// z from back (first row) to front (last row), y from the ground layer
// (layers[0], at the ground) up. The front faces local +z; placing turns it
// (turnsFront). Characters:
//   P planks, W wood log, F plank border, B Goblin Bricks, g ground (grass on top
//   of whatever is there, filled if missing), S sapling,
//   n e s w a ladder hung on that side's block (local),
//   . air (cleared), _ left alone
// Everything under a template's ground layer that isn't solid is filled
// (foundationBlock) down to the terrain, so buildings sit on sloped ground.
//   capacity  goblins housed
//   door      local x of the doorway in the front row (a path out of it,
//             3 wide and DOOR_PATH long, is cleared and given ground)
//   post      local [x, y, z] (feet) where an archer stands guard
export const SURFACE_TEMPLATES = {
  hut: {
    label: 'Hut', capacity: 2, foundationBlock: BLOCK.STONE, door: 2,
    layers: [
      ['PPPPP', 'PPPPP', 'PPPPP', 'PPPPP', 'PPPPP'],
      ['WPPPW', 'P...P', 'P...P', 'P...P', 'WP.PW'],
      ['WP.PW', 'P...P', '....P', 'P...P', 'WP.PW'],
      ['WPPPW', 'P...P', 'P...P', 'P...P', 'WPPPW'],
      ['PPPPP', 'PPPPP', 'PPPPP', 'PPPPP', 'PPPPP'],
      ['_____', '_PPP_', '_PPP_', '_PPP_', '_____'],
    ],
  },
  longhouse: {
    label: 'Longhouse', capacity: 4, foundationBlock: BLOCK.STONE, door: 4,
    layers: [
      ['PPPPPPPPP', 'PPPPPPPPP', 'PPPPPPPPP', 'PPPPPPPPP', 'PPPPPPPPP'],
      ['WPPPWPPPW', 'P.......P', 'P.......P', 'P.......P', 'WPPP.PPPW'],
      ['WP.PWP.PW', 'P.......P', '........P', 'P.......P', 'WPPP.PPPW'],
      ['WPPPWPPPW', 'P.......P', 'P.......P', 'P.......P', 'WPPPPPPPW'],
      ['PPPPPPPPP', 'PPPPPPPPP', 'PPPPPPPPP', 'PPPPPPPPP', 'PPPPPPPPP'],
      ['_________', '_PPPPPPP_', '_PPPPPPP_', '_PPPPPPP_', '_________'],
      ['_________', '_________', '_WWWWWWW_', '_________', '_________'],
    ],
  },
  // A platform on four corner posts and a middle pole, climbed by a ladder
  // on the pole's front. The platform has no railing.
  lookout: {
    label: 'Lookout', capacity: 1, foundationBlock: BLOCK.WOOD, post: [2, 6, 1],
    layers: [
      ['g___g', '_____', '__g__', '_____', 'g___g'],
      ['W...W', '.....', '..W..', '..n..', 'W...W'],
      ['W...W', '.....', '..W..', '..n..', 'W...W'],
      ['W...W', '.....', '..W..', '..n..', 'W...W'],
      ['W...W', '.....', '..W..', '..n..', 'W...W'],
      ['PPPPP', 'PPPPP', 'PPPPP', 'PPnPP', 'PPPPP'],
    ],
  },
  // Around the top of a surface shaft (built by entrance.js): the shaft's
  // ladders climb the back wall at local x 2-4, z 1 through the floor; the
  // doorway is in the front wall.
  gatehouse: {
    label: 'Gatehouse', capacity: 0, foundationBlock: BLOCK.GOBLIN_BRICKS, shaft: { x: 3, z: 1 }, door: 3,
    layers: [
      ['BBBBBBB', 'BBBBBBB', 'BBBBBBB', 'BBBBBBB', 'BBBBBBB'],
      ['BBBBBBB', 'B.....B', 'B.....B', 'B.....B', 'BBB.BBB'],
      ['BBBBBBB', 'B.....B', 'B.....B', 'B.....B', 'BBB.BBB'],
      ['BBBBBBB', 'B.....B', 'B.....B', 'B.....B', 'BBBBBBB'],
      ['BBBBBBB', 'BBBBBBB', 'BBBBBBB', 'BBBBBBB', 'BBBBBBB'],
      ['B_B_B_B', '_______', 'B_____B', '_______', 'B_B_B_B'],
    ],
  },
};

// How far out of a doorway the way is cleared.
export const DOOR_PATH = 3;

// Surface dwellings goblins build for room, and how often each is picked.
export const DWELLINGS = { hut: 3, longhouse: 2, lookout: 1.5 };

// A tree plot template: a plank-bordered square with a grid x grid of
// saplings `spacing` apart, `margin` in from the border and a front gap.
export function plotTemplate({ grid, spacing, margin }) {
  const size = margin * 2 + spacing * (grid - 1) + 1;
  const spots = Array.from({ length: grid }, (_, i) => margin + i * spacing);
  const row = (fn) => Array.from({ length: size }, (_, z) => Array.from({ length: size }, (__, x) => fn(x, z)).join(''));
  const edge = (x, z) => x === 0 || z === 0 || x === size - 1 || z === size - 1;
  const gap = (x, z) => z === size - 1 && Math.abs(x - (size - 1) / 2) < 1;
  return {
    label: 'Tree plot', capacity: 0, foundationBlock: BLOCK.DIRT, plot: true, door: (size - 1) / 2,
    layers: [
      row(() => 'g'),
      row((x, z) => (edge(x, z) && !gap(x, z) ? 'F' : spots.includes(x) && spots.includes(z) ? 'S' : '.')),
      row(() => '.'),
      row(() => '.'),
    ],
  };
}

const LADDER_CHARS = { n: 0, e: 1, s: 2, w: 3 };

// Local (x, z) turned by `turns` quarter turns clockwise: turn 0 keeps the
// front at +z (south), 1 puts it at -x (west), 2 at -z, 3 at +x.
export function turnLocal(x, z, turns) {
  switch (turns & 3) {
    case 1: return [-z, x];
    case 2: return [-x, -z];
    case 3: return [z, -x];
    default: return [x, z];
  }
}

// Size of a template: [x, y, z].
export function templateSize(template) {
  return [template.layers[0][0].length, template.layers.length, template.layers[0].length];
}

// The blocks of a template with its local (0, ground layer, 0) at world
// `origin` (the ground layer at origin.y), turned by `turns`:
// [{ x, y, z, id, ground, sapling }] (air cells included; '_' left out).
// `ground` marks ground-layer cells to fill when they aren't solid.
export function templateBlocks(template, origin, turns) {
  const blocks = [];
  template.layers.forEach((layer, ly) => layer.forEach((rowText, lz) => {
    for (let lx = 0; lx < rowText.length; lx++) {
      const ch = rowText[lx];
      if (ch === '_') continue;
      const [dx, dz] = turnLocal(lx, lz, turns);
      const at = { x: origin.x + dx, y: origin.y + ly, z: origin.z + dz };
      if (ch === 'g') blocks.push({ ...at, id: BLOCK.GRASS, ground: true });
      else if (ch in LADDER_CHARS) blocks.push({ ...at, id: ladderBlock((LADDER_CHARS[ch] + turns) & 3) });
      else {
        const id = { P: BLOCK.PLANKS, W: BLOCK.WOOD, F: BLOCK.PLANKS, B: BLOCK.GOBLIN_BRICKS, S: BLOCK.SAPLING, '.': BLOCK.AIR }[ch];
        if (id === undefined) throw new Error(`template character ${ch}`);
        blocks.push({ ...at, id, sapling: ch === 'S' });
      }
    }
  }));
  return blocks;
}

// A turned template's footprint box (x0..x1, z0..z1) with local (0, 0) at (ox, oz).
export function templateBounds(template, ox, oz, turns) {
  const [sx, , sz] = templateSize(template);
  const corners = [[0, 0], [sx - 1, 0], [0, sz - 1], [sx - 1, sz - 1]].map(([x, z]) => turnLocal(x, z, turns));
  return { x0: ox + Math.min(...corners.map((c) => c[0])), x1: ox + Math.max(...corners.map((c) => c[0])),
    z0: oz + Math.min(...corners.map((c) => c[1])), z1: oz + Math.max(...corners.map((c) => c[1])) };
}

// The turn that points a template's front (local +z) along (dx, dz).
export function turnsFront(dx, dz) {
  if (Math.abs(dx) > Math.abs(dz)) return dx < 0 ? 1 : 3;
  return dz < 0 ? 2 : 0;
}

// The turn that puts a template's back (local -z) against wall `face` (N/E/S/W).
export function turnsBack(face) {
  return { S: 2, W: 3, N: 0, E: 1 }[face] ?? 0;
}
