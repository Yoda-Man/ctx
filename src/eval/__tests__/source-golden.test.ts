/**
 * fixtures/eval/ctx-source-golden.json: questions about ctx's own source,
 * scored by scripts/eval-source.ts. It names real files, so a rename or
 * deletion must update it; this test fails until it does.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GoldenDatasetSchema } from '../golden.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const dataset = GoldenDatasetSchema.parse(
  JSON.parse(readFileSync(join(root, 'fixtures/eval/ctx-source-golden.json'), 'utf-8'))
);

describe('ctx-source golden dataset', () => {
  it('has unique ids and questions', () => {
    expect(new Set(dataset.entries.map((e) => e.id)).size).toBe(dataset.entries.length);
    expect(new Set(dataset.entries.map((e) => e.query)).size).toBe(dataset.entries.length);
  });

  it('names only files that exist and are indexed', () => {
    const missing = dataset.entries.flatMap((e) =>
      (e.expectedFilePaths ?? []).filter((p) => !existsSync(join(root, p)))
    );
    expect(missing).toEqual([]);

    // eval-source.ts does not index tests or fixtures
    const unindexed = dataset.entries.flatMap((e) =>
      (e.expectedFilePaths ?? []).filter((p) => p.includes('__tests__') || p.startsWith('fixtures/'))
    );
    expect(unindexed).toEqual([]);
  });
});
