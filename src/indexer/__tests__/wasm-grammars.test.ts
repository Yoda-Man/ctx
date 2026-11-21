/**
 * WebAssembly parsers (Dart, Kotlin, Swift) load asynchronously. These tests
 * run in their own file, so no parser is loaded before they start.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { chunkFile, extractCodeSegments } from '../chunker/index.js';

const TEST_DIR = join(tmpdir(), 'ctx-wasm-grammars-test-' + Date.now());
const KOTLIN = 'class Cart {\n    fun add(id: Int) {}\n    fun clear() {}\n}\n';

beforeAll(() => mkdirSync(TEST_DIR, { recursive: true }));
afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }));

describe('WebAssembly parsers', () => {
  it('before a parser is loaded, the file is kept whole and split by size', () => {
    expect(extractCodeSegments(KOTLIN, 'kotlin', 'kt').segments).toEqual([
      expect.objectContaining({ content: KOTLIN, metadata: { symbolType: 'module' } }),
    ]);
  });

  it('chunkFile loads the parser itself, so an indexed file is split by method', async () => {
    const filePath = join(TEST_DIR, 'Cart.kt');
    writeFileSync(filePath, KOTLIN);

    const chunks = await chunkFile({
      path: filePath,
      relativePath: 'Cart.kt',
      extension: 'kt',
      language: 'kotlin',
      type: 'code',
      size: Buffer.byteLength(KOTLIN),
      modifiedAt: new Date().toISOString(),
    });

    expect(chunks.map((c) => c.metadata.symbolName)).toEqual(expect.arrayContaining(['add', 'clear']));
  });
});
