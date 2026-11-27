// The iron spike barricade's shape: a three-dimensional caltrop. Four spikes
// run along the cube's four body diagonals, crossing at the center, so eight
// points reach out toward the eight corners of the block, and six shorter
// spikes point straight out of the middle of each face. It is drawn from
// small boxes (like every block in the game): a hub at the center and, along
// each spike, a chain of cubes that shrinks toward the tip. The shape is the
// same under any mirroring of the three axes, so it never needs turning,
// whichever surface it sits on.
//
// Used by the chunk mesher (the block), the held item model and the checks.

// The eight half-diagonal directions (one per cube corner).
export const SPIKE_DIRECTIONS = [];
for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) SPIKE_DIRECTIONS.push([sx, sy, sz]);
// The six face directions (one per face).
export const FACE_SPIKE_DIRECTIONS = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];

// Distance along each half-diagonal (0 center, 1 the corner) and half-size
// of the cube there.
const STEPS = [[0.2, 0.1], [0.38, 0.082], [0.55, 0.064], [0.7, 0.047], [0.83, 0.032], [0.93, 0.019]];
// Face spikes: distance from the center (0.5 is the face) and half-size.
const FACE_STEPS = [[0.17, 0.085], [0.26, 0.068], [0.34, 0.052], [0.41, 0.037], [0.455, 0.024], [0.484, 0.012]];
const HUB = 0.13;
export const SPIKE_DARK = 0x8a9098;
export const SPIKE_LIGHT = 0xd2d7dd;

const cube = (cx, cy, cz, h, color) => ({ box: [cx - h, cy - h, cz - h, cx + h, cy + h, cz + h], color });

// [{ box: [x0,y0,z0,x1,y1,z1], color }] in the unit cell.
export const SPIKE_PARTS = [cube(0.5, 0.5, 0.5, HUB, SPIKE_DARK)];
for (const [sx, sy, sz] of SPIKE_DIRECTIONS) {
  STEPS.forEach(([t, h], i) => {
    const d = 0.5 * t;
    SPIKE_PARTS.push(cube(0.5 + sx * d, 0.5 + sy * d, 0.5 + sz * d, h, i >= STEPS.length - 2 ? SPIKE_LIGHT : SPIKE_DARK));
  });
}
for (const [sx, sy, sz] of FACE_SPIKE_DIRECTIONS) {
  FACE_STEPS.forEach(([d, h], i) => {
    SPIKE_PARTS.push(cube(0.5 + sx * d, 0.5 + sy * d, 0.5 + sz * d, h, i >= FACE_STEPS.length - 2 ? SPIKE_LIGHT : SPIKE_DARK));
  });
}
