// Writes a resolved plan in phase order; all decisions were made before this.
// Shared policy for every producer, including older standalone structures.
export function structureAllowed(world,box,margin=0) {
  return !(world.reservedZones??[]).some(r=>{
    const dx=Math.max(box.x0-margin-r.x,0,r.x-box.x1-margin);
    const dz=Math.max(box.z0-margin-r.z,0,r.z-box.z1-margin);
    return dx*dx+dz*dz<=r.radius*r.radius;
  });
}
export function placePlan(world, plan) {
  if(plan.pieces.some(p=>!structureAllowed(world,p.box)))throw new Error('Structure plan overlaps reserved terrain');
  const clearance=world.plantClearance??=new Map();
  const write=b=>{
    world.setBlock(b.x,b.y,b.z,b.id);
    // Include planned air above roads/platforms; trees must preserve headroom.
    const key=b.x+world.sizeX*b.z;
    clearance.set(key,Math.max(clearance.get(key)??-Infinity,b.y));
  };
  for (const piece of plan.pieces) {
    for (const b of piece.earthworks ?? []) write(b);
    for (const b of piece.blocks) write(b);
    for (const chest of piece.loot ?? []) world.lootChests.set(`${chest.x},${chest.y},${chest.z}`, chest.table);
    world.structures.push({ kind: piece.type, civilization: plan.civilization,
      x: piece.position.x, y: piece.position.y, z: piece.position.z, box: { ...piece.box } });
  }
  for (const b of plan.finishing ?? []) write(b);
}
