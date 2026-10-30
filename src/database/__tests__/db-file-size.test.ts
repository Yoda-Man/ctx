/**
 * The database size ctx reports after indexing and in `ctx status`.
 */

import { describe, it, expect, vi, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'ctx-db-size-'));
vi.mock('../../config/paths.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../config/paths.js')>()),
  getDbPath: () => join(dir, 'context.db'),
}));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const { getDbFileSize } = await import('../connection.js');

describe('getDbFileSize', () => {
  it('is 0 before the database exists', () => {
    expect(getDbFileSize()).toBe(0);
  });

  it('counts the write-ahead log, where new rows wait until a checkpoint', () => {
    // Counting only context.db reported "+0 B" after indexing.
    writeFileSync(join(dir, 'context.db'), Buffer.alloc(4096));
    writeFileSync(join(dir, 'context.db-wal'), Buffer.alloc(1000));

    expect(getDbFileSize()).toBe(5096);
  });
});
