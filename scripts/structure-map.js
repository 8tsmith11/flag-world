import { generateWorld, parseSeed } from '../shared/worldgen.js';
import { isSolid, isLadder } from '../shared/blocks.js';
import { cellKey } from '../shared/structures/buildability.js';
import { pathToFileURL } from 'node:url';
const glyphs = { castle: 'C', home: 'h', longhouse: 'L', workshop: 'W', storehouse: 'S', tower: 'T', path: '.' };
const inside = (b, x, y, z) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && y >= b.y0 && y <= b.y1;

export function surfaceMap(world, overview = false) {
  const { surface: s, fortress: f, buildability: map, settings: C } = world.goblinPlan;
  const cells = new Map(), put = (x, z, c) => cells.set(cellKey(x, z), c);
  for (const c of map.cells.values()) put(c.x, c.z, c.reserved ? 'r' : c.keepOut ? 'X' : c.water === 'lake' ? '~' : c.water === 'puddle' ? ',' : ' ');
  for (const p of f.pieces.filter(p => p.tags.includes('protrusion'))) for (let z = p.box.z0; z <= p.box.z1; z++) for (let x = p.box.x0; x <= p.box.x1; x++) put(x, z, 'P');
  for (const p of s.pieces) for (let z = p.box.z0; z <= p.box.z1; z++) for (let x = p.box.x0; x <= p.box.x1; x++) put(x, z, glyphs[p.type] ?? '?');
  for (const r of s.roads) if (cells.get(cellKey(r.x, r.z)) === ' ') put(r.x, r.z, '.');
  for (const ring of s.rings) {
    for (const w of ring.wall) put(w.x, w.z, ring.name === 'outer' ? '#' : 'i');
    for (const g of ring.gates) put(g.x, g.z, '+');
  }
  for (const p of s.gatehouses) for (const b of p.blocks) put(b.x, b.z, 'G');
  for (const p of s.posts) put(p.x, p.z, 'a');
  put(s.pieces[0].position.x, s.pieces[0].position.z, 'E');
  const boxes = [...s.pieces, ...s.gatehouses].map(p => p.box);
  const step = overview ? C.map.overviewStep : 1, margin = C.map.margin;
  const x0 = overview ? map.x0 : Math.min(...boxes.map(b => b.x0), ...s.rings.flatMap(r => r.wall.map(w => w.x))) - margin;
  const x1 = overview ? map.x0 + map.width - 1 : Math.max(...boxes.map(b => b.x1), ...s.rings.flatMap(r => r.wall.map(w => w.x))) + margin;
  const z0 = overview ? map.z0 : Math.min(...boxes.map(b => b.z0), ...s.rings.flatMap(r => r.wall.map(w => w.z))) - margin;
  const z1 = overview ? map.z0 + map.width - 1 : Math.max(...boxes.map(b => b.z1), ...s.rings.flatMap(r => r.wall.map(w => w.z))) + margin;
  const priority = 'EGa+Ci#ThLSWPX~r,.';
  const lines = [`${overview ? 'Island overview' : 'Surface detail'} x=${x0}..${x1} z=${z0}..${z1}, ${step} blocks/cell`,
    '# outer wall i compound wall + gate G gatehouse a archer post C Castle E shaft h home L longhouse S storehouse W workshop T tower . path r reserved P cliff gallery ~ water X keep-out'];
  for (let z = z0; z <= z1; z += step) {
    let row = '';
    for (let x = x0; x <= x1; x += step) {
      let glyph = ' ';
      for (let dz = 0; dz < step; dz++) for (let dx = 0; dx < step; dx++) {
        const c = cells.get(cellKey(x + dx, z + dz)) ?? ' ';
        if (c !== ' ' && (glyph === ' ' || priority.indexOf(c) < priority.indexOf(glyph))) glyph = c;
      }
      row += glyph;
    }
    lines.push(row.trimEnd());
  }
  return lines.join('\n');
}
export function fortressSlice(world, y) {
  const { fortress: f } = world.goblinPlan;
  const active = f.pieces.filter(p => y >= p.box.y0 && y <= p.box.y1);
  const shaft = f.shaft;
  if (y >= shaft.box.y0 && y <= shaft.box.y1) active.push(shaft);
  if (!active.length) return '';
  const x0 = Math.min(...active.map(p => p.box.x0)), x1 = Math.max(...active.map(p => p.box.x1));
  const z0 = Math.min(...active.map(p => p.box.z0)), z1 = Math.max(...active.map(p => p.box.z1));
  const labels = f.pieces.filter(p => p.tags.includes('room'));
  const routePieces = new Set(f.routeOrder);
  const lines = [`Level ${y}; x=${x0}..${x1} z=${z0}..${z1}`, '# brick . interior * main route ^ ladder o window P exterior brick'];
  for (let z = z0; z <= z1; z++) {
    let row = '';
    for (let x = x0; x <= x1; x++) {
      const p = active.find(p => inside(p.box, x, y, z));
      if (!p) { row += ' '; continue; }
      const id = world.getBlock(x, y, z), exterior = p.tags.includes('protrusion') && !world.goblinPlan.buildability.cells.has(cellKey(x, z));
      let c = isSolid(id) ? exterior ? 'P' : '#' : '.';
      if (!isSolid(id) && p.windows?.some(w => w.x === x && w.y === y && w.z === z)) c = 'o';
      if (!isSolid(id) && routePieces.has(p.id) && p.route.some(a => a.x === x && a.y === y && a.z === z)) c = '*';
      if (isLadder(id)) c = '^';
      const label = labels.findIndex(q => q.position.x === x && q.position.z === z && y === q.position.y + 1);
      if (label !== -1 && !isSolid(id)) c = label < 26 ? String.fromCharCode(65 + label) : String.fromCharCode(97 + label - 26);
      row += c;
    }
    lines.push(row.trimEnd());
  }
  return lines.join('\n');
}
export function structureMap(world, slices = true) {
  const { fortress: f, settings: C } = world.goblinPlan;
  const labels = f.pieces.filter(p => p.tags.includes('room'));
  const lines = [`Seed ${world.seed}; reserve radius ${C.reservedRadius}; target rooms ${C.roomCount}; depth ${C.directDepth}`,
    surfaceMap(world, true), surfaceMap(world),
    'Route: Castle entrance -> upper shaft -> ' + f.roomOrder.map(id => {
      const p = f.pieces.find(p => p.id === id); return `${p.type}@${p.position.x},${p.position.y + 1},${p.position.z}`;
    }).join(' -> '),
    'Fortress labels: ' + labels.map((p, i) => `${i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(97 + i - 26)}=${p.type}@${p.position.y + 1}`).join(' ')];
  if (slices) for (let y = f.shaft.box.y1; y >= Math.min(...f.pieces.map(p => p.box.y0)); y--) lines.push(fortressSlice(world, y));
  return lines.filter(Boolean).join('\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const world = generateWorld(parseSeed(args[0] ?? '1'), 2, args[1] ?? 'small');
  console.log(structureMap(world, !process.argv.includes('--surface-only')));
}
