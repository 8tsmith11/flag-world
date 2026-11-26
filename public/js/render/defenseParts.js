// Unit-cell boxes for the explosives update's blocks, shared by the chunk
// mesher (the placed block) and the held item models: [{ box, color }].
// The spike barricade's caltrop is in /shared/spikeGeometry.js.
import { SPIKE_PARTS } from '/shared/spikeGeometry.js';

const RED = 0xa83a2a, BAND = 0x3a2a22, LID = 0x7e2c20, BONE = 0xeee8d8, SOCKET = 0x1b1414, FUSE = 0x2b2b2b;

// The barrel's skull, in face coordinates: u across the face (0..1), v up
// it, and how far it stands out from the drum (bone, then the dark sockets
// in front of it). Big: about half the block wide and tall.
const SKULL = [
  [0.27, 0.42, 0.73, 0.68, BONE], [0.3, 0.68, 0.7, 0.71, BONE],          // cranium
  [0.33, 0.3, 0.67, 0.42, BONE],                                           // cheeks and jaw
  [0.35, 0.22, 0.42, 0.3, BONE], [0.465, 0.22, 0.535, 0.3, BONE], [0.58, 0.22, 0.65, 0.3, BONE], // teeth
  [0.33, 0.45, 0.46, 0.58, SOCKET], [0.54, 0.45, 0.67, 0.58, SOCKET],      // eyes
  [0.47, 0.35, 0.53, 0.42, SOCKET],                                        // nose
];
const DRUM = 0.14;
// Boxes for one face of the drum: 0 north (-z), 1 east (+x), 2 south (+z), 3 west (-x).
function skullFace(face) {
  return SKULL.map(([u0, v0, u1, v1, color]) => {
    const out = color === SOCKET ? 0.022 : 0.014, a = DRUM - out, b = DRUM + 0.002;
    const [lo, hi] = face === 0 || face === 3 ? [u0, u1] : [1 - u1, 1 - u0];
    if (face === 0) return { box: [lo, v0, a, hi, v1, b], color };
    if (face === 2) return { box: [lo, v0, 1 - b, hi, v1, 1 - a], color };
    if (face === 3) return { box: [a, v0, lo, b, v1, hi], color };
    return { box: [1 - b, v0, lo, 1 - a, v1, hi], color };
  });
}

// Explosive barrel: a red drum with dark hoops, a big skull on each of its
// four sides and a fuse poking out of the lid.
const barrel = (lit) => [
  { box: [DRUM, 0, DRUM, 1 - DRUM, 0.9, 1 - DRUM], color: lit ? 0xc2452e : RED },
  { box: [0.12, 0.08, 0.12, 0.88, 0.15, 0.88], color: BAND },
  { box: [0.12, 0.76, 0.12, 0.88, 0.83, 0.88], color: BAND },
  { box: [0.2, 0.9, 0.2, 0.8, 0.94, 0.8], color: LID },
  ...[0, 1, 2, 3].flatMap(skullFace),
  { box: [0.47, 0.94, 0.47, 0.53, lit ? 1.02 : 1.1, 0.53], color: FUSE },
  ...(lit ? [{ box: [0.44, 1.0, 0.44, 0.56, 1.1, 0.56], color: 0xffd36a }] : []),
];
export const BARREL_PARTS = barrel(false);
export const LIT_BARREL_PARTS = barrel(true);

