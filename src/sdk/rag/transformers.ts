/**
 * The one place the embedding provider and reranker load transformers.js,
 * so both use the same library and keep their models in ~/.ctx/models.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MODELS_DIR } from '../../config/paths.js';

/** The quantized weights both callers load (dtype 'q8'). */
const WEIGHTS = join('onnx', 'model_quantized.onnx');

export async function loadTransformers(): Promise<typeof import('@huggingface/transformers')> {
  const transformers = await import('@huggingface/transformers');
  transformers.env.cacheDir = MODELS_DIR;
  return transformers;
}

/**
 * Run `load` holding a per-model lock while the model still has to be
 * downloaded, so concurrent ctx processes download it once. Without it each
 * fetched hundreds of MB into its own temp file at the same time: five at
 * once were seen, splitting the bandwidth so none finished. A model already
 * on disk loads with no lock, so parallel searches never queue.
 */
export async function withModelDownloadLock<T>(
  model: string,
  load: () => Promise<T>,
  { dir = MODELS_DIR, pollMs = 1000, staleMs = 2 * 60 * 60 * 1000 } = {}
): Promise<T> {
  const weights = join(dir, model, WEIGHTS);
  if (existsSync(weights)) return load();

  const lock = join(dir, '.locks', `${model.replace(/[\\/]/g, '__')}.lock`);
  mkdirSync(dirname(lock), { recursive: true });
  let announced = false;
  for (;;) {
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx' });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (lockIsStale(lock, staleMs)) {
        rmSync(lock, { force: true });
        continue;
      }
      if (!announced) {
        console.warn(`Waiting for another ctx process to finish downloading ${model}...`);
        announced = true;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      // The other process finished: load from disk, no lock needed.
      if (existsSync(weights)) return load();
    }
  }
  try {
    return await load();
  } finally {
    rmSync(lock, { force: true });
  }
}

/** A lock whose process has exited, or that is older than `staleMs`, was abandoned. */
function lockIsStale(lock: string, staleMs: number): boolean {
  try {
    if (Date.now() - statSync(lock).mtimeMs > staleMs) return true;
    const pid = Number(readFileSync(lock, 'utf8'));
    // Empty while its owner is still writing it: not stale.
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ESRCH: no such process. ENOENT: released meanwhile; just try again.
    return code === 'ESRCH' || code === 'ENOENT';
  }
}
