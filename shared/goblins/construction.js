// The goblin village is generated complete, then unbuilt: the goblins build
// it during the match. Runs at the end of world generation on the server and
// in the client's world worker alike, so both start from the same world.
import { BLOCK, getBlockDef, isLadder, isSolid, FACING_DIRS } from '../blocks.js';

const inBox = (b, x, y, z) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.z0 && z <= b.z1;

// Keeps every cell the village wrote as a target (plants count as air),
// restores the natural block underneath, and leaves only the Totem Hall.
// plan.construction holds the targets and the initial shaft's dig sequence:
// its opening into the hall, then its 1x1 ladder column bottom-up.
export function unbuildGoblinVillage(world) {
  const plan = world.goblinPlan; if (!plan?.natural) return;
  const hall = plan.fortress.pieces.find(p => p.type === 'totemHall');
  const targets = new Map();
  const cell = key => {
    const x = key % world.sizeX, rest = (key - x) / world.sizeX, z = rest % world.sizeZ;
    return { x, y: (rest - z) / world.sizeZ + world.minY, z };
  };
  for (const [key, natural] of plan.natural) {
    const { x, y, z } = cell(key), id = world.getBlock(x, y, z);
    targets.set(key, getBlockDef(id).shape === 'plant' ? BLOCK.AIR : id);
    if (!inBox(hall.box, x, y, z)) world.setBlock(x, y, z, natural);
  }
  const shaft = plan.fortress.stages.initial.pieces.find(p => p.type === 'shaft');
  // The ladder column runs from the hall up to the natural surface (the
  // castle pad isn't there yet): it ends in the column's top solid block,
  // passing through any caves on the way.
  const ladders = shaft.blocks.filter(b => isLadder(b.id)), sx = shaft.position.x, sz = shaft.position.z;
  const ladder = ladders[0].id, column = [], top = Math.max(world.getSurfaceY(sx, sz, isSolid), hall.box.y1 + 1);
  for (let y = Math.min(...ladders.map(b => b.y)); y <= top; y++) column.push({ x: sx, y, z: sz, id: ladder });
  // The shaft's part inside the hall stands from the start: the plan's
  // initial-stage blocks (ladder, brick lining that backs it, openings). Their
  // final targets are recorded first, for the relocation to restore.
  const inHall = b => inBox(hall.box, b.x, b.y, b.z);
  for (const b of [...shaft.blocks.filter(inHall), ...column.filter(inHall)]) {
    const key = world.cellIndex(b.x, b.y, b.z);
    if (!targets.has(key)) targets.set(key, world.getBlock(b.x, b.y, b.z));
    world.setBlock(b.x, b.y, b.z, b.id);
  }
  // Above the hall the 1x1 column is dug bottom-up. A ladder needs a solid
  // block behind it (facing 0: the z - 1 side); where the column crosses a
  // cave, a brick goes in first.
  const [bx, bz] = [sx + FACING_DIRS[0][0], sz + FACING_DIRS[0][1]], dig = [];
  for (const b of column.filter(b => !inHall(b))) {
    if (!isSolid(world.getBlock(bx, b.y, bz))) dig.push({ x: bx, y: b.y, z: bz, id: BLOCK.GOBLIN_BRICKS });
    dig.push(b);
  }
  plan.construction = { targets, dig, hall: hall.id, column: { x: sx, z: sz, y0: column[0].y, y1: column.at(-1).y } };
  delete plan.natural;
}
