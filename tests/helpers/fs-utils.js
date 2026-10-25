import { rm } from 'node:fs/promises';

const RETRYABLE = new Set(['ENOTEMPTY', 'EPERM', 'EBUSY']);

/**
 * Windows keeps a directory handle for a few milliseconds after the last stream on it closes, so
 * `rm -rf` of a temp root intermittently fails with ENOTEMPTY. Retrying briefly is the difference
 * between a flaky suite and a trustworthy one.
 */
export async function removeDir(root) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!RETRYABLE.has(error?.code) || attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}
