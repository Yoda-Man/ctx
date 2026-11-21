/**
 * WebAssembly tree-sitter parsers, for languages without a prebuilt native one.
 *
 * Dart, Kotlin and Swift have no prebuilt native binding: installing one
 * compiles C on the user's machine, and fails without a compiler. Their
 * WebAssembly builds (grammars/, rebuilt by scripts/build-grammars.sh) load
 * anywhere through web-tree-sitter. Loading is async, so the chunker calls
 * prepareLanguage() before extracting. A parser that fails to load leaves its
 * language split by size, as before, rather than failing the index.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Language as WasmLanguage, Parser as WasmParser } from 'web-tree-sitter';

import type { Language } from '../../types.js';

const WASM_FILES: Partial<Record<Language, string>> = {
  dart: 'tree-sitter-dart.wasm',
  kotlin: 'tree-sitter-kotlin.wasm',
  swift: 'tree-sitter-swift.wasm',
};

let runtime: Promise<void> | undefined;
const parsers = new Map<Language, WasmParser>();
/** One load per language: concurrent callers share it. Resolves to the error, if any. */
const loads = new Map<Language, Promise<string | undefined>>();
/** Languages whose load failure has been reported once already. */
const reported = new Set<Language>();

/**
 * grammars/ sits at the package root: one level above dist/ once built, four
 * above this file in the source tree (tests).
 */
function grammarsDir(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 5; depth++) {
    const candidate = join(dir, 'grammars');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return null;
}

async function loadParser(language: Language, file: string): Promise<string | undefined> {
  try {
    const dir = grammarsDir();
    if (!dir) throw new Error('the grammars/ folder is missing');
    runtime ??= WasmParser.init();
    await runtime;
    const parser = new WasmParser();
    parser.setLanguage(await WasmLanguage.load(join(dir, file)));
    parsers.set(language, parser);
    return undefined;
  } catch (error) {
    // Split by size instead: a missing parser must never fail indexing
    return `The ${language} parser could not load (${(error as Error).message}), so ${language} files are split by size`;
  }
}

/**
 * Load the parser for a WebAssembly language once; other languages resolve at
 * once. Resolves to a warning the first time a load fails, so it is reported
 * once, not for every file of that language; otherwise to undefined.
 */
export async function prepareLanguage(language: Language): Promise<string | undefined> {
  const file = WASM_FILES[language];
  if (!file) return undefined;
  let load = loads.get(language);
  if (!load) {
    load = loadParser(language, file);
    loads.set(language, load);
  }
  const error = await load;
  if (!error || reported.has(language)) return undefined;
  reported.add(language);
  return error;
}

/** The loaded parser for a WebAssembly language, or undefined. */
export function wasmParserFor(language: Language): WasmParser | undefined {
  return parsers.get(language);
}
