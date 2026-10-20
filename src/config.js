// Central knobs. Everything self-hosters might tune lives here or in env.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',

  // Where uploads and outputs live. One subfolder per job.
  storageDir: process.env.STORAGE_DIR || path.join(ROOT, 'storage'),
  publicDir: path.join(ROOT, 'public'),

  // Hard cap on a single upload (bytes). Default 1 GB.
  maxFileSize: Number(process.env.MAX_FILE_SIZE || 1024 * 1024 * 1024),

  // Kill a conversion that runs longer than this (ms). Default 5 min.
  jobTimeoutMs: Number(process.env.JOB_TIMEOUT_MS || 5 * 60 * 1000),

  // How many conversions run at once. Scale to your core count.
  concurrency: Number(process.env.CONCURRENCY || 2),

  // Delete a job's files this long after it finishes (ms). Default 1 h.
  retentionMs: Number(process.env.RETENTION_MS || 60 * 60 * 1000),

  // Redis / BullMQ (Phase 2). The queue lives here so the API and the
  // worker(s) are separate processes and jobs survive a restart.
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  queueName: process.env.QUEUE_NAME || 'conversions',

  // CORS: which origin(s) may call the API. "*" allows any (fine for a public,
  // keyless tool); set to your Vercel URL to lock it down.
  corsOrigin: process.env.CORS_ORIGIN || '*',
};
