// Shared BullMQ wiring. Both the API (producer) and the worker (consumer)
// import from here so they talk to the same queue on the same Redis.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './config.js';

// BullMQ requires maxRetriesPerRequest: null on the blocking connection.
export const connection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
});

const retentionSec = Math.ceil(config.retentionMs / 1000);

export const queue = new Queue(config.queueName, {
  connection,
  defaultJobOptions: {
    attempts: 2, // retry once on a transient failure
    backoff: { type: 'fixed', delay: 2000 },
    // Keep finished job records around for the retention window, then let
    // Redis drop them. The on-disk files are handled by the worker's sweeper.
    removeOnComplete: { age: retentionSec, count: 5000 },
    removeOnFail: { age: retentionSec, count: 5000 },
  },
});

export async function closeQueue() {
  await queue.close();
  await connection.quit();
}
