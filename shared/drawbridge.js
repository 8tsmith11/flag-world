// Drawbridge deck geometry, shared by the server (server/drawbridge.js), the
// slide effects and the placement preview. The mechanism faces `dir` (0 north,
// 1 east, 2 south, 3 west). With `side` 1 (right) or -1 (left) the deck runs
// beside it: the first section right next to the mechanism on that side, the
// rest straight out in the facing direction, so crossing never means walking
// over the machine. `side` 0 is the old layout (straight out of its front),
// kept for drawbridges saved before sides existed.
export const BRIDGE_DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// The deck cell `i` sections out (1 = the first section); i = 0 is the
// mechanism itself (where a section slides out from).
export function drawbridgeCell(node, dir, side, i) {
  if (i === 0) return { x: node.x, y: node.y, z: node.z };
  const [dx, dz] = BRIDGE_DIRS[dir];
  if (!side) return { x: node.x + dx * i, y: node.y, z: node.z + dz * i };
  // Right of facing (dx, dz) is (-dz, dx).
  const rx = -dz * side, rz = dx * side;
  return { x: node.x + rx + dx * (i - 1), y: node.y, z: node.z + rz + dz * (i - 1) };
}