// Drawbridge mechanism, steampunk: a riveted iron base, a copper boiler
// housing with brass bands, a toothed brass gear on the east and west sides,
// a pressure gauge on the north and south sides, a red valve wheel and a
// smokestack with a brass cap on top.
const IRON = 0x3b3d42, COPPER = 0xb5683a, BRASS = 0xd4a24c, DARK_BRASS = 0x9c7330;
function gear(side) {
  // A brass disc with eight teeth round it and a dark axle, in the y-z plane
  // on the +x (side 1) or -x (side -1) face.
  const x0 = side > 0 ? 0.88 : 0.05, x1 = side > 0 ? 0.95 : 0.12, cy = 0.46, cz = 0.5, r = 0.24, t = 0.055;
  const parts = [{ box: [x0, cy - 0.19, cz - 0.19, x1, cy + 0.19, cz + 0.19], color: BRASS }];
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, y = cy + Math.sin(a) * r, z = cz + Math.cos(a) * r;
    parts.push({ box: [x0 + 0.005, y - t, z - t, x1 - 0.005, y + t, z + t], color: DARK_BRASS });
  }
  const ax0 = side > 0 ? 0.95 : 0.02, ax1 = side > 0 ? 0.98 : 0.05;
  parts.push({ box: [ax0, cy - 0.06, cz - 0.06, ax1, cy + 0.06, cz + 0.06], color: IRON });
  return parts;
}
function gauge(side) {
  // A cream dial in a brass rim with a red needle, on the -z (side -1) or +z face.
  const z = side > 0 ? 0.88 : 0.12, out = side > 0 ? 1 : -1;
  const slab = (x0, y0, x1, y1, d0, d1, color) => ({ box: [x0, y0, Math.min(z + out * d0, z + out * d1), x1, y1, Math.max(z + out * d0, z + out * d1)], color });
  return [
    slab(0.34, 0.34, 0.66, 0.66, 0, 0.03, BRASS),
    slab(0.38, 0.38, 0.62, 0.62, 0.02, 0.04, 0xf1e6c8),
    slab(0.49, 0.49, 0.6, 0.52, 0.035, 0.05, 0xb3261e),
    slab(0.48, 0.48, 0.52, 0.52, 0.035, 0.055, IRON),
  ];
}
export const DRAWBRIDGE_PARTS = [
  { box: [0, 0, 0, 1, 0.16, 1], color: IRON },
  ...[[0.04, 0.04], [0.88, 0.04], [0.04, 0.88], [0.88, 0.88]].map(([x, z]) => ({ box: [x, 0.16, z, x + 0.08, 0.2, z + 0.08], color: BRASS })),
  { box: [0.12, 0.16, 0.12, 0.88, 0.76, 0.88], color: COPPER },
  { box: [0.1, 0.26, 0.1, 0.9, 0.31, 0.9], color: BRASS },
  { box: [0.1, 0.62, 0.1, 0.9, 0.67, 0.9], color: BRASS },
  ...gear(1), ...gear(-1), ...gauge(1), ...gauge(-1),
  { box: [0.16, 0.76, 0.16, 0.84, 0.8, 0.84], color: DARK_BRASS },
  // Valve wheel: a red ring of four bars round a hub on a short stem.
  { box: [0.27, 0.8, 0.27, 0.33, 0.86, 0.33], color: IRON },
  { box: [0.18, 0.86, 0.18, 0.42, 0.89, 0.22], color: 0x8a2a1e },
  { box: [0.18, 0.86, 0.38, 0.42, 0.89, 0.42], color: 0x8a2a1e },
  { box: [0.18, 0.86, 0.18, 0.22, 0.89, 0.42], color: 0x8a2a1e },
  { box: [0.38, 0.86, 0.18, 0.42, 0.89, 0.42], color: 0x8a2a1e },
  { box: [0.28, 0.86, 0.28, 0.32, 0.9, 0.32], color: BRASS },
  // Smokestack with a brass cap.
  { box: [0.6, 0.8, 0.6, 0.78, 1.0, 0.78], color: 0x2e3034 },
  { box: [0.57, 0.95, 0.57, 0.81, 1.0, 0.81], color: BRASS },
];

// Bridge deck section, steampunk: timber planks over an iron truss (corner
// posts and a cross beam), with brass edging and rivets. Still a full solid
// block to walk on.
const WOOD = 0x9a6f3c, SEAM = 0x6e4e28;
export const BRIDGE_DECK_PARTS = [
  { box: [0, 0.72, 0, 1, 1, 1], color: WOOD },
  { box: [0, 1, 0.32, 1, 1.004, 0.35], color: SEAM },
  { box: [0, 1, 0.65, 1, 1.004, 0.68], color: SEAM },
  { box: [0, 0.62, 0, 1, 0.72, 1], color: IRON },
  ...[[0, 0], [0.9, 0], [0, 0.9], [0.9, 0.9]].map(([x, z]) => ({ box: [x, 0, z, x + 0.1, 0.62, z + 0.1], color: IRON })),
  { box: [0.45, 0.05, 0, 0.55, 0.62, 1], color: 0x4a4d52 },
  { box: [0, 0.05, 0.45, 1, 0.15, 0.55], color: 0x4a4d52 },
  { box: [-0.004, 0.9, -0.004, 1.004, 0.95, 0.04], color: BRASS },
  { box: [-0.004, 0.9, 0.96, 1.004, 0.95, 1.004], color: BRASS },
  ...[[0.06, 0.06], [0.88, 0.06], [0.06, 0.88], [0.88, 0.88]].map(([x, z]) => ({ box: [x, 1, z, x + 0.06, 1.012, z + 0.06], color: DARK_BRASS })),
];

export { SPIKE_PARTS };

export const DEFENSE_SHAPES = {
  barrel: BARREL_PARTS, litBarrel: LIT_BARREL_PARTS, spikes: SPIKE_PARTS,
  drawbridge: DRAWBRIDGE_PARTS, bridgeDeck: BRIDGE_DECK_PARTS,
};
