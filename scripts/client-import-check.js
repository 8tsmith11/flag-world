// Link the real browser entry and its imports without executing DOM/WebGL code.
// Use the page's import map and the static routes defined in server.js.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceTextModule } from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://localhost/';
const html = readFileSync(path.join(root, 'public/index.html'), 'utf8');
const { imports } = JSON.parse(html.match(/<script\s+type="importmap">([\s\S]*?)<\/script>/)[1]);
const modules = new Map();
const routes = [
  ['/shared/', 'shared/'],
  ['/vendor/three/', 'node_modules/three/build/'],
  ['/vendor/simplex-noise/', 'node_modules/simplex-noise/dist/esm/'],
  ['/', 'public/'],
];

function load(url) {
  if (modules.has(url)) return modules.get(url);
  const pathname = new URL(url).pathname;
  const [prefix, directory] = routes.find(([prefix]) => pathname.startsWith(prefix));
  const filename = path.join(root, directory, pathname.slice(prefix.length));
  const module = new SourceTextModule(readFileSync(filename, 'utf8'), { identifier: url });
  modules.set(url, module);
  return module;
}

const entry = html.match(/<script\s+type="module"\s+src="([^"]+)"/)[1];
const link = (specifier, parent) => {
  const mapped = imports[specifier] ?? specifier;
  if (!mapped.startsWith('/') && !mapped.startsWith('.')) throw new Error(`Missing import map entry: ${specifier}`);
  return load(new URL(mapped, parent.identifier).href);
};
await load(new URL(entry, origin).href).link(link);
// Module workers have their own module graph and no document import map.
await load(new URL('/js/worldWorker.js', origin).href).link((specifier, parent) => {
  if (!specifier.startsWith('/') && !specifier.startsWith('.')) throw new Error(`Worker needs an explicit URL: ${specifier}`);
  return load(new URL(specifier, parent.identifier).href);
});
console.log(`OK: browser entry links ${modules.size} modules`);
