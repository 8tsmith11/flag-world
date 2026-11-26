// Port ordering shared by simulation and input validation.
export const FLUID_FACES = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]];
export const fluidFace = (x,y,z) => FLUID_FACES.findIndex(([a,b,c]) => a===x&&b===y&&c===z);
export const oppositeFluidFace = face => face ^ 1;
export const configurableFluidFaces = kind => kind === 'pipe';

// A pipe's connections to machines (non-pipe fluid blocks): face indices.
export function pipeConnections(world, x, y, z, kindAt) {
  const out = [];
  FLUID_FACES.forEach(([dx, dy, dz], face) => {
    const kind = kindAt(world.getBlock(x + dx, y + dy, z + dz));
    if (kind && kind !== 'pipe') out.push(face);
  });
  return out;
}
// The connection a player means when crouch-right-clicking a pipe: the one
// most in line with where they look (a machine behind the pipe wins), or the
// only one. -1 when the pipe touches no machine.
export function chosenPipeFace(world, x, y, z, look, kindAt) {
  let best = -1, score = -Infinity;
  for (const face of pipeConnections(world, x, y, z, kindAt)) {
    const [dx, dy, dz] = FLUID_FACES[face], s = dx * look.x + dy * look.y + dz * look.z;
    if (s > score) { score = s; best = face; }
  }
  return best;
}
