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

// Drawbridge mechanism: an iron base, a timber housing with a big bronze
// winch drum through it, and chain posts on top.
export const DRAWBRIDGE_PARTS = [
  { box: [0, 0, 0, 1, 0.22, 1], color: 0x4a4d52 },
  { box: [0.08, 0.22, 0.08, 0.92, 0.78, 0.92], color: 0x6b5a3e },
  { box: [0, 0.32, 0.3, 1, 0.68, 0.7], color: 0xc08a3e },
  { box: [0.3, 0.32, 0, 0.7, 0.68, 1], color: 0xc08a3e },
  { box: [0.04, 0.44, 0.44, 0.96, 0.56, 0.56], color: 0x3a3c40 },
  { box: [0.06, 0.78, 0.06, 0.24, 1, 0.24], color: 0x4a4d52 },
  { box: [0.76, 0.78, 0.06, 0.94, 1, 0.24], color: 0x4a4d52 },
  { box: [0.06, 0.78, 0.76, 0.24, 1, 0.94], color: 0x4a4d52 },
  { box: [0.76, 0.78, 0.76, 0.94, 1, 0.94], color: 0x4a4d52 },
];

// Bridge deck: a full block of timber with plank seams and iron edge straps.
export const BRIDGE_DECK_PARTS = [
  { box: [0, 0, 0, 1, 1, 1], color: 0x9a6f3c },
  { box: [0, 1, 0.32, 1, 1.004, 0.35], color: 0x6e4e28 },
  { box: [0, 1, 0.65, 1, 1.004, 0.68], color: 0x6e4e28 },
  { box: [0, 0.82, -0.004, 1, 0.92, 1.004], color: 0x55585e },
];

export { SPIKE_PARTS };

export const DEFENSE_SHAPES = {
  barrel: BARREL_PARTS, litBarrel: LIT_BARREL_PARTS, spikes: SPIKE_PARTS,
  drawbridge: DRAWBRIDGE_PARTS, bridgeDeck: BRIDGE_DECK_PARTS,
};
