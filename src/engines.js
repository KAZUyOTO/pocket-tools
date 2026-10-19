// The engine registry. Each engine wraps one open-source binary, declares
// which (from -> to) extension pairs it can handle, and knows how to invoke
// its tool. resolveEngine() picks the first engine (in precedence order)
// that can do a given conversion.
//
// Adding a format = extend a set below or add a new engine object. Nothing
// else in the codebase needs to change.

import path from 'node:path';
import fs from 'node:fs';
import { run } from './convert.js';
import { has, imageMagick } from './binaries.js';

const set = (...xs) => new Set(xs);

// ---- Format families -------------------------------------------------------
const IMAGE = set('png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'avif', 'ico');
const AUDIO = set('mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus');
const VIDEO = set('mp4', 'mov', 'webm', 'mkv', 'avi');
const MEDIA = set(...AUDIO, ...VIDEO);

// LibreOffice: binary office formats in, documents + pdf out.
const DOC_IN = set('docx', 'doc', 'odt', 'rtf', 'txt', 'xlsx', 'xls', 'csv', 'ods', 'pptx', 'ppt', 'odp', 'html', 'htm');
const DOC_OUT = set('pdf', 'docx', 'odt', 'rtf', 'txt', 'xlsx', 'ods', 'csv', 'pptx', 'odp', 'html');

// Pandoc: lightweight markup among itself.
const MARKUP_IN = set('md', 'markdown', 'html', 'htm', 'rst', 'tex', 'latex', 'epub', 'docx');
const MARKUP_OUT = set('md', 'markdown', 'html', 'rst', 'tex', 'epub', 'docx', 'txt');

const inSet = (s, x) => s.has(String(x).toLowerCase());

// LibreOffice needs a filter name for a few targets; most take the bare ext.
const LO_FILTER = { txt: 'txt:Text', csv: 'csv:Text - txt - csv (StarCalc)', html: 'html' };

// ---- Engines ---------------------------------------------------------------
const im = imageMagick();

const engines = [
  {
    id: 'imagemagick',
    label: 'ImageMagick',
    binary: im?.bin || null,
    get available() {
      return !!im;
    },
    canConvert(from, to) {
      return this.available && inSet(IMAGE, from) && inSet(IMAGE, to) && from !== to;
    },
    async run({ inputPath, outExt, workdir, timeoutMs }) {
      const out = path.join(workdir, `output.${outExt}`);
      await run(im.bin, [inputPath, out], { cwd: workdir, timeoutMs });
      return out;
    },
  },

  {
    id: 'ffmpeg',
    label: 'FFmpeg',
    binary: has('ffmpeg') || null,
    get available() {
      return !!has('ffmpeg');
    },
    canConvert(from, to) {
      if (!this.available || from === to) return false;
      // audio->audio, video->video, and video->audio (extract soundtrack)
      const f = String(from).toLowerCase();
      const t = String(to).toLowerCase();
      if (inSet(AUDIO, f) && inSet(AUDIO, t)) return true;
      if (inSet(VIDEO, f) && inSet(VIDEO, t)) return true;
      if (inSet(VIDEO, f) && inSet(AUDIO, t)) return true;
      return false;
    },
    async run({ inputPath, outExt, workdir, timeoutMs }) {
      const out = path.join(workdir, `output.${outExt}`);
      await run(has('ffmpeg'), ['-y', '-i', inputPath, out], { cwd: workdir, timeoutMs });
      return out;
    },
  },

  {
    id: 'libreoffice',
    label: 'LibreOffice',
    binary: has('soffice') || has('libreoffice') || null,
    get available() {
      return !!(has('soffice') || has('libreoffice'));
    },
    canConvert(from, to) {
      return this.available && inSet(DOC_IN, from) && inSet(DOC_OUT, to) && from !== to;
    },
    async run({ inputPath, outExt, workdir, timeoutMs }) {
      const bin = has('soffice') || has('libreoffice');
      const target = LO_FILTER[outExt] || outExt;
      // A per-job user profile keeps concurrent soffice runs from clashing.
      const profile = `-env:UserInstallation=file://${path.join(workdir, 'lo-profile')}`;
      await run(
        bin,
        [profile, '--headless', '--convert-to', target, '--outdir', workdir, inputPath],
        { cwd: workdir, timeoutMs },
      );
      // soffice writes <inputbasename>.<outExt> into outdir.
      const base = path.basename(inputPath, path.extname(inputPath));
      const produced = path.join(workdir, `${base}.${outExt}`);
      if (!fs.existsSync(produced)) {
        throw new Error('LibreOffice produced no output (unsupported pair or corrupt input)');
      }
      return produced;
    },
  },

  {
    id: 'pandoc',
    label: 'Pandoc',
    binary: has('pandoc') || null,
    get available() {
      return !!has('pandoc');
    },
    canConvert(from, to) {
      return this.available && inSet(MARKUP_IN, from) && inSet(MARKUP_OUT, to) && from !== to;
    },
    async run({ inputPath, outExt, workdir, timeoutMs }) {
      const out = path.join(workdir, `output.${outExt}`);
      await run(has('pandoc'), ['-s', inputPath, '-o', out], { cwd: workdir, timeoutMs });
      return out;
    },
  },
];

// Precedence: image -> av -> office -> markup. The first engine that can do
// the pair wins (so docx->pdf goes to LibreOffice, md->docx goes to Pandoc).
export function resolveEngine(from, to) {
  for (const e of engines) {
    if (e.available && e.canConvert(from, to)) return e;
  }
  return null;
}

/** Every available input extension, each mapped to the outputs it can reach. */
export function supportedConversions() {
  const inputs = new Set([...IMAGE, ...MEDIA, ...DOC_IN, ...MARKUP_IN]);
  const outputs = new Set([...IMAGE, ...MEDIA, ...DOC_OUT, ...MARKUP_OUT]);
  const map = {};
  for (const from of inputs) {
    const targets = [];
    for (const to of outputs) {
      if (resolveEngine(from, to)) targets.push(to);
    }
    if (targets.length) map[from] = targets.sort();
  }
  return map;
}

export function engineStatus() {
  return engines.map((e) => ({ id: e.id, label: e.label, available: e.available, binary: e.binary }));
}
