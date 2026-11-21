/**
 * What the chunker does when a parser is missing or fails: the file is kept
 * whole and split by size, with a warning, and never dropped from the index.
 * In their own file because they replace the WebAssembly loader and the code
 * extractor with failing versions.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { FileInfo, Language } from '../types.js';

const grammarLoads = vi.hoisted(() => ({ count: 0 }));

vi.mock('web-tree-sitter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('web-tree-sitter')>();
  class FailingLanguage {
    static async load(): Promise<never> {
      grammarLoads.count++;
      throw new Error('corrupt grammar');
    }
  }
  return { ...actual, Language: FailingLanguage };
});

// The code extractor throws for any file containing PARSER_CRASH
vi.mock('../chunker/extractors/code-extractor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../chunker/extractors/code-extractor.js')>();
  return {
    ...actual,
    extractCodeSegments: (content: string, language: Language, extension?: string) => {
      if (content.includes('PARSER_CRASH')) throw new Error('parser crashed');
      return actual.extractCodeSegments(content, language, extension);
    },
  };
});

const { chunkFilesWithResult } = await import('../chunker/index.js');
const { prepareLanguage } = await import('../chunker/extractors/index.js');

const TEST_DIR = join(tmpdir(), 'ctx-chunker-fallbacks-' + Date.now());

beforeAll(() => mkdirSync(TEST_DIR, { recursive: true }));
afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }));

function file(name: string, content: string, language: Language): FileInfo {
  const path = join(TEST_DIR, name);
  writeFileSync(path, content);
  return {
    path,
    relativePath: name,
    extension: name.split('.').pop()!,
    language,
    type: 'code',
    size: Buffer.byteLength(content),
    modifiedAt: new Date().toISOString(),
  };
}

describe('chunker fallbacks', () => {
  it('a WebAssembly parser that fails to load: files split by size, warned once, loaded once', async () => {
    const files = [
      file('A.kt', 'class A {\n    fun a() {}\n}\n', 'kotlin'),
      file('B.kt', 'class B {\n    fun b() {}\n}\n', 'kotlin'),
    ];

    // Overlapping callers share one load
    await Promise.all([prepareLanguage('swift'), prepareLanguage('swift')]);
    expect(grammarLoads.count).toBe(1);

    const result = await chunkFilesWithResult(files);

    expect(result.successCount).toBe(2);
    for (const fileResult of result.files) {
      expect(fileResult.chunks.map((c) => c.metadata.symbolName)).toEqual([undefined]);
    }
    expect(result.warnings.filter((w) => w.includes('kotlin parser could not load'))).toHaveLength(1);
    expect(result.warnings[0]).toContain('corrupt grammar');
  });

  it('a parser that throws: the file is kept whole with a warning, not dropped', async () => {
    const result = await chunkFilesWithResult([file('crash.go', 'package main\n\n// PARSER_CRASH\nfunc main() {}\n', 'go')]);

    expect(result.successCount).toBe(1);
    expect(result.files[0]!.chunks).toHaveLength(1);
    expect(result.files[0]!.chunks[0]!.content).toContain('func main() {}');
    expect(result.warnings).toEqual([expect.stringContaining('Parsing failed (parser crashed), so the file is split by size')]);
  });
});
