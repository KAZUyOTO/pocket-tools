// HTTP layer: static UI + a small JSON/file API. Phase 2: the API is a pure
// producer — it enqueues jobs onto Redis and reads their state back. The
// actual conversion happens in src/worker.js.
//
//   GET  /api/formats            -> { conversions, engines }
//   POST /api/convert?to=<ext>   -> multipart file; returns a job (202)
//   GET  /api/jobs/:id           -> job status
//   GET  /api/jobs/:id/download  -> the converted file (when done)
//   GET  /api/health             -> { ok, ...queue stats }

import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import cors from '@fastify/cors';

import { config } from './config.js';
import { supportedConversions, engineStatus, resolveRoute } from './engines.js';
import { isRaster, enhanceAvailable, removebgAvailable } from './postprocess.js';
import {
  createJob,
  enqueue,
  getJob,
  publicJob,
  outputPathOf,
  remove,
  ensureStorage,
  stats,
} from './jobs.js';
import { closeQueue } from './queue.js';

const EXT = (name) => path.extname(String(name || '')).slice(1).toLowerCase();
const CLEAN = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const GFPGAN_VERSIONS = ['v1.2', 'v1.3', 'v1.4', 'RestoreFormer', 'CodeFormer'];
const numIn = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

/** Pull optional image operations off the query string. */
function parseOps(q) {
  const opts = {};
  const w = numIn(q.width, 1, 20000);
  const h = numIn(q.height, 1, 20000);
  const quality = numIn(q.quality, 1, 100);
  if (w) opts.width = w;
  if (h) opts.height = h;
  if (quality) opts.quality = quality;
  if (q.enhance === '1' || q.enhance === 'true') {
    opts.enhance = true;
    opts.scale = numIn(q.scale, 1, 4) || 2;
    opts.version = GFPGAN_VERSIONS.includes(q.version) ? q.version : 'v1.4';
  }
  if (q.removebg === '1' || q.removebg === 'true') opts.removebg = true;
  if (q.ml === '1' || q.ml === 'true' || q.hq === '1' || q.hq === 'true') opts.ml = true;
  return Object.keys(opts).length ? opts : null;
}

const app = Fastify({ logger: true, bodyLimit: config.maxFileSize });

// CORS so a frontend hosted elsewhere (e.g. Vercel) can call this API.
// CORS_ORIGIN can be "*", a single origin, or a comma-separated list.
await app.register(cors, {
  origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()),
});

await app.register(multipart, { limits: { fileSize: config.maxFileSize, files: 1 } });
await app.register(fastifyStatic, { root: config.publicDir, prefix: '/' });

app.get('/api/health', async () => ({ ok: true, ...(await stats()) }));

app.get('/api/formats', async () => ({
  conversions: supportedConversions(),
  engines: engineStatus(),
}));

app.post('/api/convert', async (req, reply) => {
  const to = CLEAN(req.query.to);
  if (!to) return reply.code(400).send({ error: 'Missing ?to=<format>' });

  // URL source (no file): POST /api/convert?to=pdf&url=https://example.com
  const url = req.query.url ? String(req.query.url) : null;
  if (url) {
    if (!/^https?:\/\//i.test(url)) return reply.code(400).send({ error: 'URL must start with http:// or https://' });
    if (!resolveRoute('url', to)) return reply.code(422).send({ error: `Cannot render a URL to .${to}` });
    let host = 'page';
    try {
      host = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '') || 'page';
    } catch {
      return reply.code(400).send({ error: 'Invalid URL' });
    }
    const job = await createJob({ originalName: `${host}.html`, from: 'url', to, sourceUrl: url });
    await enqueue(job);
    const qj = await getJob(job.id);
    return reply.code(202).send(await publicJob(qj));
  }

  const ops = parseOps(req.query);

  const data = await req.file();
  if (!data) return reply.code(400).send({ error: 'No file uploaded' });

  const from = EXT(data.filename);
  if (!from) return reply.code(400).send({ error: 'Uploaded file has no extension' });

  if (ops?.enhance && !enhanceAvailable()) {
    data.file.resume();
    return reply.code(422).send({ error: 'Enhance (GFPGAN) is not available on this server' });
  }
  if (ops?.removebg && !removebgAvailable()) {
    data.file.resume();
    return reply.code(422).send({ error: 'Background removal is not available on this server' });
  }
  if (ops?.removebg && !isRaster(to)) {
    data.file.resume();
    return reply.code(422).send({ error: 'Background removal needs an image output (e.g. png)' });
  }
  if (ops?.ml && from !== 'pdf') delete ops.ml; // ML (Docling) path is PDF-only
  if (from === to) {
    if (!ops || !isRaster(to)) {
      data.file.resume();
      return reply.code(422).send({ error: 'Same input and output format with no resize/compress/enhance' });
    }
  } else if (!resolveRoute(from, to, ops || {})) {
    data.file.resume(); // drain
    return reply.code(422).send({ error: `Cannot convert .${from} to .${to}` });
  }

  const job = await createJob({ originalName: data.filename, from, to, opts: ops });
  try {
    await pipeline(data.file, fs.createWriteStream(job.inputPath));
  } catch (err) {
    await remove(job.id);
    return reply.code(500).send({ error: `Upload failed: ${err.message}` });
  }
  if (data.file.truncated) {
    await remove(job.id);
    return reply.code(413).send({ error: 'File exceeds the size limit' });
  }

  await enqueue(job);
  const qj = await getJob(job.id);
  return reply.code(202).send(await publicJob(qj));
});

app.get('/api/jobs/:id', async (req, reply) => {
  const job = await getJob(req.params.id);
  if (!job) return reply.code(404).send({ error: 'Job not found (it may have expired)' });
  return publicJob(job);
});

app.get('/api/jobs/:id/download', async (req, reply) => {
  const job = await getJob(req.params.id);
  if (!job) return reply.code(404).send({ error: 'Job not found (it may have expired)' });

  const out = await outputPathOf(job);
  if (!out) {
    const pj = await publicJob(job);
    if (pj.status === 'error') return reply.code(409).send({ error: pj.error });
    return reply.code(409).send({ error: `Job is ${pj.status}` });
  }
  if (!fs.existsSync(out)) {
    return reply.code(410).send({ error: 'Output expired and was cleaned up' });
  }
  const outputName = (job.data?.outputName || 'download').replace(/"/g, '');
  reply
    .header('Content-Type', 'application/octet-stream')
    .header('Content-Disposition', `attachment; filename="${outputName}"`);
  return reply.send(fs.createReadStream(out));
});

async function shutdown() {
  await app.close();
  await closeQueue();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await ensureStorage();
await app.listen({ port: config.port, host: config.host });
const avail = engineStatus().filter((e) => e.available).map((e) => e.label).join(', ') || 'none';
app.log.info(`Pocket-Tools API ready. Engines: ${avail}. Queue on ${config.redisUrl}`);
