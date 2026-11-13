/**
 * When no chunk can be embedded (the model will not load, say), indexing
 * must fail and store nothing, not record an empty project as a current index.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runMigrations, getDb } from '../../database/index.js';
import { runIndexPipeline } from '../pipeline.js';
import { createMockEmbeddingProvider } from '../../cli/__tests__/integration/setup.js';
import type { EmbeddingProvider } from '../../sdk/rag/index.js';

let dir: string;

beforeAll(() => {
  runMigrations();
  dir = mkdtempSync(join(tmpdir(), 'ctx-embed-fail-'));
  writeFileSync(join(dir, 'a.ts'), 'export function add(a: number, b: number) {\n  return a + b;\n}\n');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('runIndexPipeline when embedding fails', () => {
  it('fails and stores nothing if no chunk could be embedded', async () => {
    const broken: EmbeddingProvider = {
      ...createMockEmbeddingProvider(),
      embed: async () => {
        throw new Error('Failed to load model');
      },
      embedBatch: async () => {
        throw new Error('Failed to load model');
      },
    };
    const name = `embed-fail-${Date.now()}`;

    await expect(
      runIndexPipeline({ projectPath: dir, projectName: name, embeddingProvider: broken })
    ).rejects.toThrow(/Could not embed any of the \d+ chunks: Failed to load model.*Nothing was stored/s);

    expect(getDb().prepare('SELECT COUNT(*) AS n FROM projects WHERE name = ?').get(name)).toEqual({ n: 0 });
  });

  it('still indexes when the model works', async () => {
    const name = `embed-ok-${Date.now()}`;
    const result = await runIndexPipeline({ projectPath: dir, projectName: name, embeddingProvider: createMockEmbeddingProvider() });

    expect(result.chunksStored).toBeGreaterThan(0);
  });
});
