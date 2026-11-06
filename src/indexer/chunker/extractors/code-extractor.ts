/**
 * Code Extractor
 *
 * Uses tree-sitter to split a file at its top-level statements:
 * - each definition (function, class, interface, type), with its export
 *   keyword, decorators and the comments directly above it, is one segment;
 * - the statements between definitions (imports, constants, module code)
 *   are grouped into 'module' segments.
 * Every line of the file lands in exactly one segment.
 *
 * Supports: TypeScript, JavaScript, Python, Go, Rust. Other languages are
 * split by size.
 */

import Parser from 'tree-sitter';
import TypeScriptLang from 'tree-sitter-typescript';
import JavaScriptLang from 'tree-sitter-javascript';
import PythonLang from 'tree-sitter-python';
import GoLang from 'tree-sitter-go';
import RustLang from 'tree-sitter-rust';

import type { Language } from '../../types.js';
import type { ExtractedSegment, ExtractionResult } from '../types.js';

// tree-sitter's Language type (compiled parser) vs our Language type (string union)
type TreeSitterLanguage = Parameters<Parser['setLanguage']>[0];

/**
 * Supported languages for tree-sitter parsing.
 */
const SUPPORTED_LANGUAGES = new Set<Language>([
  'typescript',
  'javascript',
  'python',
  'go',
  'rust',
]);

/**
 * Language to tree-sitter parser mapping.
 */
function getParserLanguage(language: Language): TreeSitterLanguage | null {
  switch (language) {
    case 'typescript':
      return TypeScriptLang.typescript as TreeSitterLanguage;
    case 'javascript':
      return JavaScriptLang as TreeSitterLanguage;
    case 'python':
      return PythonLang as TreeSitterLanguage;
    case 'go':
      return GoLang as TreeSitterLanguage;
    case 'rust':
      return RustLang as TreeSitterLanguage;
    default:
      return null;
  }
}

/**
 * Check if a language is supported for AST extraction.
 */
export function isLanguageSupported(language: Language): boolean {
  return SUPPORTED_LANGUAGES.has(language);
}

/**
 * Extract segments from code using tree-sitter AST parsing.
 *
 * @param content - The source code content
 * @param language - The programming language
 * @returns Extraction result with segments and original content
 */
export function extractCodeSegments(
  content: string,
  language: Language
): ExtractionResult {
  const parserLang = getParserLanguage(language);

  // Other languages: the whole file, which the chunker splits by size
  if (!parserLang) {
    const segments: ExtractedSegment[] = content.trim()
      ? [{ content, contentType: 'code', startLine: 1, endLine: content.split('\n').length, metadata: { symbolType: 'module' } }]
      : [];
    return { segments, originalContent: content };
  }

  const parser = new Parser();
  parser.setLanguage(parserLang);
  const tree = parser.parse(content);
  const definitionOf = DEFINITIONS[language as keyof typeof DEFINITIONS] ?? jsDefinition;

  return { segments: splitTopLevel(tree.rootNode, content.split('\n'), definitionOf), originalContent: content };
}

type Definition = { symbolName?: string; symbolType: SymbolType };
type SymbolType = NonNullable<ExtractedSegment['metadata']['symbolType']>;

const JS_DEFINITION_TYPES: Record<string, SymbolType> = {
  function_declaration: 'function',
  generator_function_declaration: 'function',
  class_declaration: 'class',
  abstract_class_declaration: 'class',
  interface_declaration: 'interface',
  type_alias_declaration: 'type',
  enum_declaration: 'type',
};

/** A top-level JS/TS statement that defines a symbol, looking through `export`. */
function jsDefinition(node: Parser.SyntaxNode): Definition | null {
  if (node.type === 'export_statement') {
    const declaration = node.childForFieldName('declaration');
    return declaration ? jsDefinition(declaration) : null;
  }
  const symbolType = JS_DEFINITION_TYPES[node.type];
  if (symbolType) return { symbolName: node.childForFieldName('name')?.text, symbolType };
  // const name = () => ... / function () { ... }
  if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
    const declarator = node.namedChildren.find((child) => child.type === 'variable_declarator');
    const value = declarator?.childForFieldName('value');
    if (value?.type === 'arrow_function' || value?.type === 'function_expression' || value?.type === 'function') {
      return { symbolName: declarator?.childForFieldName('name')?.text, symbolType: 'function' };
    }
  }
  return null;
}

/** A top-level Python statement that defines a symbol, looking through decorators. */
function pythonDefinition(node: Parser.SyntaxNode): Definition | null {
  if (node.type === 'decorated_definition') {
    const definition = node.childForFieldName('definition');
    return definition ? pythonDefinition(definition) : null;
  }
  if (node.type === 'function_definition') return { symbolName: node.childForFieldName('name')?.text, symbolType: 'function' };
  if (node.type === 'class_definition') return { symbolName: node.childForFieldName('name')?.text, symbolType: 'class' };
  return null;
}

