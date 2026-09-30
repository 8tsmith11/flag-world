import { getItemDef } from './items.js';

// Minecraft-style crouch placement against a block that normally opens or
// toggles when used. The client selects placement; Game.stepPlace validates it.
export function placesThroughInteraction(crouch,item) {
  if(!crouch||item===null)return false;
  const def=getItemDef(item);
  return def.block!==null||def.places!==null;
}
