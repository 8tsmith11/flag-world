import { BLOCK } from './blocks.js';
import { TURRET } from './config.js';

// Every turret is a base block with a reserved cell above and a separate head model.
export const TURRET_TYPES = {
  [BLOCK.ARROW_TURRET]: { name: 'arrow turret', ...TURRET, projectile: 'arrow' },
};

export function turretType(block) { return TURRET_TYPES[block] ?? null; }
