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

// Life overlay samples actual graph regions. The full-resolution map remains
// available above for door/ladder inspection; this compact map labels areas.
export function lifeMap(world, step = 4) {
  const p = world.goblinPlan, areas = [...p.areas, ...p.outskirts];
  const nodes = areas.flatMap(a => [...a.nodes].map(k => ({ ...p.graph.get(k), id: a.id, kind: a.kind })));
  const surface = nodes.filter(n => n.kind !== 'underground' && Number.isFinite(n.x));
  const x0 = Math.min(...surface.map(n => n.x)), x1 = Math.max(...surface.map(n => n.x));
  const z0 = Math.min(...surface.map(n => n.z)), z1 = Math.max(...surface.map(n => n.z));
  const cells = new Map(surface.map(n => [cellKey(n.x, n.z), n.id]));
  const walls = new Set(p.surface.rings.flatMap(r => r.wall.map(n => cellKey(n.x, n.z))));
  const gates = new Set(p.gates.filter(g => g.kind !== 'underground' && g.kind !== 'shaft').flatMap(g => g.cells.map(n => cellKey(n.x, n.z))));
  const lines = [`Seed ${world.seed}; ${step} blocks/cell; surface areas uppercase, outskirts lowercase; # wall, + gate`];
  const glyph = id => String.fromCharCode((id.startsWith('O') ? 97 : 65) + areas.filter(a => a.kind === (id.startsWith('O') ? 'outskirts' : 'surface')).findIndex(a => a.id === id));
  for (let z = z0; z <= z1; z += step) {
    let row = '';
    for (let x = x0; x <= x1; x += step) {
      const keys = []; for (let dz = 0; dz < step; dz++) for (let dx = 0; dx < step; dx++) keys.push(cellKey(x + dx, z + dz));
      const ids = keys.map(k => cells.get(k)).filter(Boolean);
      row += gates.has(cellKey(x, z)) || keys.some(k => gates.has(k)) ? '+'
        : keys.some(k => walls.has(k)) ? '#' : ids.length ? glyph(ids.sort((a,b) => ids.filter(id=>id===b).length-ids.filter(id=>id===a).length)[0]) : ' ';
    }
    lines.push(row.trimEnd());
  }
  lines.push(areas.filter(a => a.kind !== 'underground').map(a => `${glyph(a.id)}=${a.id} (${a.nodes.size} cells)`).join(' '));
  const underground = nodes.filter(n => n.kind === 'underground' && Number.isFinite(n.x));
  const ux0 = Math.min(...underground.map(n => n.x)), ux1 = Math.max(...underground.map(n => n.x));
  const uz0 = Math.min(...underground.map(n => n.z)), uz1 = Math.max(...underground.map(n => n.z));
  for (const y of [...new Set(p.fortress.pieces.filter(room => room.tags.includes('room')).map(room => room.position.y + 1))].sort((a,b) => b-a)) {
    const floor = new Map(underground.filter(n => n.y === y).map(n => [cellKey(n.x, n.z), n.id.slice(1)]));
    const doors = new Set(p.gates.filter(g => g.kind === 'underground').flatMap(g => g.cells.filter(n => n.y === y).map(n => cellKey(n.x, n.z))));
    lines.push(`Underground feet level ${y}; digits label U1..U8, + gate; ${step} blocks/cell`);
    for (let z = uz0; z <= uz1; z += step) {
      let row = '';
      for (let x = ux0; x <= ux1; x += step) {
        const keys = []; for (let dz = 0; dz < step; dz++) for (let dx = 0; dx < step; dx++) keys.push(cellKey(x + dx, z + dz));
        const ids = keys.map(k => floor.get(k)).filter(Boolean);
        row += keys.some(k => doors.has(k)) ? '+' : ids.length ? ids.sort((a,b) => ids.filter(id=>id===b).length-ids.filter(id=>id===a).length)[0] : ' ';
      }
      lines.push(row.trimEnd());
    }
  }
  lines.push('Underground: ' + p.areas.filter(a => a.kind === 'underground').map(a => `${a.id}: ${a.nodes.size} cells; spawns ${a.spawns.map(s=>s.id).join(',')}`).join(' | '));
  lines.push('Gates: ' + p.gates.map(g => `${g.id} ${g.areas.join('<->')}`).join('; '));
  return lines.join('\n');
}
