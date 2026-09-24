import { ITEM } from './itemIds.js';

export const ACCESSORIES = {
  [ITEM.WIND_BOOTS]: { name: 'wind boots', color: 0xd8eef1, visual: 'wind', moveMultiplier: 1.25 },
  [ITEM.SPRING_BOOTS]: { name: 'spring boots', color: 0xc9ae72, visual: 'spring',
    chargeSeconds: 1, jumpHeight: 5, bounceScale: 0.5, minBounceHeight: 1 },
  [ITEM.HEART_AMULET]: { name: 'heart amulet', color: 0xdd3e4d, visual: 'heart', maxHpBonus: 5 },
  [ITEM.MENDING_CHARM]: { name: 'mending charm', color: 0x79dcb0, visual: 'mending', regenDelay: 5, regenInterval: 2 },
  [ITEM.EMBER_HEART]: { name: 'ember heart', color: 0xff7b28, visual: 'ember', rescueHp: 10, invulnerableSeconds: 1 },
};

export const RIFT_STONE = { durationSeconds: 10, maxStack: 4 };

export function accessoryDef(item) {
  return ACCESSORIES[item] ?? null;
}
