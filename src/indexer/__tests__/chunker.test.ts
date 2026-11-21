/**
 * Chunker Module Tests
 *
 * Tests for the document chunking pipeline:
 * - Code extraction (tree-sitter AST parsing)
 * - Markdown extraction (prose/code blocks)
 * - Main chunker orchestration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  extractCodeSegments,
  extractMarkdownSegments,
  chunkFile,
  estimateTokens,
} from '../chunker/index.js';
import { prepareLanguage } from '../chunker/extractors/index.js';
import type { FileInfo } from '../types.js';

// Test fixtures directory
const TEST_DIR = join(tmpdir(), 'ctx-chunker-test-' + Date.now());

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('Code Extractor', () => {
  describe('extractCodeSegments - TypeScript', () => {
    it('keeps a JSDoc comment with the function it documents', () => {
      const code = `
/**
 * Adds two numbers together.
 * @param a - First number
 * @param b - Second number
 */
function add(a: number, b: number): number {
  return a + b;
}
`;

      const result = extractCodeSegments(code, 'typescript');

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0]).toMatchObject({ contentType: 'code', startLine: 2, endLine: 9, metadata: { symbolName: 'add' } });
      expect(result.segments[0]!.content).toContain('Adds two numbers together');
    });

    it('should extract function declarations', () => {
      const code = `
