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

import { BLOCK, ladderBlock } from './blocks.js';

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
//   vertical    which of U and D can connect
//   doorLevels  levels whose perimeter faces can connect (default: all)
//   feature     what's built inside: 'totem' (the Goblin Totem stands in the
//               middle) or 'quarry' (a Quarry Stone in the middle)
export const MODULE_TYPES = {
  room: { label: 'Room', shape: 'room', size: [1, 1, 1], faces: 'any' },
  hallway: { label: 'Hallway', shape: 'corridor', size: [1, 1, 1], faces: ['N', 'S'] },
  corner: { label: 'Corner', shape: 'corridor', size: [1, 1, 1], faces: ['N', 'E'] },
  junctionT: { label: 'T junction', shape: 'corridor', size: [1, 1, 1], faces: ['E', 'S', 'W'] },
  junctionCross: { label: 'Cross junction', shape: 'corridor', size: [1, 1, 1], faces: ['N', 'E', 'S', 'W'] },
  deadEnd: { label: 'Dead end', shape: 'corridor', size: [1, 1, 1], faces: ['N'] },
  ladderShaft: { label: 'Ladder shaft', shape: 'shaft', size: [1, 1, 1], faces: 'any', vertical: ['U', 'D'] },
  totemHall: { label: 'Totem Hall', shape: 'room', size: [2, 2, 2], faces: 'any', doorLevels: [0], feature: 'totem' },
  quarryRoom: { label: 'Quarry room', shape: 'room', size: [1, 1, 1], faces: 'any', feature: 'quarry' },
};

const randInt = (random, min, max) => min + Math.floor(random() * (max - min + 1));
const cellKey = (cx, cy, cz) => `${cx},${cy},${cz}`;
const stepCell = ([cx, cy, cz], face) => {
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

function footprint(type, rotation) {
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

// The module whose cell contains block (x, y, z), or null.
export function moduleAtCell(fortress, cell) {
  const id = fortress.cells[cellKey(...cell)];
  return id === undefined ? null : fortress.modules[id];
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

function fill(world, x0, y0, z0, x1, y1, z1, id) {
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    world.setBlock(x, y, z, id);
  }
}

// Registers a module and builds its bricks, hollow and feature. Returns the
// module, or null if a cell it needs is taken. Doorways are cut later, by
// connectModules / autoConnect.
export function addModule(world, fortress, { type, cell, rotation = 0, ladderFace = null }) {
  if (!canAddModule(fortress, type, cell, rotation)) return null;
  const def = MODULE_TYPES[type];
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
  fortress.modules.push(module);
  for (const c of footprintCells(type, cell, rotation)) fortress.cells[cellKey(...c)] = module.id;

  fill(world, box.x0, box.y0, box.z0, box.x1, box.y1, box.z1, BLOCK.GOBLIN_BRICKS);
  if (def.shape === 'corridor') {
    const { from, to } = CORRIDOR;
    const top = box.y0 + ROOM_HEIGHT;
    const carve = (a0, b0, a1, b1) => fill(world, box.x0 + a0, box.y0 + 1, box.z0 + b0,
      box.x0 + a1, top, box.z0 + b1, BLOCK.AIR);
    carve(from, from, to, to);
    for (const face of moduleFaces(module)) {
      if (face === 'N') carve(from, 1, to, to);
      if (face === 'S') carve(from, from, to, CELL_SIZE - 2);
      if (face === 'E') carve(from, from, CELL_SIZE - 2, to);
      if (face === 'W') carve(1, from, to, to);
    }
  } else {
    fill(world, box.x0 + 1, box.y0 + 1, box.z0 + 1, box.x1 - 1, box.y1 - 1, box.z1 - 1, BLOCK.AIR);
  }
  if (def.feature === 'totem') {
    module.feature = { kind: 'totem', x: module.center.x, y: box.y0 + 1, z: module.center.z };
  } else if (def.feature === 'quarry') {
    const q = { x: box.x0 + 3, y: box.y0 + 1, z: box.z0 + 3 };
    world.setBlock(q.x, q.y, q.z, BLOCK.QUARRY_STONE);
    module.feature = { kind: 'quarry', ...q };
  }
  return module;
}

// Whether `module` can open `face` in its footprint cell `cell`.
function opens(module, face, cell) {
  const def = MODULE_TYPES[module.type];
  if (face === 'U' || face === 'D') return (def.vertical ?? []).includes(face);
  const level = cell[1] - module.cell[1];
  if (def.doorLevels && !def.doorLevels.includes(level)) return false;
  const faces = moduleFaces(module);
  return faces === 'any' || faces.includes(face);
}

// Joins module `a`, through `face` of its cell `cellA`, to whatever module
// is in the next cell. Cuts the doorway (or, for U/D, the ladder hole and
// ladder) and records the connection with the points a goblin walks through,
// in order from a to b. Returns the connection, or null if either side
// can't open that way.
export function connectModules(world, fortress, a, face, cellA = a.cell) {
  const cellB = stepCell(cellA, face);
  const b = moduleAtCell(fortress, cellB);
  if (!b || b === a || !opens(a, face, cellA) || !opens(b, FACES[face].opposite, cellB)) return null;
  if (fortress.connections.some((c) => (c.a === a.id && c.b === b.id || c.a === b.id && c.b === a.id)
    && c.cellA.join() === cellA.join() && c.face === face)) return null;
  const low = cellOrigin(fortress, cellA);
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
    const [lx, lz] = LADDER_SPOTS[wall];
    const x = base.x + lx, z = base.z + lz;
    for (let y = base.y + 1; y <= base.y + CELL_HEIGHT + 1; y++) {
      world.setBlock(x, y, z, ladderBlock(FACES[wall].facing));
    }
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
        if (alongX) world.setBlock(depth, y, across + w, BLOCK.AIR);
        else world.setBlock(across + w, y, depth, BLOCK.AIR);
      }
    }
    const middle = across + DOOR.width / 2;
    const at = (d) => (alongX ? { x: d, y: low.y + 1, z: middle } : { x: middle, y: low.y + 1, z: d });
    points = [{ ...at(boundary - sign * 1.5), kind: 'door' }, { ...at(boundary + sign * 1.5), kind: 'door' }];
  }
  const connection = { id: fortress.connections.length, a: a.id, b: b.id, face, cellA: [...cellA], kind, points };
  fortress.connections.push(connection);
  return connection;
}

