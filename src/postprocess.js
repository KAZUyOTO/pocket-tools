// Post-processing operations that apply ON TOP of a conversion (or on their
// own, when input and output are the same format): resize, compress/quality,
// and GFPGAN face-restoration + upscaling via a hosted Hugging Face Space.
//
// These are parameterised operations, not format pairs, so they live outside
// the engine resolver and run as a final step in the worker.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run } from './convert.js';
import { has, imageMagick } from './binaries.js';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const GFPGAN = path.join(SCRIPTS, 'gfpgan_enhance.py');
const REMOVEBG = path.join(SCRIPTS, 'removebg.py');

const RASTER = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'avif', 'heic', 'heif', 'ppm', 'tga']);
export const isRaster = (ext) => RASTER.has(String(ext).toLowerCase());

/** True if the request carries any post-processing operation. */
export function hasOps(opts) {
  return !!(opts && (opts.enhance || opts.removebg || opts.width || opts.height || opts.quality));
}

/** GFPGAN is reachable if python3 + gradio_client + the script are present. */
export function enhanceAvailable() {
  return !!has('python3') && fs.existsSync(GFPGAN);
}

/** Background removal reachable if python3 + the script are present. */
export function removebgAvailable() {
  return !!has('python3') && fs.existsSync(REMOVEBG);
}

/**
 * Apply ops to an image file, writing the result as final.<outExt>.
 * Order: enhance (upscale/restore) -> resize -> quality. ImageMagick does the
 * resize/quality and normalises to the requested format.
 */
export async function postProcess(input, outExt, opts, workdir, timeoutMs) {
  let cur = input;

  if (opts.enhance) {
    const enhanced = path.join(workdir, 'enhanced.png');
    await run(
      has('python3'),
      [GFPGAN, cur, enhanced, opts.version || 'v1.4', String(opts.scale || 2), '50'],
      { cwd: workdir, timeoutMs }, // remote Space call; the job timeout covers it
    );
    cur = enhanced;
  }

  if (opts.removebg) {
    // Produces a transparent cutout (webp/png). ImageMagick below normalises it
    // to the requested format while keeping the alpha channel.
    const cut = path.join(workdir, 'cutout.png');
    await run(has('python3'), [REMOVEBG, cur, cut], { cwd: workdir, timeoutMs });
    cur = cut;
  }

  const im = imageMagick();
  const out = path.join(workdir, `final.${outExt}`);

  // If there's no local ImageMagick, at least hand back the enhanced file.
  if (!im) return cur;

  const args = [cur];
  if (opts.width || opts.height) {
    args.push('-resize', `${opts.width || ''}x${opts.height || ''}`); // aspect kept by default
  }
  if (opts.quality) args.push('-quality', String(opts.quality));
  args.push('-strip', out); // -strip drops metadata = smaller files
  await run(im.bin, args, { cwd: workdir, timeoutMs });
  if (!fs.existsSync(out)) throw new Error('post-processing produced no output');
  return out;
}
