import { setTimeout as delay } from 'node:timers/promises';

/** A spawned process is not ready until its HTTP health check succeeds. */
export async function waitForReady(url, child, {
  timeoutMs = 600_000, intervalMs = 1000, requestTimeoutMs = 3000,
  onProgress = () => {},
} = {}) {
  let spawnError;
  const recordError = (error) => { spawnError = error; };
  child.on('error', recordError);
  const started = Date.now();
  let nextProgress = started + 15_000;
  try {
    while (Date.now() - started < timeoutMs) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Process exited before becoming ready (${child.signalCode ?? child.exitCode}).`);
      }
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
        const health = await response.json();
        if (response.ok && health.status === 'ok') return;
      } catch {
        // Connection refusal and request timeouts are expected during startup.
      }
      if (Date.now() >= nextProgress) {
        onProgress(Math.floor((Date.now() - started) / 1000));
        nextProgress = Date.now() + 15_000;
      }
      await delay(intervalMs);
    }
    throw new Error('Startup timed out. The process may still be starting; check its logs before restarting.');
  } finally {
    child.off('error', recordError);
  }
}
