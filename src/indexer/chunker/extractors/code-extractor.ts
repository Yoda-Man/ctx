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
 * Supports: TypeScript, JavaScript, Python (extensible to more languages)
 */

import Parser from 'tree-sitter';
import TypeScriptLang from 'tree-sitter-typescript';
import JavaScriptLang from 'tree-sitter-javascript';
import PythonLang from 'tree-sitter-python';

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
  const definitionOf = language === 'python' ? pythonDefinition : jsDefinition;

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
    if (node.type === 'comment') {
      comments.push(node);
      continue;
    }
    const definition = definitionOf(node);
    if (!definition) {
      for (const comment of comments) addToRun(comment.startPosition.row, comment.endPosition.row);
      comments = [];
      addToRun(node.startPosition.row, node.endPosition.row);
      continue;
    }

    // The comments touching the definition belong to it; earlier ones to the run
    let start = node.startPosition.row;
    let attached = comments.length;
    while (attached > 0 && comments[attached - 1]!.endPosition.row === start - 1) {
      attached--;
      start = comments[attached]!.startPosition.row;
    }
    for (const comment of comments.slice(0, attached)) addToRun(comment.startPosition.row, comment.endPosition.row);
    comments = [];
    flushRun();
    start = Math.max(start, placed + 1);
    if (node.endPosition.row >= start) {
      segments.push(segment(start, node.endPosition.row, definition));
      placed = node.endPosition.row;
    }
  }
  for (const comment of comments) addToRun(comment.startPosition.row, comment.endPosition.row);
  flushRun();
  return segments;
}
