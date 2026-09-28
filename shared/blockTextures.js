import { BLOCK_TEXTURE as C } from './config.js';
export const TEXTURE_TILES = ['ore', 'bricks', 'mossyBricks', 'crackedBricks', 'planks', 'woodSides', 'woodEnds', 'quarry', 'goblinBricks', 'torch'];
export const ATLAS_ROWS = 2 ** Math.ceil(Math.log2(Math.ceil(TEXTURE_TILES.length / C.atlasColumns)));
export function atlasUV(tile, u, v) {
  const index = TEXTURE_TILES.indexOf(tile), pad = (C.tileStride - C.tileSize) / 2;
  return [(index % C.atlasColumns * C.tileStride + pad + u * C.tileSize) / (C.atlasColumns * C.tileStride),
    1 - (Math.floor(index / C.atlasColumns) * C.tileStride + pad + (1 - v) * C.tileSize) / (ATLAS_ROWS * C.tileStride)];
}