function hello(name: string): string {
  return \`Hello, \${name}!\`;
}
`;

      const result = extractCodeSegments(code, 'typescript');

      const functions = result.segments.filter(
        (s) => s.contentType === 'code' && s.metadata.symbolType === 'function'
      );

      expect(functions.length).toBe(1);
      expect(functions[0]?.metadata.symbolName).toBe('hello');
    });

    it('should extract classes', () => {
      const code = `
class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}
`;

      const result = extractCodeSegments(code, 'typescript');

      const classes = result.segments.filter(
        (s) => s.contentType === 'code' && s.metadata.symbolType === 'class'
      );

      expect(classes.length).toBe(1);
      expect(classes[0]?.metadata.symbolName).toBe('Calculator');
    });

    it('should extract interfaces', () => {
      const code = `
interface User {
  name: string;
  age: number;
}
`;

      const result = extractCodeSegments(code, 'typescript');

      const interfaces = result.segments.filter(
        (s) => s.contentType === 'code' && s.metadata.symbolType === 'interface'
      );

      expect(interfaces.length).toBe(1);
      expect(interfaces[0]?.metadata.symbolName).toBe('User');
    });

    it('should extract type aliases', () => {
      const code = `
type Status = 'active' | 'inactive' | 'pending';
`;

      const result = extractCodeSegments(code, 'typescript');

      const types = result.segments.filter(
        (s) => s.contentType === 'code' && s.metadata.symbolType === 'type'
      );

      expect(types.length).toBe(1);
      expect(types[0]?.metadata.symbolName).toBe('Status');
    });
  });

  describe('extractCodeSegments - Python', () => {
    it('keeps the module docstring in a module segment', () => {
      const code = `"""
This module provides utility functions.
"""

def add(a, b):
    return a + b
`;

      const result = extractCodeSegments(code, 'python');

      const moduleSegment = result.segments.find((s) => s.metadata.symbolType === 'module');
      expect(moduleSegment).toMatchObject({ startLine: 1, endLine: 3 });
      expect(moduleSegment!.content).toContain('utility functions');
    });

    it('keeps a function docstring inside its function', () => {
      const code = `
def greet(name):
    """
    Greets a person by name.

    Args:
        name: The name of the person

    Returns:
        A greeting string
    """
    return f"Hello, {name}!"
`;

      const result = extractCodeSegments(code, 'python');

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0]!.metadata.symbolName).toBe('greet');
      expect(result.segments[0]!.content).toContain('Greets a person');
    });

    it('should extract Python functions', () => {
      const code = `
def calculate(x, y):
    return x + y
`;

      const result = extractCodeSegments(code, 'python');

      const functions = result.segments.filter(
        (s) => s.contentType === 'code' && s.metadata.symbolType === 'function'
      );

      expect(functions.length).toBe(1);
      expect(functions[0]?.metadata.symbolName).toBe('calculate');
    });
  });

  describe('extractCodeSegments - every line, once', () => {
    /** Each non-blank line is in exactly one segment, and segments are the file's own lines. */
    function expectFullCoverage(code: string, segments: ReturnType<typeof extractCodeSegments>['segments']) {
      const lines = code.split('\n');
      const owners = lines.map(() => 0);
      for (const s of segments) {
        expect(s.content).toBe(lines.slice(s.startLine - 1, s.endLine).join('\n'));
        for (let i = s.startLine - 1; i < s.endLine; i++) owners[i]!++;
      }
      lines.forEach((line, i) => {
        if (line.trim()) expect({ line: i + 1, text: line, owners: owners[i] }).toEqual({ line: i + 1, text: line, owners: 1 });
      });
    }

    it('TypeScript: keeps constants, export keywords and doc comments with their code', () => {
      const code = [
        '/** Tool timeouts. */',
        '',
        "import { ToolTimeoutError } from '../errors/errors';",
        '',
        '/** Default tool timeout: 30 seconds */',
        'export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;',
        'const RETRIES = 3;',
        '',
        '/**',
        ' * Wrap a promise with a timeout.',
        ' */',
        'export async function withTimeout<T>(promise: Promise<T>): Promise<T> {',
        '  const onAbort = () => undefined;',
        '  function inner() { return onAbort; }',
        '  inner();',
        '  return promise;',
        '}',
        '',
        '// Retries a call',
        'export const retry = async (fn: () => Promise<void>) => { await fn(); };',
        '',
        'export class Runner {',
        '  /** Runs once. */',
        '  run(): number { return RETRIES; }',
        '}',
        '',
        "export { ToolTimeoutError } from '../errors/errors';",
        'export default withTimeout;',
      ].join('\n');

      const { segments } = extractCodeSegments(code, 'typescript');

      expectFullCoverage(code, segments);
      const fn = segments.find((s) => s.metadata.symbolName === 'withTimeout')!;
      expect(fn.startLine).toBe(9); // its doc comment
      expect(fn.content).toContain('export async function withTimeout');
      expect(segments.filter((s) => s.content.includes('function inner'))).toHaveLength(1);
      expect(segments.find((s) => s.metadata.symbolName === 'retry')!.startLine).toBe(19);
      expect(segments.find((s) => s.metadata.symbolName === 'Runner')!.metadata.symbolType).toBe('class');
      expect(segments.some((s) => s.content.includes('export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;'))).toBe(true);
    });

    it('Python: keeps the module docstring, constants, decorators and the main block', () => {
      const code = [
        '"""Sound effects."""',
        '',
        'import math',
        '',
        'SAMPLE_RATE = 22050',
        'VOLUMES = {"low": 0.2, "high": 0.8}',
        '',
        '',
        '# Cached tones',
        '@functools.cache',
        'def tone(freq):',
        '    """Return a sine tone."""',
        '    def wave(t):',
        '        return math.sin(freq * t)',
        '    return wave',
        '',
        '',
        'class Mixer:',
        '    """Mixes channels."""',
        '',
        '    def mix(self, a, b):',
        '        return a + b',
        '',
        '',
        'if __name__ == "__main__":',
        '    print(tone(440))',
      ].join('\n');

      const { segments } = extractCodeSegments(code, 'python');

      expectFullCoverage(code, segments);
      const tone = segments.find((s) => s.metadata.symbolName === 'tone')!;
      expect(tone.startLine).toBe(9); // its comment and decorator
      expect(tone.content).toContain('Return a sine tone.');
      expect(segments.filter((s) => s.content.includes('def wave'))).toHaveLength(1);
      expect(segments.filter((s) => s.content.includes('def mix'))).toHaveLength(1);
      expect(segments.some((s) => s.content.includes('SAMPLE_RATE = 22050'))).toBe(true);
      expect(segments.some((s) => s.content.includes('if __name__ == "__main__":'))).toBe(true);
    });

    it('places a line once when a comment or statement shares it', () => {
      const code = [
        "type Code =",
        "  | 'A' // first",
        "  | 'B'; // last",
        'const a = 1; const b = 2; // two on one line',
        'function f() { return a + b; } const c = 3;',
      ].join('\n');

      expectFullCoverage(code, extractCodeSegments(code, 'typescript').segments);
    });

    it('other languages: keeps the code, not only the comments', () => {
      const code = '# Entry point\nclass Main\n  def run; end\nend';

      const { segments } = extractCodeSegments(code, 'scala');

      expectFullCoverage(code, segments);
    });

    it('Go and Rust: every line once', () => {
      const go = 'package main\n\nimport "fmt"\n\n// Greet says hello.\nfunc Greet() {\n\tfmt.Println("hi")\n}\n\nconst Max = 3\n';
      expectFullCoverage(go, extractCodeSegments(go, 'go').segments);

      const rust = 'use std::fmt;\n\n/// A point.\n#[derive(Debug)]\nstruct Point { x: i32 }\n\nimpl Point {\n    fn new() -> Self { Point { x: 0 } }\n}\n\nconst MAX: i32 = 3;\n';
      expectFullCoverage(rust, extractCodeSegments(rust, 'rust').segments);
    });
  });

  describe('extractCodeSegments - Go', () => {
    it('splits funcs, methods and types, with their doc comments', () => {
      const code = [
        'package shapes',
        '',
        'import "math"',
        '',
        '// Circle is a round shape.',
        'type Circle struct {',
        '\tR float64',
        '}',
        '',
        '// Area returns the area.',
        'func (c Circle) Area() float64 {',
        '\treturn math.Pi * c.R * c.R',
        '}',
        '',
        'func New(r float64) Circle { return Circle{R: r} }',
      ].join('\n');

      const { segments } = extractCodeSegments(code, 'go');

      expect(segments.map((s) => [s.metadata.symbolType, s.metadata.symbolName])).toEqual([
        ['module', undefined],
        ['type', 'Circle'],
        ['function', 'Area'],
        ['function', 'New'],
      ]);
      expect(segments[1]!.content.startsWith('// Circle is a round shape.')).toBe(true);
      expect(segments[2]!.content.startsWith('// Area returns the area.')).toBe(true);
    });
  });

  describe('extractCodeSegments - Rust', () => {
    it('splits items, keeping doc comments and attributes with them', () => {
      const code = [
        'use std::fmt;',
        '',
        '/// A point in 2D.',
        '#[derive(Debug, Clone)]',
        'pub struct Point {',
        '    x: i32,',
        '}',
        '',
        'impl fmt::Display for Point {',
        '    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result { write!(f, "{}", self.x) }',
        '}',
        '',
        'pub trait Shape {',
        '    fn area(&self) -> f64;',
        '}',
        '',
        'pub fn origin() -> Point { Point { x: 0 } }',
      ].join('\n');

      const { segments } = extractCodeSegments(code, 'rust');

      expect(segments.map((s) => [s.metadata.symbolType, s.metadata.symbolName])).toEqual([
        ['module', undefined],
        ['type', 'Point'],
        ['class', 'Point'],
        ['interface', 'Shape'],
        ['function', 'origin'],
      ]);
      expect(segments[1]!.content.startsWith('/// A point in 2D.\n#[derive(Debug, Clone)]')).toBe(true);
    });
  });

  /** Every non-blank line in exactly one segment, and each segment's text matches its lines. */
  function expectEveryLineOnce(code: string, segments: ReturnType<typeof extractCodeSegments>['segments']) {
    const lines = code.split('\n');
    const owners = lines.map(() => 0);
    for (const s of segments) {
      expect(s.content).toBe(lines.slice(s.startLine - 1, s.endLine).join('\n'));
      for (let i = s.startLine - 1; i < s.endLine; i++) owners[i]!++;
    }
    lines.forEach((line, i) => {
      if (line.trim()) expect({ line: i + 1, owners: owners[i] }).toEqual({ line: i + 1, owners: 1 });
    });
  }

  describe('extractCodeSegments - Java', () => {
    const code = [
      'package shop;',
      '',
      'import java.util.List;',
      '',
      '/** An order. */',
      'public class Order {',
      '    private final List<String> items;',
      '',
      '    /** Creates an empty order. */',
      '    public Order() { this.items = List.of(); }',
      '',
      '    @Override',
      '    public String toString() {',
      '        return items.toString();',
      '    }',
      '}',
    ].join('\n');

    it('splits a class into its methods, each labelled with the class', () => {
      const { segments } = extractCodeSegments(code, 'java');

      expect(segments.map((s) => [s.metadata.symbolType, s.metadata.symbolName, s.metadata.parentSymbol])).toEqual([
        ['module', undefined, undefined],
        ['method', 'Order', 'Order'],
        ['method', 'toString', 'Order'],
      ]);
      // Javadoc and annotations stay with their method
      expect(segments[1]!.content.startsWith('    /** Creates an empty order. */')).toBe(true);
      expect(segments[2]!.content.startsWith('    @Override')).toBe(true);
    });

    it('keeps every non-blank line once, with the closing brace on the last method', () => {
      const { segments } = extractCodeSegments(code, 'java');

      expectEveryLineOnce(code, segments);
      expect(segments[2]!.content.endsWith('    }\n}')).toBe(true);
      // The class header and its field are one segment with the package and imports
      expect(segments[0]!.content).toContain('private final List<String> items;');
    });
  });

  describe('extractCodeSegments - C#', () => {
    it('steps into namespaces and classes, keeping attributes with their members', () => {
      const code = [
        'using System;',
        '',
        'namespace Shop',
        '{',
        '    /// <summary>An order.</summary>',
        '    public class Order',
        '    {',
        '        public int Count { get; set; }',
        '',
        '        [Obsolete]',
        '        public void Clear() { Count = 0; }',
        '    }',
        '}',
      ].join('\n');

      const { segments } = extractCodeSegments(code, 'csharp');

      expect(segments.map((s) => [s.metadata.symbolType, s.metadata.symbolName, s.metadata.parentSymbol])).toEqual([
        ['module', undefined, undefined],
        ['method', 'Count', 'Order'],
        ['method', 'Clear', 'Order'],
      ]);
      expect(segments[2]!.content).toContain('[Obsolete]');
      expectEveryLineOnce(code, segments);
    });

    it("does not hand a one-line class's comment to its first member", () => {
      const code = '/// <summary>An order.</summary>\npublic class Order { public void Clear() { } }\n';

      const { segments } = extractCodeSegments(code, 'csharp');

      const clear = segments.find((s) => s.metadata.symbolName === 'Clear')!;
      expect(clear.content).not.toContain('An order.');
      expectEveryLineOnce(code, segments);
    });

    it('handles file-scoped namespaces', () => {
      const code = 'namespace Shop;\n\npublic class Cart\n{\n    public void Add() { }\n}\n';
      const { segments } = extractCodeSegments(code, 'csharp');

      expect(segments.map((s) => s.metadata.symbolName)).toEqual([undefined, 'Add']);
    });
  });

  /** [symbolType, symbolName, parentSymbol] of each segment */
  const labels = (segments: ReturnType<typeof extractCodeSegments>['segments']) =>
    segments.map((s) => [s.metadata.symbolType, s.metadata.symbolName, s.metadata.parentSymbol]);

  describe('extractCodeSegments - TSX', () => {
    it('parses JSX with the TSX grammar, so a function after it is found', () => {
      const code = 'const a = <div>{"}"}</div>;\nfunction B() {\n  return 1;\n}\n';

      // The plain TypeScript grammar reads the JSX as an error and loses B
      expect(labels(extractCodeSegments(code, 'typescript').segments)).toEqual([['module', undefined, undefined]]);
      const { segments } = extractCodeSegments(code, 'typescript', 'tsx');
      expect(labels(segments)).toEqual([['module', undefined, undefined], ['function', 'B', undefined]]);
      expectEveryLineOnce(code, segments);
    });
  });

  describe('extractCodeSegments - C and C++', () => {
    it('C: steps through an include guard; functions keep their comment, structs and typedefs are types', () => {
      const code = [
        '#ifndef MATH_H',
        '#define MATH_H',
        '',
        '/* Adds two ints. */',
        'static int add(int a, int b) {',
        '    return a + b;',
        '}',
        '',
        'int *make(void) { return 0; }',
        '',
        'struct Point { int x; int y; };',
        'typedef struct { int w; } Size;',
        'int proto(int);',
        '#endif',
      ].join('\n');

      const { segments } = extractCodeSegments(code, 'c', 'c');

      expect(labels(segments)).toEqual([
        ['module', undefined, undefined],
        ['function', 'add', undefined],
        ['function', 'make', undefined],
        ['type', 'Point', undefined],
        ['type', 'Size', undefined],
        ['module', undefined, undefined],
      ]);
      expect(segments[1]!.content.startsWith('/* Adds two ints. */')).toBe(true);
      expectEveryLineOnce(code, segments);
    });

    it('C++: methods inside classes, functions inside namespaces and extern "C"', () => {
      const code = [
        'namespace shop {',
        'class Cart {',
        'public:',
        '    Cart();',
        '    void add(int id) {',
        '        items.push_back(id);',
        '    }',
        '    std::vector<int> items;',
        '};',
        'void Cart::clear() { items.clear(); }',
        'template <typename T> T first(T t) { return t; }',
        '}',
        'extern "C" { int version(void) { return 1; } }',
      ].join('\n');

      const { segments } = extractCodeSegments(code, 'cpp', 'cpp');

      expect(labels(segments)).toEqual([
        ['module', undefined, 'shop'],
        ['method', 'add', 'Cart'],
        ['module', undefined, 'Cart'],
        ['function', 'Cart::clear', 'shop'],
        ['function', 'first', 'shop'],
        ['function', 'version', undefined],
      ]);
      expectEveryLineOnce(code, segments);
    });

    it('C++: a class declared with a variable is split by method too', () => {
      const code = 'static struct Handler {\n    void run() {}\n    void stop() {}\n} handler;\n';

      const { segments } = extractCodeSegments(code, 'cpp', 'cpp');

      expect(labels(segments).filter(([type]) => type === 'method')).toEqual([
        ['method', 'run', 'Handler'],
        ['method', 'stop', 'Handler'],
      ]);
      expectEveryLineOnce(code, segments);
    });

    it('a .h file is read with the C++ grammar, so a class in a header is split', () => {
      const code = '#pragma once\nclass A {\npublic:\n    void m() { }\n    int x;\n};\n';

      const { segments } = extractCodeSegments(code, 'c', 'h');

      expect(labels(segments)).toContainEqual(['method', 'm', 'A']);
      expectEveryLineOnce(code, segments);
    });
  });

  describe('extractCodeSegments - PHP, Ruby and PowerShell', () => {
    it('PHP: methods by class, functions on their own, not split inside a function', () => {
      const code = [
        '<?php',
        'namespace App;',
        '',
        '/** A cart. */',
        'class Cart {',
        '    private array $items = [];',
        '    public function add(int $id): void {',
        '        $this->items[] = $id;',
        '    }',
        '}',
        '',
        'function total(array $xs): int {',
        '    $sum = 0;',
        '    foreach ($xs as $x) { $sum += $x; }',
        '    return $sum;',
        '}',
      ].join('\n');

      const { segments } = extractCodeSegments(code, 'php', 'php');

      expect(labels(segments)).toEqual([
        ['module', undefined, undefined],
        ['method', 'add', 'Cart'],
        ['function', 'total', undefined],
      ]);
      expectEveryLineOnce(code, segments);
    });

    it('Ruby: instance and class methods by class, top-level methods as functions', () => {
      const code = [
        'require "json"',
        '',
        '# A cart.',
        'class Cart < Base',
        '  attr_reader :items',
        '  def add(id)',
        '    items << id',
        '  end',
        '  def self.empty; new; end',
        'end',
        '',
        'def total(xs)',
        '  xs.sum',
        'end',
      ].join('\n');

      const { segments } = extractCodeSegments(code, 'ruby', 'rb');

      expect(labels(segments)).toEqual([
        ['module', undefined, undefined],
        ['method', 'add', 'Cart'],
        ['method', 'empty', 'Cart'],
        ['function', 'total', undefined],
      ]);
      expectEveryLineOnce(code, segments);
    });

    it('PowerShell: functions, and class methods by class', () => {
      const code = [
        '# Gets an item.',
        'function Get-Item {',
        '    param($Id)',
        '    return $Id',
        '}',
        '',
        'class Cart {',
        '    [int]$Count',
        '    [void] Add() { $this.Count++ }',
        '}',
        '$cart = [Cart]::new()',
      ].join('\n');

      const { segments } = extractCodeSegments(code, 'powershell', 'ps1');

      expect(labels(segments)).toEqual([
        ['function', 'Get-Item', undefined],
        ['module', undefined, 'Cart'],
        ['method', 'Add', 'Cart'],
        ['module', undefined, undefined],
      ]);
      expect(segments[0]!.content.startsWith('# Gets an item.')).toBe(true);
      expectEveryLineOnce(code, segments);
    });
  });

  describe('extractCodeSegments - Dart, Kotlin and Swift (WebAssembly parsers)', () => {
    beforeAll(async () => {
      for (const language of ['dart', 'kotlin', 'swift'] as const) await prepareLanguage(language);
    });

    it('Dart: methods by class, each with its body; top-level functions', () => {
      const code = [
        "import 'dart:math';",
        '',
        '/// A cart.',
        'class Cart {',
        '  final items = <int>[];',
        '  int get count => items.length;',
        '  void add(int id) {',
        '    items.add(id);',
        '  }',
        '}',
        '',
        'void main() {',
        '  Cart().add(1);',
        '}',
      ].join('\n');

      const { segments } = extractCodeSegments(code, 'dart', 'dart');

      expect(labels(segments)).toEqual([
        ['module', undefined, undefined],
        ['method', 'count', 'Cart'],
        ['method', 'add', 'Cart'],
        ['function', 'main', undefined],
      ]);
      expectEveryLineOnce(code, segments);
    });

    it('Kotlin: methods by class, companion objects included; top-level functions', () => {
      const code = [
        'package shop',
        '',
        'class Cart(val owner: String) {',
        '    val items = mutableListOf<Int>()',
        '    fun add(id: Int) {',
        '        items.add(id)',
        '    }',
        '    companion object {',
        '        fun empty() = Cart("")',
        '    }',
        '}',
        '',
        'fun main() {',
        '    Cart("a").add(1)',
        '}',
      ].join('\n');

      const { segments } = extractCodeSegments(code, 'kotlin', 'kt');

      expect(labels(segments).filter(([type]) => type !== 'module')).toEqual([
        ['method', 'add', 'Cart'],
        ['method', 'empty', 'Cart'],
        ['function', 'main', undefined],
      ]);
      expectEveryLineOnce(code, segments);
    });

    it('Swift: methods and initializers by type; top-level functions', () => {
      const code = [
        'import Foundation',
        '',
        '/// A cart.',
        'struct Cart {',
        '    var items: [Int] = []',
        '    init() {}',
        '    mutating func add(_ id: Int) {',
        '        items.append(id)',
        '    }',
        '}',
        '',
        'func main() {',
        '    var cart = Cart()',
        '}',
      ].join('\n');

      const { segments } = extractCodeSegments(code, 'swift', 'swift');

      expect(labels(segments)).toEqual([
        ['module', undefined, undefined],
        ['method', 'init', 'Cart'],
        ['method', 'add', 'Cart'],
        ['function', 'main', undefined],
      ]);
      expectEveryLineOnce(code, segments);
    });
  });

  describe('extractCodeSegments - lines no node covers', () => {
    it('keeps an unfinished block at the end of a file instead of dropping it', () => {
      // tree-sitter leaves `else {` outside every named node; it used to be lost
      const code = 'run(function () {\n  if (a) {\n    b();\n  }\n  else {';

      const { segments } = extractCodeSegments(code, 'javascript');

      expectEveryLineOnce(code, segments);
      expect(segments[segments.length - 1]!.content).toBe('  else {');
    });
  });

  describe('extractCodeSegments - Fallback', () => {
    it('keeps the whole file for unsupported languages', () => {
      const code = `
# This is a comment
class Main
  def run; end
end
`;

      // It used to keep only the comment and drop the code
      for (const language of ['scala', 'vb'] as const) {
        const result = extractCodeSegments(code, language);
        expect(result.segments).toHaveLength(1);
        expect(result.segments[0]).toMatchObject({ content: code, startLine: 1, metadata: { symbolType: 'module' } });
      }
    });
  });
});

