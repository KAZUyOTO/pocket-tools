// Low-level: run one external binary with an argv array (never a shell
// string, so a filename can never be interpreted as a command), capture
// output, and enforce a timeout.

import { spawn } from 'node:child_process';
import { config } from './config.js';

/**
 * @param {string} bin absolute path to the executable
 * @param {string[]} args argv
 * @param {object} [opts] { cwd, timeoutMs }
 * @returns {Promise<{stdout:string, stderr:string}>}
 */
export function run(bin, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? config.jobTimeoutMs;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) return reject(new Error(`timed out after ${timeoutMs}ms`));
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${bin} exited ${code}: ${stderr.trim().slice(0, 500)}`));
    });
  });
}
