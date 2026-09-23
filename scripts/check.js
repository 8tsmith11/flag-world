// `npm run check`: syntax-checks every JavaScript file, then imports the
// server and shared modules so missing exports / bad import paths fail too.
// Client modules import by absolute URL (/shared/..., three) so they can only
// be syntax-checked here.

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function jsFiles(dir) {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return jsFiles(rel);
    return e.name.endsWith('.js') ? [rel] : [];
  });
}

const files = ['server.js', ...['server', 'shared', 'public/js', 'scripts'].flatMap(jsFiles)];
let failed = 0;

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error(`FAIL ${file}\n${err.stderr}`);
  }
}

for (const file of [...jsFiles('server'), ...jsFiles('shared')]) {
  try {
    await import(pathToFileURL(path.join(root, file)));
  } catch (err) {
    failed++;
    console.error(`FAIL import ${file}\n${err.stack}\n`);
  }
}

if (failed) {
  console.error(`${failed} problem(s) in ${files.length} files`);
  process.exit(1);
}
console.log(`OK: ${files.length} files`);
