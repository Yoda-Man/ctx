/**
 * Indexing records each file's fingerprint, which is what `ctx check` compares
 * to count the files changed since the last index.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { Command } from 'commander';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runMigrations, getDb } from '../../database/index.js';
import { runIndexPipeline } from '../pipeline.js';
import { fileFingerprint } from '../scanner.js';
import { createMockEmbeddingProvider } from '../../cli/__tests__/integration/setup.js';
import { createCheckCommand } from '../../cli/commands/check.js';

let dir: string;

beforeAll(() => {
  runMigrations();
  dir = mkdtempSync(join(tmpdir(), 'ctx-file-hashes-'));
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'b.md'), '# B\n\nNotes.\n');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('file fingerprints', () => {
  it('records every indexed file, with its chunks, and notices an edit', async () => {
    const result = await runIndexPipeline({
      projectPath: dir,
      projectName: `hashes-${Date.now()}`,
      embeddingProvider: createMockEmbeddingProvider(),
    });

    const rows = getDb()
      .prepare('SELECT file_path, hash, chunk_ids FROM file_hashes WHERE project_id = ? ORDER BY file_path')
      .all(result.projectId) as Array<{ file_path: string; hash: string; chunk_ids: string }>;
    const now = (file: string) => {
      const stat = statSync(join(dir, file));
      return fileFingerprint(stat.size, stat.mtime);
    };

    expect(rows.map((r) => r.file_path)).toEqual(['a.ts', 'b.md']);
    expect(rows.map((r) => r.hash)).toEqual([now('a.ts'), now('b.md')]);
    const chunkCount = rows.reduce((n, r) => n + (JSON.parse(r.chunk_ids) as string[]).length, 0);
    expect(chunkCount).toBe(result.chunksStored);

    writeFileSync(join(dir, 'a.ts'), 'export const a = 2;\n');
    utimesSync(join(dir, 'a.ts'), new Date(), new Date(Date.now() + 5000));
    expect(now('a.ts')).not.toBe(rows[0]!.hash);
  });

  it('ctx check counts edited, deleted and added files, honouring the index\'s ignore patterns', async () => {
    const project = mkdtempSync(join(tmpdir(), 'ctx-check-changes-'));
    try {
      writeFileSync(join(project, 'a.ts'), 'export const a = 1;\n');
      writeFileSync(join(project, 'b.ts'), 'export const b = 1;\n');
      writeFileSync(join(project, 'keep.ts'), 'export const keep = 1;\n');
      const name = `check-${Date.now()}`;
      await runIndexPipeline({
        projectPath: project,
        projectName: name,
        embeddingProvider: createMockEmbeddingProvider(),
        additionalIgnorePatterns: ['gen/'],
      });

      const check = async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
          const program = new Command().addCommand(
            createCheckCommand(() => ({
              options: { verbose: false, json: true },
              log: () => {},
              debug: () => {},
              warn: () => {},
              error: () => {},
            }))
          );
          await program.parseAsync(['node', 'ctx', 'check', name]);
          return JSON.parse(log.mock.calls[0]![0] as string).staleness.filesChanged as number;
        } finally {
          log.mockRestore();
        }
      };

      expect(await check()).toBe(0);

      writeFileSync(join(project, 'a.ts'), 'export const a = 22;\n'); // edited (new size)
      rmSync(join(project, 'b.ts')); // deleted
      writeFileSync(join(project, 'c.ts'), 'export const c = 1;\n'); // added
      mkdirSync(join(project, 'gen'));
      writeFileSync(join(project, 'gen', 'out.ts'), 'export {};\n'); // added but ignored

      expect(await check()).toBe(3);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
