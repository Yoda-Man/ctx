/**
 * fixtures/eval/ctx-source-golden.json: questions about ctx's own source,
 * scored by scripts/eval-source.ts. It names real files and, for each, a
 * pattern that file must contain; a rename, deletion or edit that moves an
 * answer must update it, and this test fails until it does.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GoldenDatasetSchema } from '../golden.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const raw = JSON.parse(readFileSync(join(root, 'fixtures/eval/ctx-source-golden.json'), 'utf-8')) as {
  entries: Array<{ query: string; evidence: Record<string, string> }>;
};
const dataset = GoldenDatasetSchema.parse(raw);

describe('ctx-source golden dataset', () => {
  it('has unique ids and questions', () => {
    expect(new Set(dataset.entries.map((e) => e.id)).size).toBe(dataset.entries.length);
    expect(new Set(dataset.entries.map((e) => e.query)).size).toBe(dataset.entries.length);
  });

  it('names, for each question, only files that still answer it', () => {
    // evidence: a pattern the expected file must contain (the code or text
    // that answers the question), so an edit that moves the answer fails here
    const stale = raw.entries.flatMap((e) =>
      Object.entries(e.evidence)
        .filter(([path, pattern]) => existsSync(join(root, path)) && !new RegExp(pattern).test(readFileSync(join(root, path), 'utf-8')))
        .map(([path, pattern]) => `${e.query} -> ${path} has no /${pattern}/`)
    );
    expect(stale).toEqual([]);
    for (const [i, e] of dataset.entries.entries()) {
      expect(Object.keys(raw.entries[i]!.evidence).sort()).toEqual([...(e.expectedFilePaths ?? [])].sort());
    }
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
