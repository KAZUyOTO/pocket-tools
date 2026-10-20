// Job layer, Phase 2: backed by BullMQ/Redis instead of an in-process Map.
//
// The API is now a pure producer. It writes the uploaded file to disk, adds a
// job to the queue, and later reads job state back from Redis. A separate
// worker process (src/worker.js) does the actual conversion. Nothing is lost
// if the API or a worker restarts — the queue and the files outlive both.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { config } from './config.js';
import { routeLabel } from './engines.js';
import { queue } from './queue.js';

export function jobDir(id) {
  return path.join(config.storageDir, id);
}

/**
 * Reserve a job: make its working dir and compute paths. Does NOT enqueue —
 * the caller writes the input file first, then calls enqueue(). This ordering
 * guarantees a worker never starts before the upload is on disk.
 */
export async function createJob({ originalName, from, to, sourceUrl, opts }) {
  const id = nanoid(12);
  const dir = jobDir(id);
  await fsp.mkdir(dir, { recursive: true });
  const base = path.basename(originalName, path.extname(originalName)) || 'file';
  return {
    id,
    dir,
    inputPath: path.join(dir, `input.${from}`), // unused for URL jobs
    outputName: `${base}.${to}`,
    from,
    to,
    originalName,
    sourceUrl: sourceUrl || null,
    opts: opts || null,
  };
}

/** Put a prepared job (input already written) onto the queue. */
export async function enqueue(job) {
  await queue.add(
    'convert',
    {
      from: job.from,
      to: job.to,
      originalName: job.originalName,
      outputName: job.outputName,
      dir: job.dir,
      inputPath: job.inputPath,
      sourceUrl: job.sourceUrl || null,
      opts: job.opts || null,
    },
    { jobId: job.id },
  );
}

export async function getJob(id) {
  return (await queue.getJob(id)) || null;
}

const STATE = {
  completed: 'done',
  failed: 'error',
  active: 'processing',
};

function opsLabel(opts) {
  if (!opts) return 'copy';
  const parts = [];
  if (opts.enhance) parts.push('gfpgan');
  if (opts.width || opts.height) parts.push('resize');
  if (opts.quality) parts.push('compress');
  return parts.join('+') || 'copy';
}

/** Map a BullMQ job to the public JSON shape the UI/API expose. */
export async function publicJob(job) {
  const state = await job.getState();
  const d = job.data || {};
  return {
    id: job.id,
    status: STATE[state] || 'queued',
    from: d.from,
    to: d.to,
    engine: d.from === d.to ? opsLabel(d.opts) : routeLabel(d.from, d.to, d.opts || {}),
    originalName: d.originalName,
    outputName: d.outputName,
    error: job.failedReason || null,
    createdAt: job.timestamp || null,
    finishedAt: job.finishedOn || null,
  };
}

/** Absolute path of the finished output, or null if not done. */
export async function outputPathOf(job) {
  const state = await job.getState();
  if (state !== 'completed') return null;
  return job.returnvalue || null;
}

/** Remove a job's files (and its queue record if present). */
export async function remove(id) {
  try {
    const job = await queue.getJob(id);
    if (job) await job.remove();
  } catch {
    /* not in queue */
  }
  try {
    await fsp.rm(jobDir(id), { recursive: true, force: true });
  } catch {
    /* already gone */
  }
}

export async function ensureStorage() {
  await fsp.mkdir(config.storageDir, { recursive: true });
}

export async function stats() {
  const c = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  return { queued: c.waiting + c.delayed, active: c.active, completed: c.completed, failed: c.failed };
}
