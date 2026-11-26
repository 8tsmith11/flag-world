// Unit-cell boxes for the explosives update's blocks, shared by the chunk
// mesher (the placed block) and the held item models: [{ box, color }].
// The spike barricade's caltrop is in /shared/spikeGeometry.js.
import { SPIKE_PARTS } from '/shared/spikeGeometry.js';

const RED = 0xa83a2a, BAND = 0x3a2a22, LID = 0x7e2c20, LABEL = 0xf2c230, FUSE = 0x2b2b2b;

// Explosive barrel: a red drum with dark hoops, a yellow warning label on
// all four sides and a fuse poking out of the lid.
const barrel = (lit) => [
  { box: [0.14, 0, 0.14, 0.86, 0.9, 0.86], color: lit ? 0xc2452e : RED },
  { box: [0.12, 0.1, 0.12, 0.88, 0.18, 0.88], color: BAND },
  { box: [0.12, 0.7, 0.12, 0.88, 0.78, 0.88], color: BAND },
  { box: [0.2, 0.9, 0.2, 0.8, 0.94, 0.8], color: LID },
  { box: [0.32, 0.32, 0.125, 0.68, 0.56, 0.875], color: LABEL },
  { box: [0.125, 0.32, 0.32, 0.875, 0.56, 0.68], color: LABEL },
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