/** A top-level Go declaration: func, method or type. Consts and vars are module code. */
function goDefinition(node: Parser.SyntaxNode): Definition | null {
  if (node.type === 'function_declaration' || node.type === 'method_declaration') {
    return { symbolName: node.childForFieldName('name')?.text, symbolType: 'function' };
  }
  if (node.type === 'type_declaration') {
    const spec = node.namedChildren.find((child) => child.type === 'type_spec' || child.type === 'type_alias');
    return { symbolName: spec?.childForFieldName('name')?.text, symbolType: 'type' };
  }
  return null;
}

const RUST_DEFINITION_TYPES: Record<string, SymbolType> = {
  function_item: 'function',
  struct_item: 'type',
  enum_item: 'type',
  union_item: 'type',
  type_item: 'type',
  trait_item: 'interface',
  impl_item: 'class',
  mod_item: 'module',
  macro_definition: 'function',
};

/** A top-level Rust item. An impl is named by its type (impl Display for S: S). */
function rustDefinition(node: Parser.SyntaxNode): Definition | null {
  const symbolType = RUST_DEFINITION_TYPES[node.type];
  if (!symbolType) return null;
  const name = node.type === 'impl_item' ? node.childForFieldName('type') : node.childForFieldName('name');
  return { symbolName: name?.text, symbolType };
}

const DEFINITIONS = { python: pythonDefinition, go: goDefinition, rust: rustDefinition };

/**
 * Nodes that belong to the definition below them when they touch it:
 * comments (Rust: line_comment, block_comment) and Rust attributes (#[derive]).
 */
const LEADING_TYPES = new Set(['comment', 'line_comment', 'block_comment', 'attribute_item']);

/**
 * The last row a node's text is on. A node that ends at column 0 ends with
 * its newline (tree-sitter-rust's /// doc comments do): its text is on the
 * row before.
 */
function lastRow(node: Parser.SyntaxNode): number {
  const { row, column } = node.endPosition;
  return column === 0 && row > node.startPosition.row ? row - 1 : row;
}

/**
 * Walk the top-level statements in order: a definition becomes its own
 * segment, taking the comments directly above it (no blank line between);
 * everything else is grouped with its neighbours. Segments are whole lines.
 */
function splitTopLevel(
  root: Parser.SyntaxNode,
  lines: string[],
  definitionOf: (node: Parser.SyntaxNode) => Definition | null
): ExtractedSegment[] {
  const segments: ExtractedSegment[] = [];
  const segment = (start: number, end: number, metadata: ExtractedSegment['metadata']): ExtractedSegment => ({
    content: lines.slice(start, end + 1).join('\n'),
    contentType: 'code',
    startLine: start + 1,
    endLine: end + 1,
    metadata,
  });

  let run: { start: number; end: number } | null = null; // rows of grouped module statements
  let comments: Parser.SyntaxNode[] = []; // comments not yet placed
  let placed = -1; // last row in a segment or the run: a trailing comment shares its row
  const addToRun = (start: number, end: number) => {
    if (end <= placed) return;
    run = run ? { start: run.start, end } : { start: Math.max(start, placed + 1), end };
    placed = end;
  };
  const flushRun = () => {
    if (run) segments.push(segment(run.start, run.end, { symbolType: 'module' }));
    run = null;
  };

  for (const node of root.namedChildren) {
    if (LEADING_TYPES.has(node.type)) {
      comments.push(node);
      continue;
    }
    const definition = definitionOf(node);
    if (!definition) {
      for (const comment of comments) addToRun(comment.startPosition.row, lastRow(comment));
      comments = [];
      addToRun(node.startPosition.row, lastRow(node));
      continue;
    }

    // The comments touching the definition belong to it; earlier ones to the run
    let start = node.startPosition.row;
    let attached = comments.length;
    while (attached > 0 && lastRow(comments[attached - 1]!) === start - 1) {
      attached--;
      start = comments[attached]!.startPosition.row;
    }
    for (const comment of comments.slice(0, attached)) addToRun(comment.startPosition.row, lastRow(comment));
    comments = [];
    flushRun();
    start = Math.max(start, placed + 1);
    if (lastRow(node) >= start) {
      segments.push(segment(start, lastRow(node), definition));
      placed = lastRow(node);
    }
  }
  for (const comment of comments) addToRun(comment.startPosition.row, lastRow(comment));
  flushRun();
  return segments;
}
