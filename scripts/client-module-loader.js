// Test-only Node resolver for the browser's shared-module URL convention.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
export function resolve(specifier,context,next) {
  if(specifier.startsWith('/shared/'))return next(pathToFileURL(path.resolve(specifier.slice(1))).href,context);
  return next(specifier,context);
}
