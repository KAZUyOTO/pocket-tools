// The engine registry. Each engine wraps one open-source binary, declares
// which (from -> to) extension pairs it handles, and knows how to invoke its
// tool. resolveEngine() finds a direct engine; resolveRoute() (below) adds
// one-hop chaining through an intermediate format so one input can reach far
// more outputs — the way CloudConvert multiplies its conversion matrix.
//
// Adding a format = extend a set or add an engine object. Nothing else changes.

import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { run } from './convert.js';
import { has, imageMagick } from './binaries.js';

const set = (...xs) => new Set(xs.map((x) => x.toLowerCase()));
const inSet = (s, x) => s.has(String(x).toLowerCase());
const sevenzip = () => has('7z') || has('7za');

// ---- Format families -------------------------------------------------------
const RASTER = set('png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'avif', 'heic', 'heif', 'ico', 'ppm', 'pgm', 'tga', 'psd');
const AUDIO = set('mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'wma', 'aiff');
const VIDEO = set('mp4', 'mov', 'webm', 'mkv', 'avi', 'flv', 'wmv', 'mpeg', 'mpg', 'm4v', '3gp');
const MEDIA = set(...AUDIO, ...VIDEO);

const VECTOR_INK = set('svg', 'svgz', 'emf', 'wmf'); // inkscape inputs
const VECTOR = set('svg', 'svgz', 'eps', 'ps', 'emf', 'wmf');

const OFFICE_IN = set('docx', 'doc', 'odt', 'rtf', 'txt', 'xlsx', 'xls', 'csv', 'tsv', 'ods', 'pptx', 'ppt', 'odp', 'html', 'htm');
const OFFICE_OUT = set('pdf', 'docx', 'odt', 'rtf', 'txt', 'xlsx', 'ods', 'csv', 'pptx', 'odp', 'html');

const MARKUP_IN = set('md', 'markdown', 'html', 'htm', 'rst', 'tex', 'latex', 'epub', 'docx', 'org', 'textile');
const MARKUP_OUT = set('md', 'markdown', 'html', 'rst', 'tex', 'epub', 'docx', 'txt', 'org');

const EBOOK = set('epub', 'mobi', 'azw3', 'azw', 'fb2', 'lit', 'pdb', 'lrf', 'htmlz');
const EBOOK_IN = set(...EBOOK, 'pdf', 'docx', 'rtf', 'txt', 'html', 'odt');
const EBOOK_OUT = set(...EBOOK, 'pdf', 'docx', 'rtf', 'txt');

const THREED = set('obj', 'stl', 'ply', 'gltf', 'glb', 'fbx', 'dae', '3ds', 'x3d');

const ARCHIVE_IN = set('zip', '7z', 'tar', 'gz', 'tgz', 'rar');
const ARCHIVE_OUT = set('zip', '7z', 'tar', 'gz', 'tgz');

const FONT = set('ttf', 'otf', 'woff', 'woff2');

// LibreOffice needs an explicit filter for a couple of targets.
const LO_FILTER = { txt: 'txt:Text', csv: 'csv:Text - txt - csv (StarCalc)' };

const im = imageMagick();

// ---- Engines ---------------------------------------------------------------
const engines = [
  {
    id: 'ffmpeg',
    label: 'FFmpeg',
    binary: has('ffmpeg') || null,
    get available() {
      return !!has('ffmpeg');
    },
    canConvert(f, t) {
      if (!this.available || f === t) return false;
      if (inSet(MEDIA, f) && inSet(MEDIA, t) && !(inSet(AUDIO, f) && inSet(VIDEO, t))) return true; // no audio->video
      if (inSet(VIDEO, f) && t === 'gif') return true;
      if (f === 'gif' && inSet(VIDEO, t)) return true;
      return false;
    },
    async run({ inputPath, outExt, workdir, timeoutMs }) {
      const out = path.join(workdir, `output.${outExt}`);
      let args;
      if (outExt === 'gif') {
        args = ['-y', '-i', inputPath, '-vf', 'fps=12,scale=480:-1:flags=lanczos', out];
      } else if (['mp4', 'webm', 'mov', 'mkv'].includes(outExt)) {
        args = ['-y', '-i', inputPath, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out];
      } else {
        args = ['-y', '-i', inputPath, out];
      }
      await run(has('ffmpeg'), args, { cwd: workdir, timeoutMs });
      return out;
    },
  },

  {
    id: 'poppler',
    label: 'Poppler',
    binary: has('pdftocairo') || null,
    get available() {
      return !!(has('pdftocairo') && has('pdftotext'));
    },
    canConvert(f, t) {
      return this.available && f === 'pdf' && inSet(set('png', 'jpg', 'jpeg', 'tiff', 'tif', 'ppm', 'svg', 'ps', 'eps', 'txt', 'html'), t);
    },
    async run({ inputPath, outExt, workdir, timeoutMs }) {
      const base = path.join(workdir, 'output');
      if (outExt === 'txt') {
        const out = `${base}.txt`;
        await run(has('pdftotext'), [inputPath, out], { cwd: workdir, timeoutMs });
        return out;
      }
      if (outExt === 'html') {
        await run(has('pdftohtml'), ['-s', '-noframes', '-i', inputPath, `${base}.html`], { cwd: workdir, timeoutMs });
        return `${base}.html`;
      }
      // pdftocairo covers raster + vector. -singlefile keeps raster to 1 file.
      const map = {
        png: ['-png', '-singlefile', '-scale-to', '1600'],
        jpg: ['-jpeg', '-singlefile', '-scale-to', '1600'],
        jpeg: ['-jpeg', '-singlefile', '-scale-to', '1600'],
        tiff: ['-tiff', '-singlefile', '-scale-to', '1600'],
        tif: ['-tiff', '-singlefile', '-scale-to', '1600'],
        ppm: ['-ppm', '-singlefile'],
        svg: ['-svg'],
        ps: ['-ps'],
        eps: ['-eps', '-singlefile'],
      };
      await run(has('pdftocairo'), [...map[outExt], inputPath, base], { cwd: workdir, timeoutMs });
      // pdftocairo picks the real extension itself.
      const realExt = { jpg: 'jpg', jpeg: 'jpg', tif: 'tif', tiff: 'tif' }[outExt] || outExt;
      const produced = `${base}.${realExt}`;
      if (!fs.existsSync(produced)) throw new Error('Poppler produced no output');
      return produced;
    },
  },

  {
    id: 'inkscape',
    label: 'Inkscape',
    binary: has('inkscape') || null,
    get available() {
      return !!has('inkscape');
    },
    canConvert(f, t) {
      return this.available && inSet(VECTOR_INK, f) && inSet(set('pdf', 'eps', 'ps', 'png', 'svg'), t) && f !== t;
    },
    async run({ inputPath, outExt, workdir, timeoutMs }) {
      const out = path.join(workdir, `output.${outExt}`);
      const args = [inputPath, `--export-filename=${out}`];
      if (outExt === 'png') args.push('--export-dpi=150');
      await run(has('inkscape'), args, { cwd: workdir, timeoutMs });
      if (!fs.existsSync(out)) throw new Error('Inkscape produced no output');
      return out;
    },
  },

  {
    id: 'ghostscript',
    label: 'Ghostscript',
    binary: has('gs') || null,
    get available() {
      return !!has('gs');
    },
    canConvert(f, t) {
      if (!this.available) return false;
      if ((f === 'ps' || f === 'eps') && t === 'pdf') return true;
      if (f === 'pdf' && (t === 'ps' || t === 'eps')) return true;
      return false;
    },
    async run({ inputPath, outExt, workdir, timeoutMs }) {
      const out = path.join(workdir, `output.${outExt}`);
      const device = outExt === 'pdf' ? 'pdfwrite' : outExt === 'eps' ? 'eps2write' : 'ps2write';
      await run(
        has('gs'),
        ['-dBATCH', '-dNOPAUSE', '-dSAFER', `-sDEVICE=${device}`, `-sOutputFile=${out}`, inputPath],
        { cwd: workdir, timeoutMs },
      );
      return out;
    },
  },

  {
    id: 'imagemagick',
    label: 'ImageMagick',
    binary: im?.bin || null,
    get available() {
      return !!im;
    },
    canConvert(f, t) {
      if (!this.available || f === t) return false;
      if (inSet(RASTER, f) && inSet(RASTER, t)) return true;
      if (inSet(RASTER, f) && t === 'pdf') return true; // image -> pdf
      return false;
    },
    async run({ inputPath, outExt, workdir, timeoutMs }) {
      const out = path.join(workdir, `output.${outExt}`);
      await run(im.bin, [inputPath, out], { cwd: workdir, timeoutMs });
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
    canConvert(f, t) {
      return this.available && inSet(OFFICE_IN, f) && inSet(OFFICE_OUT, t) && f !== t;
    },
    async run({ inputPath, outExt, workdir, timeoutMs }) {
      const bin = has('soffice') || has('libreoffice');
      const target = LO_FILTER[outExt] || outExt;
      const profile = `-env:UserInstallation=file://${path.join(workdir, 'lo-profile')}`;
      await run(bin, [profile, '--headless', '--convert-to', target, '--outdir', workdir, inputPath], {
        cwd: workdir,
        timeoutMs,
      });
      const base = path.basename(inputPath, path.extname(inputPath));
      const produced = path.join(workdir, `${base}.${outExt}`);
      if (!fs.existsSync(produced)) throw new Error('LibreOffice produced no output (unsupported pair or corrupt input)');
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
    canConvert(f, t) {
      return this.available && inSet(MARKUP_IN, f) && inSet(MARKUP_OUT, t) && f !== t;
    },
    async run({ inputPath, outExt, workdir, timeoutMs }) {
      const out = path.join(workdir, `output.${outExt}`);
      await run(has('pandoc'), ['-s', inputPath, '-o', out], { cwd: workdir, timeoutMs });
      return out;
    },
  },

  {
    id: 'calibre',
    label: 'Calibre',
    binary: has('ebook-convert') || null,
    get available() {
      return !!has('ebook-convert');
    },
    canConvert(f, t) {
      // At least one side must be a true ebook format, so Calibre doesn't
      // grab office jobs LibreOffice should own (precedence handles the rest).
      return this.available && (inSet(EBOOK, f) || inSet(EBOOK, t)) && inSet(EBOOK_IN, f) && inSet(EBOOK_OUT, t) && f !== t;
    },
    async run({ inputPath, outExt, workdir, timeoutMs }) {
      const out = path.join(workdir, `output.${outExt}`);
      await run(has('ebook-convert'), [inputPath, out], { cwd: workdir, timeoutMs });
      return out;
    },
  },

  {
    id: 'assimp',
    label: 'Assimp',
    binary: has('assimp') || null,
    get available() {
      return !!has('assimp');
    },
    canConvert(f, t) {
      return this.available && inSet(THREED, f) && inSet(THREED, t) && f !== t;
    },
    async run({ inputPath, outExt, workdir, timeoutMs }) {
      const out = path.join(workdir, `output.${outExt}`);
      await run(has('assimp'), ['export', inputPath, out], { cwd: workdir, timeoutMs });
      if (!fs.existsSync(out)) throw new Error('Assimp produced no output');
      return out;
    },
  },

  {
    id: 'archive',
    label: '7-Zip / tar',
    binary: sevenzip() || null,
    get available() {
      return !!(sevenzip() && has('tar'));
    },
    canConvert(f, t) {
      return this.available && inSet(ARCHIVE_IN, f) && inSet(ARCHIVE_OUT, t) && f !== t;
    },
    async run({ inputPath, outExt, workdir, timeoutMs }) {
      const ex = path.join(workdir, 'extract');
      await fsp.mkdir(ex, { recursive: true });
      const sz = sevenzip();
      // --- extract ---
      const f = path.extname(inputPath).slice(1).toLowerCase();
      if (f === 'tar') {
        await run(has('tar'), ['-xf', inputPath, '-C', ex], { cwd: workdir, timeoutMs });
      } else if (f === 'gz' || f === 'tgz') {
        await run(has('tar'), ['-xzf', inputPath, '-C', ex], { cwd: workdir, timeoutMs });
      } else {
        await run(sz, ['x', '-y', `-o${ex}`, inputPath], { cwd: workdir, timeoutMs }); // zip, 7z, rar
      }
      // --- repack ---
      const out = path.join(workdir, `output.${outExt}`);
      if (outExt === 'tar') {
        await run(has('tar'), ['-cf', out, '-C', ex, '.'], { cwd: workdir, timeoutMs });
      } else if (outExt === 'gz' || outExt === 'tgz') {
        await run(has('tar'), ['-czf', out, '-C', ex, '.'], { cwd: workdir, timeoutMs });
      } else {
        // 7z / zip: pack the contents of ex (cwd = ex so paths are relative)
        await run(sz, ['a', `-t${outExt === 'zip' ? 'zip' : '7z'}`, out, '.'], { cwd: ex, timeoutMs });
      }
      if (!fs.existsSync(out)) throw new Error('Archive repack produced no output');
      return out;
    },
  },

  {
    id: 'fontforge',
    label: 'FontForge',
    binary: has('fontforge') || null,
    get available() {
      return !!has('fontforge');
    },
    canConvert(f, t) {
      return this.available && inSet(FONT, f) && inSet(FONT, t) && f !== t;
    },
    async run({ inputPath, outExt, workdir, timeoutMs }) {
      const out = path.join(workdir, `output.${outExt}`);
      await run(has('fontforge'), ['-lang=ff', '-c', 'Open($1); Generate($2)', inputPath, out], {
        cwd: workdir,
        timeoutMs,
      });
      if (!fs.existsSync(out)) throw new Error('FontForge produced no output');
      return out;
    },
  },
];

const byId = new Map(engines.map((e) => [e.id, e]));
export function getEngine(id) {
  return byId.get(id) || null;
}

// Direct, single-engine conversion (first available engine in precedence order).
export function resolveEngine(from, to) {
  for (const e of engines) if (e.available && e.canConvert(from, to)) return e;
  return null;
}

// ---- Routing (direct, or one hop through an intermediate format) -----------
// Hubs are ordered by how lossless/reliable they are as a bridge.
const HUBS = ['pdf', 'html', 'png', 'odt', 'svg', 'docx', 'ps'];

/**
 * @returns {Array<{engineId:string, from:string, to:string}>|null}
 */
export function resolveRoute(from, to) {
  from = String(from).toLowerCase();
  to = String(to).toLowerCase();
  if (from === to) return null;
  const direct = resolveEngine(from, to);
  if (direct) return [{ engineId: direct.id, from, to }];
  for (const hub of HUBS) {
    if (hub === from || hub === to) continue;
    const a = resolveEngine(from, hub);
    const b = resolveEngine(hub, to);
    if (a && b) {
      return [
        { engineId: a.id, from, to: hub },
        { engineId: b.id, from: hub, to },
      ];
    }
  }
  return null;
}

/** Human label for a route, e.g. "pandoc → libreoffice". */
export function routeLabel(from, to) {
  const r = resolveRoute(from, to);
  if (!r) return 'none';
  return r.map((s) => s.engineId).join(' → ');
}

// ---- Catalog (cached; depends only on which binaries exist) ----------------
const INPUT_UNIVERSE = set(...RASTER, ...MEDIA, 'gif', ...VECTOR, ...OFFICE_IN, ...MARKUP_IN, ...EBOOK_IN, ...THREED, ...ARCHIVE_IN, ...FONT, 'pdf');
const OUTPUT_UNIVERSE = set(...RASTER, ...MEDIA, 'gif', 'pdf', 'ps', 'eps', 'svg', 'txt', 'html', ...OFFICE_OUT, ...MARKUP_OUT, ...EBOOK_OUT, ...THREED, ...ARCHIVE_OUT, ...FONT);

let _catalog = null;
export function supportedConversions() {
  if (_catalog) return _catalog;
  const map = {};
  for (const from of INPUT_UNIVERSE) {
    const targets = [];
    for (const to of OUTPUT_UNIVERSE) {
      if (from !== to && resolveRoute(from, to)) targets.push(to);
    }
    if (targets.length) map[from] = targets.sort();
  }
  _catalog = map;
  return map;
}

export function engineStatus() {
  return engines.map((e) => ({ id: e.id, label: e.label, available: e.available, binary: e.binary }));
}