describe('Markdown Extractor', () => {
  describe('extractMarkdownSegments - sections', () => {
    it('makes one segment per section, heading included, covering every line once', () => {
      const md = [
        'Intro before any heading.',
        '',
        '## Setup',
        '',
        '### Requirements',
        '',
        '- Node 24',
        '',
        '## Exit Codes',
        '',
        '| Code | Meaning |',
        '|------|---------|',
        '| `5` | Database error |',
        '',
        '```bash',
        '# not a heading: a shell comment',
        'ctx status',
        '```',
        '',
        '[docs]: https://example.com',
      ].join('\n');

      const { segments } = extractMarkdownSegments(md);
      const lines = md.split('\n');
      const owners = lines.map(() => 0);
      for (const s of segments) {
        expect(s.content).toBe(lines.slice(s.startLine - 1, s.endLine).join('\n'));
        for (let i = s.startLine - 1; i < s.endLine; i++) owners[i]!++;
      }
      lines.forEach((line, i) => { if (line.trim()) expect([i + 1, owners[i]]).toEqual([i + 1, 1]); });

      expect(segments.map((s) => [s.startLine, s.endLine, s.metadata.sectionHeader])).toEqual([
        [1, 1, undefined],
        [3, 7, 'Requirements'], // a heading with nothing under it joins the next section
        [9, 20, 'Exit Codes'],
      ]);
      expect(segments.every((s) => s.contentType === 'docs')).toBe(true);
    });

    it('keeps front matter with the first section instead of a 3-character segment', () => {
      const { segments } = extractMarkdownSegments('---\ntitle: Guide\n---\n\n# Guide\n\nRead me.');
      expect(segments.every((s) => s.content.length >= 10)).toBe(true);
      expect(segments[0]!.startLine).toBe(1);
    });

    it('handles Windows line endings', () => {
      const { segments } = extractMarkdownSegments('# Title\r\n\r\nBody text here.\r\n');
      expect(segments).toEqual([expect.objectContaining({ startLine: 1, endLine: 3, content: '# Title\n\nBody text here.' })]);
    });
  });

  describe('extractMarkdownSegments', () => {
    it('keeps a code block in its section, with the prose that explains it', () => {
      const markdown = `
# Introduction

Here's some code:

\`\`\`typescript
const x = 1;
console.log(x);
\`\`\`
`;

      const result = extractMarkdownSegments(markdown);

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0]!.content).toContain("Here's some code:");
      expect(result.segments[0]!.content).toContain('const x = 1');
    });

    it('should extract prose as docs segments', () => {
      const markdown = `
# Getting Started

This is a paragraph of text explaining how to use the library.

## Installation

Run the following command to install.
`;

      const result = extractMarkdownSegments(markdown);

      const docsSegments = result.segments.filter((s) => s.contentType === 'docs');
      expect(docsSegments.length).toBeGreaterThan(0);

      // Should capture prose
      const proseSegment = docsSegments.find((s) =>
        s.content.includes('paragraph of text')
      );
      expect(proseSegment).toBeDefined();
    });

    it('should track section headers as context', () => {
      const markdown = `
# API Reference

## Methods

The following methods are available.

\`\`\`javascript
api.get('/users');
\`\`\`
`;

      const result = extractMarkdownSegments(markdown);

      const codeSection = result.segments.find((s) => s.content.includes("api.get('/users')"));
      expect(codeSection?.metadata.sectionHeader).toBe('Methods');
    });

    it('should handle lists', () => {
      const markdown = `
## Features

- Feature one
- Feature two
- Feature three
`;

      const result = extractMarkdownSegments(markdown);

      const listSegment = result.segments.find((s) =>
        s.content.includes('Feature one')
      );
      expect(listSegment).toBeDefined();
      expect(listSegment?.contentType).toBe('docs');
    });
  });
});

