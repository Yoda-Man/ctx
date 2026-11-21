/**
 * A failed or cancelled index leaves the database as it was: a fresh index's
 * half-stored project is removed, and a re-index that finds nothing keeps the
 * old index.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runMigrations, getDb } from '../../database/index.js';
import { DatabaseOperations } from '../../database/operations.js';
import { runIndexPipeline, IndexingCancelledError } from '../pipeline.js';
import { createMockEmbeddingProvider } from '../../cli/__tests__/integration/setup.js';

let dir: string;

beforeAll(() => {
  runMigrations();
  dir = mkdtempSync(join(tmpdir(), 'ctx-cleanup-'));
  mkdirSync(join(dir, 'app'));
  mkdirSync(join(dir, 'empty'));
  writeFileSync(join(dir, 'app', 'a.ts'), 'export function add(a: number, b: number) {\n  return a + b;\n}\n');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const countFor = (name: string) =>
  getDb()
    .prepare(
      'SELECT (SELECT COUNT(*) FROM projects WHERE name = ?) AS projects, ' +
        '(SELECT COUNT(*) FROM chunks c JOIN projects p ON p.id = c.project_id WHERE p.name = ?) AS chunks'
    )
    .get(name, name);

describe('runIndexPipeline cleanup', () => {
  it('removes a fresh project cancelled while storing', async () => {
    const name = `cancel-${Date.now()}`;
    const controller = new AbortController();

    await expect(
      runIndexPipeline({
        projectPath: join(dir, 'app'),
        projectName: name,
        embeddingProvider: createMockEmbeddingProvider(),
        signal: controller.signal,
        // Cancel once the first batch is in the chunks table
        onProgress: (stage) => {
          if (stage === 'storing') controller.abort();
        },
      })
    ).rejects.toBeInstanceOf(IndexingCancelledError);

    expect(countFor(name)).toEqual({ projects: 0, chunks: 0 });
  });

  it('removes a fresh project when Ctrl-C arrives while storing', async () => {
    const name = `sigint-${Date.now()}`;
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    let interrupted = false;
    try {
      await expect(
        runIndexPipeline({
          projectPath: join(dir, 'app'),
          projectName: name,
          embeddingProvider: createMockEmbeddingProvider(),
          // Ctrl-C once the first batch is in the chunks table
          onProgress: (stage) => {
            if (stage === 'storing' && !interrupted) {
              interrupted = true;
              process.emit('SIGINT');
            }
          },
        })
      ).rejects.toThrow(); // the database closed under it, as the process would exit
      expect(exit).toHaveBeenCalledWith(130);
    } finally {
      exit.mockRestore();
    }

    expect(countFor(name)).toEqual({ projects: 0, chunks: 0 });
  });

  it('keeps the old index when finishing a re-index fails', async () => {
    const name = `finish-fail-${Date.now()}`;
    const embeddingProvider = createMockEmbeddingProvider();
    const first = await runIndexPipeline({ projectPath: join(dir, 'app'), projectName: name, embeddingProvider });
    const oldIds = getDb().prepare('SELECT id FROM chunks WHERE project_id = ? ORDER BY id').all(first.projectId);
    const record = vi.spyOn(DatabaseOperations.prototype, 'replaceFileHashes').mockImplementation(() => {
      throw new Error('disk full');
    });

    try {
      await expect(
        runIndexPipeline({
          projectPath: join(dir, 'app'),
          projectName: name,
          projectId: first.projectId,
          embeddingProvider,
          useStaging: true,
        })
      ).rejects.toThrow('disk full');
    } finally {
      record.mockRestore();
    }

    // The swap rolled back with the failed write: the same chunks still answer
    expect(getDb().prepare('SELECT id FROM chunks WHERE project_id = ? ORDER BY id').all(first.projectId)).toEqual(oldIds);
  });

  it('keeps the old index when a re-index finds nothing', async () => {
    const name = `empty-reindex-${Date.now()}`;
    const embeddingProvider = createMockEmbeddingProvider();
    const first = await runIndexPipeline({ projectPath: join(dir, 'app'), projectName: name, embeddingProvider });

    await expect(
      runIndexPipeline({
        projectPath: join(dir, 'empty'),
        projectName: name,
        projectId: first.projectId,
        embeddingProvider,
        useStaging: true,
      })
    ).rejects.toThrow(/Found nothing to index in .*empty.*existing index for this project is unchanged/s);

    expect(countFor(name)).toEqual({ projects: 1, chunks: first.chunksStored });
    const project = getDb().prepare('SELECT path FROM projects WHERE name = ?').get(name) as { path: string };
    expect(project.path).toBe(join(dir, 'app'));
  });
});
