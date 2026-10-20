// The worker process. Run one or many of these alongside the API; they pull
// jobs from Redis and do the actual conversion. Jobs survive an API restart
// (they sit in Redis) and a worker restart (an interrupted job is retried per
// the queue's attempts setting).
//
//   node src/worker.js

import fsp from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'bullmq';
import { config } from './config.js';
import { connection, queue } from './queue.js';
import { resolveRoute, getEngine } from './engines.js';
import { postProcess, hasOps, isRaster } from './postprocess.js';

const LIVE = new Set(['waiting', 'active', 'delayed', 'waiting-children', 'prioritized']);

const log = (...a) => console.log(new Date().toISOString(), '[worker]', ...a);

// --- the processor --------------------------------------------------------
async function runJob(job) {
  const { from, to, inputPath, dir, sourceUrl, opts } = job.data;
  let produced;

  if (from === to) {
    // Same format in and out: no conversion, just the ops (resize/compress/enhance).
    produced = path.join(dir, `ident.${to}`);
    await fsp.copyFile(inputPath, produced);
    log(`job ${job.id}: ${from} (ops only)`);
  } else {
    const route = resolveRoute(from, to, opts || {});
    if (!route) throw new Error(`No route can convert .${from} to .${to}`);
    log(`job ${job.id}: ${from} -> ${to} via ${route.map((s) => s.engineId).join(' → ')}`);
    // Run each step, feeding one step's output into the next. The URL (if any)
    // is only the source of the FIRST step; later steps read the prior output.
    let current = inputPath;
    for (let i = 0; i < route.length; i++) {
      const step = route[i];
      const engine = getEngine(step.engineId);
      produced = await engine.run({
        inputPath: current,
        outExt: step.to,
        workdir: dir,
        timeoutMs: config.jobTimeoutMs,
        sourceUrl: i === 0 ? sourceUrl : null,
      });
      current = produced;
    }
  }

  // Post-processing ops (resize / compress / GFPGAN enhance) on image outputs.
  if (opts && hasOps(opts) && isRaster(to)) {
    log(`job ${job.id}: post-process ${JSON.stringify(opts)}`);
    produced = await postProcess(produced, to, opts, dir, config.jobTimeoutMs);
  }

  return produced; // stored as job.returnvalue, read by the download route
}

const worker = new Worker(config.queueName, runJob, {
  connection,
  concurrency: config.concurrency,
  // A conversion can run as long as jobTimeoutMs; keep the lock alive past
  // that so BullMQ doesn't treat a legitimately long job as stalled.
  lockDuration: config.jobTimeoutMs + 30_000,
  stalledInterval: config.jobTimeoutMs + 30_000,
});

worker.on('completed', (job) => log(`job ${job.id}: done -> ${job.returnvalue}`));
worker.on('failed', (job, err) => log(`job ${job?.id}: failed -> ${err.message}`));
worker.on('error', (err) => log('worker error:', err.message));

// --- file sweeper (restart-proof: the interval re-arms on every boot) -----
async function sweep() {
  let entries;
  try {
    entries = await fsp.readdir(config.storageDir);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of entries) {
    if (name === '.gitkeep') continue;
    const full = path.join(config.storageDir, name);
    try {
      const st = await fsp.stat(full);
      if (now - st.mtimeMs <= config.retentionMs) continue;
      // Old enough to delete — unless a job for it is still waiting/running.
      const job = await queue.getJob(name);
      if (job && LIVE.has(await job.getState())) continue;
      if (job) await job.remove().catch(() => {});
      await fsp.rm(full, { recursive: true, force: true });
      log(`swept ${name}`);
    } catch {
      /* ignore */
    }
  }
}
setInterval(() => sweep().catch(() => {}), 60_000).unref();
sweep().catch(() => {});

async function shutdown(sig) {
  log(`${sig} received, closing…`);
  await worker.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

log(`up. queue="${config.queueName}" concurrency=${config.concurrency} redis=${config.redisUrl}`);