// Connects a module to every neighbour both sides allow (runtime additions).
export function autoConnect(world, fortress, module) {
  const made = [];
  for (const cell of footprintCells(module.type, module.cell, module.rotation)) {
    for (const face of Object.keys(FACES)) {
      const other = moduleAtCell(fortress, stepCell(cell, face));
      if (!other || other === module) continue;
      const connection = connectModules(world, fortress, module, face, cell);
      if (connection) made.push(connection);
    }
  }
  return made;
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
// doorway to the Quarry room, maybe climbing a ladder shaft to the second
// level, maybe with a dead-end branch off it. Null if the random walk boxed
// itself in (rare; call again).
export function planStartingLayout(random, config) {
  const occupied = new Set();
  const nodes = [{ type: 'totemHall', cell: [0, 0, 0], faces: new Set() }];
  for (const c of footprintCells('totemHall', [0, 0, 0])) occupied.add(cellKey(...c));
  const links = [];
  const free = (cell) => cell[1] >= 0 && cell[1] <= 1 && !occupied.has(cellKey(...cell));
  const target = randInt(random, ...config.connectors);
  const branch = target >= 4 && random() < config.branchChance;
  const pathLength = target - (branch ? 1 : 0);
  const shaftAt = pathLength >= 3 && random() < config.shaftChance ? randInt(random, 0, pathLength - 2) : -1;

  let face = HORIZONTAL[randInt(random, 0, 3)];
  const side = randInt(random, 0, 1);
  let fromCell = { N: [side, 0, 0], S: [side, 0, 1], E: [1, 0, side], W: [0, 0, side] }[face];
  let from = 0;
  for (let i = 0; i <= pathLength; i++) {
    const cell = stepCell(fromCell, face);
    if (!free(cell)) return null;
    const node = { cell, faces: new Set(), quarry: i === pathLength, shaft: shaftAt >= 0 && (i === shaftAt || i === shaftAt + 1) };
    const index = nodes.length;
    nodes.push(node);
    occupied.add(cellKey(...cell));
    links.push({ a: from, face, cellA: fromCell });
    nodes[from].faces.add(face);
    node.faces.add(FACES[face].opposite);
    if (node.quarry) break;
    let next;
    if (i === shaftAt) next = 'U';
    else {
      const options = HORIZONTAL.filter((f) => !node.faces.has(f) && free(stepCell(cell, f)));
      if (!options.length) return null;
      next = options.includes(face) && random() < config.straightChance
        ? face : options[randInt(random, 0, options.length - 1)];
    }
    fromCell = cell;
    from = index;
    face = next;
  }

  if (branch) {
    const candidates = [];
    nodes.forEach((node, index) => {
      if (index === 0 || node.quarry || node.shaft) return;
      for (const f of HORIZONTAL) if (!node.faces.has(f) && free(stepCell(node.cell, f))) candidates.push([index, f]);
    });
    if (candidates.length) {
      const [index, f] = candidates[randInt(random, 0, candidates.length - 1)];
      const cell = stepCell(nodes[index].cell, f);
      nodes.push({ cell, faces: new Set([FACES[f].opposite]) });
      occupied.add(cellKey(...cell));
      links.push({ a: index, face: f, cellA: nodes[index].cell });
      nodes[index].faces.add(f);
    }
  }

  const shafts = nodes.filter((node) => node.shaft);
  const ladderOptions = HORIZONTAL.filter((f) => shafts.every((node) => !node.faces.has(f)));
  const ladderFace = shafts.length ? ladderOptions[randInt(random, 0, ladderOptions.length - 1)] : null;
  const modules = nodes.map((node, index) => {
    if (index === 0) return { type: 'totemHall', cell: node.cell, rotation: 0, ladderFace: null };
    if (node.shaft) return { type: 'ladderShaft', cell: node.cell, rotation: 0, ladderFace };
    if (node.quarry) return { type: 'quarryRoom', cell: node.cell, rotation: 0, ladderFace: null };
    const horizontal = new Set([...node.faces].filter((f) => HORIZONTAL.includes(f)));
    return { ...corridorFor(horizontal), cell: node.cell, ladderFace: null };
  });
  return { modules, links };
}

// Every cell of a layout ({ modules }) with its footprint, in cell coordinates.
export function layoutCells(layout) {
  return layout.modules.flatMap((m) => footprintCells(m.type, m.cell, m.rotation));
}

// Builds a planned layout into the world with its lowest corner cell (0, 0, 0)
// at `origin`. Returns the fortress.
export function buildLayout(world, origin, layout) {
  const fortress = createFortress(origin);
  const modules = layout.modules.map((spec) => addModule(world, fortress, spec));
  for (const link of layout.links) connectModules(world, fortress, modules[link.a], link.face, link.cellA);
  return fortress;
}
