/**
 * Concurrent ctx processes download a model once. Before the lock, every
 * process that started before the model was on disk fetched it into its own
 * temp file; five at once split the bandwidth and none finished.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { withModelDownloadLock } from '../transformers.js';

const MODEL = 'Xenova/bge-large-en-v1.5';
let dir: string;
const weights = () => join(dir, MODEL, 'onnx', 'model_quantized.onnx');
const lockFile = () => join(dir, '.locks', 'Xenova__bge-large-en-v1.5.lock');
/** What a real download leaves behind. */
const download = () => { mkdirSync(join(dir, MODEL, 'onnx'), { recursive: true }); writeFileSync(weights(), 'onnx'); };
const opts = () => ({ dir, pollMs: 5 });

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ctx-models-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe('withModelDownloadLock', () => {
  it('a model already on disk loads with no lock, so parallel searches never queue', async () => {
    download();
    await expect(withModelDownloadLock(MODEL, async () => 'loaded', opts())).resolves.toBe('loaded');
    expect(existsSync(join(dir, '.locks'))).toBe(false);
  });

  it('a second process waits for the first download, then loads from disk', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const order: string[] = [];
    let finishDownload!: () => void;
    const first = withModelDownloadLock(MODEL, () => new Promise<string>((resolve) => {
      order.push('first starts downloading');
      finishDownload = () => { download(); order.push('first done'); resolve('first'); };
    }), opts());
    // The same lock file another process would see.
    expect(existsSync(lockFile())).toBe(true);

    const second = withModelDownloadLock(MODEL, async () => { order.push('second loads'); return 'second'; }, opts());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(order).toEqual(['first starts downloading']);   // still waiting, not downloading too
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Waiting for another ctx process to finish downloading Xenova\/bge-large-en-v1.5/));

    finishDownload();
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(order).toEqual(['first starts downloading', 'first done', 'second loads']);
    expect(existsSync(lockFile())).toBe(false);
  });

  it('a lock left by a process that has exited is taken over at once', async () => {
    const exited = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid!;
    mkdirSync(join(dir, '.locks'), { recursive: true });
    writeFileSync(lockFile(), String(exited));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(withModelDownloadLock(MODEL, async () => 'loaded', opts())).resolves.toBe('loaded');
    expect(warn).not.toHaveBeenCalled();
    expect(existsSync(lockFile())).toBe(false);
  });

  it('a failed download releases the lock, so the next process can try', async () => {
    await expect(withModelDownloadLock(MODEL, async () => { throw new Error('terminated'); }, opts())).rejects.toThrow('terminated');
    expect(existsSync(lockFile())).toBe(false);
  });
});
