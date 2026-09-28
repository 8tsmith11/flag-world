import { BLOCK, ladderBlock } from '../blocks.js';
import { GOBLIN_GEN } from '../config.js';
const B = BLOCK.GOBLIN_BRICKS;
export function surfaceContent(C = GOBLIN_GEN) {
  const connector = (x, z, facing, pool = 'paths') => ({ x, y: 1, z, facing, pool, name: 'walk', maxStep: C.surfaceStep });
  const piece = (id, type, width, length, height, tags = []) => ({ id, type, x0: -(width >> 1), x1: width >> 1,
    z0: -(length >> 1), z1: length >> 1, y0: 0, y1: height, tags,
    retainingBlock: B, clearance: C.outerMargin, earthwork: C.earthwork, blocks: [], connectors: [] });
  const put = (p, x, y, z, id) => p.blocks.push({ x, y, z, id });
  const pieces = { cap: piece('cap', 'cap', 1, 1, 0) }, pools = {};
  const castle = piece('castle', 'castle', C.castleWidth, C.castleWidth, C.castleTowerHeight, ['core']);
  castle.platforms = [];
  castle.earthwork = C.castleEarthwork;
  const h = castle.x1, t = C.castleTowerWidth >> 1;
  for (let z = -h; z <= h; z++) for (let x = -h; x <= h; x++) {
    put(castle, x, 0, z, Math.abs(x) <= 1 && Math.abs(z) <= 1 ? B : BLOCK.STONE_BRICKS);
    for (let y = 1; y <= castle.y1 + 1; y++) put(castle, x, y, z, BLOCK.AIR);
    const corner = Math.abs(x) >= h - 2 * t && Math.abs(z) >= h - 2 * t;
    const edge = Math.abs(x) === h || Math.abs(z) === h;
    if (!corner && edge) {
      for (let y = 1; y <= C.castleWallHeight; y++) put(castle, x, y, z, y <= 2 ? BLOCK.STONE_BRICKS : B);
      if ((x + z) % 2 === 0) put(castle, x, C.castleWallHeight + 1, z, B);
    }
    // Wooden galleries along the inside walls, clear of the shaft courtyard.
    if (!corner && (Math.abs(x) === h - 1 || Math.abs(z) === h - 1)) put(castle, x, C.castleGalleryHeight, z, BLOCK.PLANKS);
  }
  // Four spacious towers. Their central hatch ladders are behind solid poles.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cx = sx * (h - t), cz = sz * (h - t);
    for (let z = cz - t; z <= cz + t; z++) for (let x = cx - t; x <= cx + t; x++) {
      const edge = Math.abs(x - cx) === t || Math.abs(z - cz) === t;
      for (let y = 1; y < C.castleTowerHeight; y++) put(castle, x, y, z, edge ? B : BLOCK.AIR);
      put(castle, x, C.castleTowerHeight, z, BLOCK.PLANKS);
    }
    for (let y = 1; y <= C.castleTowerHeight; y++) {
      put(castle, cx, y, cz - 1, B); put(castle, cx, y, cz, ladderBlock(0));
    }
    castle.platforms.push({ x: cx, y: C.castleTowerHeight, z: cz, width: C.castleTowerWidth,
      ladder: { x: cx, y: 1, z: cz } });
    const ix = cx - sx * t;
    for (let y = 1; y <= C.passageHeight; y++) put(castle, ix, y, cz, BLOCK.AIR);
  }
  // Gate and smaller posterns connect the Castle to all four village roads.
  castle.connectors = [connector(0, -h, 0), connector(h, 0, 1), connector(0, h, 2), connector(-h, 0, 3)];
  for (const c of castle.connectors) {
    for (let side = -1; side <= 1; side++) for (let y = 1; y <= C.gateClearance; y++) {
      put(castle, c.x + (c.x ? 0 : side), y, c.z + (c.z ? 0 : side), BLOCK.AIR);
    }
    // Timber framing and hanging dark banners beside each passage.
    for (const side of [-2, 2]) for (let y = 1; y <= C.gateClearance + 1; y++) {
      put(castle, c.x + (c.x ? 0 : side), y, c.z + (c.z ? 0 : side), y === 2 ? BLOCK.SCORCHED_EARTH : BLOCK.WOOD);
    }
  }
  for (const x of [-3, 3]) { put(castle, x, 1, -3, BLOCK.STONE_BRICKS); put(castle, x, 2, -3, BLOCK.IRON_ORE); }
  pieces.castle = castle;
  for (const material of ['dirt', 'plank', 'ramp', 'bridge']) {
    const p = piece(material + 'Path', 'path', C.pathWidth, C.pathLength, 0);
    p.earthwork = C.pathEarthwork; p.waterCrossing = material === 'bridge';
    for (let z = p.z0; z <= p.z1; z++) for (let x = p.x0; x <= p.x1; x++) put(p, x, 0, z,
      material === 'plank' || material === 'bridge' ? BLOCK.PLANKS : BLOCK.DIRT);
    p.connectors = [connector(0, p.z1, 2, 'ends'), connector(0, p.z0, 0, 'buildings')]; pieces[p.id] = p;
  }
  // Historical post-and-plank houses, with open windows, layered roofs and
  // overhangs. The whole roof belongs to the footprint used for collision.
  for (const kind of ['home', 'longhouse', 'storehouse', 'workshop']) for (let v = 0; v < C.buildingVariants; v++) {
    const p = piece(`${kind}${v}`, kind, C.buildingWidth, C.buildingWidth + v * C.variantLengthStep,
      C.buildingHeight + C.roofRise);
    const hx = p.x1 - 1, hz = p.z1 - 1;
    for (let z = p.z0; z <= p.z1; z++) for (let x = p.x0; x <= p.x1; x++) {
      put(p, x, 0, z, BLOCK.PLANKS);
      for (let y = 1; y <= p.y1; y++) put(p, x, y, z, BLOCK.AIR);
      if (Math.abs(x) <= hx && Math.abs(z) <= hz) for (let y = 1; y <= C.buildingHeight; y++) {
        const edge = Math.abs(x) === hx || Math.abs(z) === hz;
        const post = Math.abs(x) === hx && (Math.abs(z) === hz || z % 4 === 0);
        const window = y === 2 && edge && !post && (x + z + v) % 2 === 0;
        put(p, x, y, z, post ? BLOCK.WOOD : edge && !window ? BLOCK.PLANKS : BLOCK.AIR);
      }
      const roofY = C.buildingHeight + Math.min(C.roofRise, p.x1 - Math.abs(x));
      // Close each gable up to its stepped roof.
      if (Math.abs(z) === hz && Math.abs(x) <= hx) {
        for (let y = C.buildingHeight + 1; y < roofY; y++) put(p, x, y, z, BLOCK.PLANKS);
      }
      put(p, x, roofY, z, v === 2 ? BLOCK.WOOD : BLOCK.PLANKS);
    }
    p.connectors = [connector(0, p.z1, 2, 'ends'), connector(0, p.z0, 0), connector(p.x0, 0, 3), connector(p.x1, 0, 1)];
    for (const c of p.connectors) {
      const dx = Math.sign(c.x), dz = Math.sign(c.z);
      for (let i = 0; i <= 1; i++) for (let y = 1; y <= C.passageHeight; y++) put(p, c.x - dx * i, y, c.z - dz * i, BLOCK.AIR);
    }
    // Entrances remain open holes.
    put(p, -hx + 1, 1, -hz + 1, kind === 'workshop' ? BLOCK.WORKBENCH : BLOCK.PLANKS);
    put(p, hx - 1, 1, -hz + 1, kind === 'storehouse' ? BLOCK.CHEST : BLOCK.WOOD);
    if (v === 1) for (let y = 1; y <= p.y1; y++) put(p, hx - 1, y, -hz + 1, BLOCK.STONE_BRICKS);
    pieces[p.id] = p;
  }
  const tower = piece('archerTower', 'tower', C.buildingWidth, C.buildingWidth, C.towerHeight);
  for (let z = tower.z0; z <= tower.z1; z++) for (let x = tower.x0; x <= tower.x1; x++) {
    put(tower, x, 0, z, BLOCK.PLANKS);
    for (let y = 1; y <= C.towerHeight + 1; y++) put(tower, x, y, z, BLOCK.AIR);
    put(tower, x, C.towerHeight, z, BLOCK.PLANKS);
    if (Math.abs(x) === tower.x1 && Math.abs(z) === tower.z1) for (let y = 1; y < C.towerHeight; y++) put(tower, x, y, z, BLOCK.WOOD);
  }
  for (let y = 1; y <= C.towerHeight; y++) {
    put(tower, 0, y, -1, BLOCK.WOOD); put(tower, 0, y, 0, ladderBlock(0));
  }
  tower.platforms = [{ x: 0, y: C.towerHeight, z: 0, width: C.buildingWidth, ladder: { x: 0, y: 1, z: 0 } }];
  tower.connectors = [connector(0, tower.z1, 2, 'ends')]; pieces[tower.id] = tower;
  pools.paths = { entries: ['dirt', 'plank', 'ramp', 'bridge'].map(m => ({ id: m + 'Path', weight: m === 'bridge' ? C.weights.bridge : C.weights.path })), fallback: 'cap' };
  pools.buildings = { entries: Object.values(pieces).filter(p => ['home', 'longhouse', 'storehouse', 'workshop', 'tower'].includes(p.type))
    .map(p => ({ id: p.id, weight: p.type === 'tower' ? C.weights.tower : C.weights.building,
      required: ['archerTower', 'home0', 'longhouse0', 'storehouse0', 'workshop0'].includes(p.id) })), fallback: 'cap' };
  pools.ends = { entries: [], fallback: 'cap' };
  return { pieces, pools };
}