describe('Configuration', () => {
  describe('estimateTokens', () => {
    it('should estimate tokens from text length', () => {
      // ~4 characters per token
      const text = 'a'.repeat(100);
      const tokens = estimateTokens(text);

      expect(tokens).toBe(25); // 100 / 4
    });

    it('should round up token count', () => {
      const text = 'hello'; // 5 characters
      const tokens = estimateTokens(text);

      expect(tokens).toBe(2); // ceil(5 / 4) = 2
    });
  });
});

describe('Chunker Integration', () => {
  it('should chunk a TypeScript file', async () => {
    // Create a test file
    const filePath = join(TEST_DIR, 'test.ts');
    const content = `
/**
 * A simple calculator class.
 */
class Calculator {
  /**
   * Adds two numbers.
   */
  add(a: number, b: number): number {
    return a + b;
  }

  /**
   * Subtracts two numbers.
   */
  subtract(a: number, b: number): number {
    return a - b;
  }
}
`;
    writeFileSync(filePath, content);

    const fileInfo: FileInfo = {
      path: filePath,
      relativePath: 'test.ts',
      extension: 'ts',
      language: 'typescript',
      type: 'code',
      size: Buffer.byteLength(content),
      modifiedAt: new Date().toISOString(),
    };

    const chunks = await chunkFile(fileInfo);

    // Should produce multiple chunks (docs + code)
    expect(chunks.length).toBeGreaterThan(0);

    // Each chunk should have proper metadata
    for (const chunk of chunks) {
      expect(chunk.file_path).toBe('test.ts');
      expect(chunk.language).toBe('typescript');
      expect(chunk.metadata.totalChunks).toBe(chunks.length);
    }
  });

  it('should chunk a Markdown file', async () => {
    const filePath = join(TEST_DIR, 'readme.md');
    const content = `
# Project Name

This is a sample project.

## Installation

\`\`\`bash
npm install
\`\`\`

## Usage

Import and use the library:

\`\`\`typescript
import { hello } from 'project';
hello('world');
\`\`\`
`;
    writeFileSync(filePath, content);

    const fileInfo: FileInfo = {
      path: filePath,
      relativePath: 'readme.md',
      extension: 'md',
      language: 'markdown',
      type: 'docs',
      size: Buffer.byteLength(content),
      modifiedAt: new Date().toISOString(),
    };

    const chunks = await chunkFile(fileInfo);

    // One chunk per section, each starting with its heading
    expect(chunks.map((c) => c.content.split('\n')[0])).toEqual(['# Project Name', '## Installation', '## Usage']);
    expect(chunks.map((c) => c.start_line)).toEqual([2, 6, 12]);
    expect(chunks.every((c) => c.content_type === 'docs')).toBe(true);
  });

  it('should skip large files', async () => {
    const filePath = join(TEST_DIR, 'large.ts');
    // Create a file larger than MAX_FILE_SIZE (750KB)
    const content = 'a'.repeat(800 * 1024);
    writeFileSync(filePath, content);

    const warnings: string[] = [];

    const fileInfo: FileInfo = {
      path: filePath,
      relativePath: 'large.ts',
      extension: 'ts',
      language: 'typescript',
      type: 'code',
      size: Buffer.byteLength(content),
      modifiedAt: new Date().toISOString(),
    };

    const chunks = await chunkFile(fileInfo, {}, {
      onWarning: (msg) => warnings.push(msg),
    });

    expect(chunks.length).toBe(0);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('File too large');
  });

  it('should preserve line numbers through chunking', async () => {
    const filePath = join(TEST_DIR, 'lines.ts');
    const content = `// Line 1
// Line 2
// Line 3
function test() {
  // Line 5
  return true;
}
`;
    writeFileSync(filePath, content);

    const fileInfo: FileInfo = {
      path: filePath,
      relativePath: 'lines.ts',
      extension: 'ts',
      language: 'typescript',
      type: 'code',
      size: Buffer.byteLength(content),
      modifiedAt: new Date().toISOString(),
    };

    const chunks = await chunkFile(fileInfo);

    // All chunks should have valid line numbers
    for (const chunk of chunks) {
      expect(chunk.start_line).toBeGreaterThan(0);
      expect(chunk.end_line).toBeGreaterThanOrEqual(chunk.start_line);
    }
  });
  it('a short segment is still a chunk, so no line goes unindexed', async () => {
    // `x = 1` is 5 characters; segments under 10 used to be dropped
    const content = 'x = 1\n\n\ndef f():\n    return 2\n';
    const filePath = join(TEST_DIR, 'short.py');
    writeFileSync(filePath, content);

    const chunks = await chunkFile({
      path: filePath,
      relativePath: 'short.py',
      extension: 'py',
      language: 'python',
      type: 'code',
      size: Buffer.byteLength(content),
      modifiedAt: new Date().toISOString(),
    });

    expect(chunks.map((c) => c.content)).toEqual(['x = 1', 'def f():\n    return 2']);
  });
});

