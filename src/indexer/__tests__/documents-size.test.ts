/**
 * What a Word or PDF file converts to decides how it is indexed: text over the
 * size limit is skipped with a warning, and a document with no text at all (a
 * scanned PDF) is reported rather than skipped silently.
 */

import { it, expect, vi } from 'vitest';
import { MAX_FILE_SIZE } from '../chunker/config.js';

let convertedText = '';
vi.mock('../documents.js', () => ({
  isConvertedDocument: () => true,
  readAsText: async () => convertedText,
}));

const { chunkFile } = await import('../chunker/index.js');

async function index(): Promise<{ chunks: unknown[]; warnings: string[] }> {
  const warnings: string[] = [];
  const chunks = await chunkFile(
    { path: '/specs/spec.pdf', relativePath: 'spec.pdf', extension: 'pdf', language: 'markdown', type: 'docs', size: 1024, modifiedAt: new Date().toISOString() },
    {},
    { onWarning: (message) => warnings.push(message) }
  );
  return { chunks, warnings };
}

it('skips a document whose converted text is over the limit', async () => {
  convertedText = 'word '.repeat(Math.ceil((MAX_FILE_SIZE + 1) / 5));
  const { chunks, warnings } = await index();

  expect(chunks).toEqual([]);
  expect(warnings[0]).toMatch(/File too large \(.* > 750(\.0)? ?KB\)/);
});

it('warns when a document has no text, as a scanned PDF does', async () => {
  convertedText = '\n\n';
  const { chunks, warnings } = await index();

  expect(chunks).toEqual([]);
  expect(warnings).toEqual([expect.stringContaining('No text found')]);
});
