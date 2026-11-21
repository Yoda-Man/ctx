/**
 * Ctrl-C and SIGTERM close the database and exit with the shell's
 * interrupted codes (130, 143), not success.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'ctx-signals-'));
vi.mock('../../config/paths.js', () => ({
  CTX_DIR: dir,
  DB_PATH: join(dir, 'context.db'),
  getCtxDir: () => dir,
  getDbPath: () => join(dir, 'context.db'),
}));

const { closeDb, getDb, onInterrupt } = await import('../connection.js');

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('signal handlers', () => {
  it('exits 130 on SIGINT and 143 on SIGTERM, and registers once', () => {
    const on = vi.spyOn(process, 'on');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      getDb();
      closeDb();
      getDb(); // reconnecting must not add a second set of handlers
      const handlers = (signal: string) =>
        on.mock.calls.filter(([event]) => event === signal).map(([, fn]) => fn as () => void);
      expect(handlers('SIGINT')).toHaveLength(1);
      expect(handlers('SIGTERM')).toHaveLength(1);

      // Registered cleanups run first, even when one throws; unregistered ones do not
      const order: string[] = [];
      const stop = onInterrupt(() => {
        order.push('undo');
        throw new Error('undo failed');
      });
      const gone = onInterrupt(() => order.push('unregistered'));
      gone();
      exit.mockImplementation(((code: number) => order.push(`exit ${code}`)) as never);
      handlers('SIGINT')[0]!();
      stop();
      expect(order).toEqual(['undo', 'exit 130']);
      expect(exit).toHaveBeenLastCalledWith(130);
      handlers('SIGTERM')[0]!();
      expect(exit).toHaveBeenLastCalledWith(143);
    } finally {
      for (const signal of ['SIGINT', 'SIGTERM', 'exit'] as const) {
        for (const [event, fn] of on.mock.calls) {
          if (event === signal) process.off(signal, fn as () => void);
        }
      }
      on.mockRestore();
      exit.mockRestore();
    }
  });
});
