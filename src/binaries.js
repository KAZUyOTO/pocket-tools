// Detects which converter binaries are present on this machine.
// Engines register the binaries they need; anything missing is simply
// reported as unavailable so the UI can grey out those conversions
// instead of failing at runtime.

import fs from 'node:fs';
import path from 'node:path';

/** Resolve an executable on PATH without spawning a shell. */
export function which(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    const full = path.join(dir, name);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return full;
    } catch {
      /* not here, keep looking */
    }
  }
  return null;
}

/**
 * ImageMagick ships as `magick` (v7) or `convert` (v6). Prefer v7.
 * Returns { bin, v7 } or null.
 */
export function imageMagick() {
  const m = which('magick');
  if (m) return { bin: m, v7: true };
  const c = which('convert');
  if (c) return { bin: c, v7: false };
  return null;
}

/** Cache so we only probe the filesystem once per process. */
const cache = new Map();
export function has(name) {
  if (!cache.has(name)) cache.set(name, which(name));
  return cache.get(name);
}
