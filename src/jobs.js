// In-process job store + a tiny worker pool. No database, no Redis — jobs
// live in a Map and files live on disk under storageDir/<jobId>/. This is
// the MVP queue; swapping in BullMQ later means reimplementing enqueue() and
// the worker loop and nothing else.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { config } from './config.js';
import { resolveEngine } from './engines.js';

/** @type {Map<string, Job>} */
const jobs = new Map();
const queue = [];
let active = 0;

/**
 * @typedef {object} Job
 * @property {string} id
 * @property {'queued'|'processing'|'done'|'error'} status
 * @property {string} from  input extension (no dot)
 * @property {string} to    target extension (no dot)
 * @property {string} originalName  what the user uploaded
 * @property {string} outputName    what they download
 * @property {string} dir   this job's working directory
 * @property {string} inputPath
 * @property {string|null} outputPath
 * @property {string|null} error
 * @property {string} engine
 * @property {number} createdAt
 * @property {number|null} finishedAt
 */

export function jobDir(id) {
  return path.join(config.storageDir, id);
}

/** Create a job record + its working dir. Caller writes the input file. */
export async function createJob({ originalName, from, to }) {
  const id = nanoid(12);
  const dir = jobDir(id);
  await fsp.mkdir(dir, { recursive: true });
  const inputPath = path.join(dir, `input.${from}`);
  const base = path.basename(originalName, path.extname(originalName)) || 'file';

  const job = {
    id,
    status: 'queued',
    from,
    to,
    originalName,
    outputName: `${base}.${to}`,
    dir,
    inputPath,
    outputPath: null,
    error: null,
    engine: resolveEngine(from, to)?.id || 'none',
    createdAt: Date.now(),
    finishedAt: null,
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

/** Public view (no absolute paths leaked). */
export function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    from: job.from,
    to: job.to,
    engine: job.engine,
    originalName: job.originalName,
    outputName: job.outputName,
    error: job.error,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}

/** Hand a ready job (input already written) to the pool. */
export function enqueue(job) {
  queue.push(job.id);
  pump();
}

function pump() {
  while (active < config.concurrency && queue.length) {
    const id = queue.shift();
    const job = jobs.get(id);
    if (!job) continue;
    active++;
    process(job).finally(() => {
      active--;
      pump();
    });
  }
}

async function process(job) {
  job.status = 'processing';
  const engine = resolveEngine(job.from, job.to);
  if (!engine) {
    job.status = 'error';
    job.error = `No engine can convert .${job.from} to .${job.to}`;
    job.finishedAt = Date.now();
    scheduleCleanup(job);
    return;
  }
  try {
    const outputPath = await engine.run({
      inputPath: job.inputPath,
      outExt: job.to,
      workdir: job.dir,
      timeoutMs: config.jobTimeoutMs,
    });
    job.outputPath = outputPath;
    job.status = 'done';
  } catch (err) {
    job.status = 'error';
    job.error = String(err.message || err);
  } finally {
    job.finishedAt = Date.now();
    scheduleCleanup(job);
  }
}

function scheduleCleanup(job) {
  setTimeout(() => remove(job.id), config.retentionMs).unref?.();
}

export async function remove(id) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  try {
    await fsp.rm(job.dir, { recursive: true, force: true });
  } catch {
    /* already gone */
  }
}

/** On boot, wipe any leftover job dirs from a previous run. */
export async function sweepOnBoot() {
  try {
    const entries = await fsp.readdir(config.storageDir);
    await Promise.all(
      entries
        .filter((e) => e !== '.gitkeep')
        .map((e) => fsp.rm(path.join(config.storageDir, e), { recursive: true, force: true })),
    );
  } catch {
    if (!fs.existsSync(config.storageDir)) {
      await fsp.mkdir(config.storageDir, { recursive: true });
    }
  }
}

export function stats() {
  return { total: jobs.size, active, queued: queue.length };
}