describe('line numbers for repeated text', () => {
  it('numbers the second copy of a repeated block by its own lines', async () => {
    // Each chunk used to be searched for from the top, so the second copy got the first's lines.
    const block = Array.from({ length: 120 }, (_, i) => `Line ${i} of a block that the document repeats.`).join('\n');
    const content = `${block}\n${block}`;
    const filePath = join(TEST_DIR, 'repeated.md');
    writeFileSync(filePath, content);

    const chunks = await chunkFile({
      path: filePath,
      relativePath: 'repeated.md',
      extension: 'md',
      language: 'markdown',
      type: 'docs',
      size: Buffer.byteLength(content),
      modifiedAt: new Date().toISOString(),
    });

    const lines = content.split('\n');
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.at(-1)!.end_line).toBe(lines.length);
    for (const [i, chunk] of chunks.entries()) {
      expect(lines[chunk.start_line - 1]).toContain(chunk.content.split('\n')[0]);
      if (i > 0) expect(chunk.start_line).toBeGreaterThanOrEqual(chunks[i - 1]!.start_line);
    }
  });
});

describe('semantic chunking failures', () => {
  it('splits by size and warns when the embedding provider fails, instead of aborting', async () => {
    // A docs section over the 1024-token docs chunk size goes to the semantic chunker.
    const content = `# Guide\n\n${Array.from({ length: 120 }, (_, i) => `Sentence ${i} explains one more part of the guide.`).join(' ')}\n`;
    const filePath = join(TEST_DIR, 'guide.md');
    writeFileSync(filePath, content);
    const failing = {
      name: 'down', dimensions: 4, maxBatchSize: 32,
      embed: async () => { throw new Error('connect ECONNREFUSED'); },
      embedBatch: async () => { throw new Error('connect ECONNREFUSED'); },
      isAvailable: async () => false,
    };
    const warnings: string[] = [];

    const chunks = await chunkFile(
      { path: filePath, relativePath: 'guide.md', extension: 'md', language: 'markdown', type: 'docs', size: content.length, modifiedAt: new Date().toISOString() },
      { embeddingProvider: failing },
      { onWarning: (w) => warnings.push(w) }
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.content).join('')).toContain('Sentence 119');
    expect(warnings).toEqual([expect.stringContaining('Semantic chunking failed at line 1 (')]);
  });
});
