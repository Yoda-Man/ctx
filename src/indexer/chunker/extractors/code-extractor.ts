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
 * Supports: TypeScript, JavaScript, Python, Go, Rust, Java, C#. In Java and
 * C#, where almost all code sits inside a class or namespace, the extractor
 * steps inside: each method is a segment, labelled with its class.
 * Other languages are split by size.
 */

import Parser from 'tree-sitter';
import TypeScriptLang from 'tree-sitter-typescript';
import JavaScriptLang from 'tree-sitter-javascript';
import PythonLang from 'tree-sitter-python';
import GoLang from 'tree-sitter-go';
import RustLang from 'tree-sitter-rust';
import JavaLang from 'tree-sitter-java';
// The package's "main" lacks a file extension, which Node warns about on every
// import as an ES module; the file itself loads without the warning
import CSharpLang from 'tree-sitter-c-sharp/bindings/node/index.js';

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
  'java',
  'csharp',
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
    case 'java':
      return JavaLang as TreeSitterLanguage;
    case 'csharp':
      return CSharpLang as TreeSitterLanguage;
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
  const containerOf = CONTAINERS[language as keyof typeof CONTAINERS];
  const items = [...walk(tree.rootNode.namedChildren, definitionOf, containerOf)];

  return { segments: splitItems(items, content.split('\n')), originalContent: content };
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

/** Java and C# members that become their own segment; fields stay grouped. */
const MEMBER_TYPES = new Set([
  'method_declaration',
  'constructor_declaration',
  'compact_constructor_declaration', // Java records
  'destructor_declaration',
  'operator_declaration',
  'conversion_operator_declaration',
  'property_declaration',
  'indexer_declaration',
  'event_declaration',
]);

/** A Java or C# member: a method, constructor, property or the like. */
function memberDefinition(node: Parser.SyntaxNode): Definition | null {
  if (!MEMBER_TYPES.has(node.type)) return null;
  return { symbolName: node.childForFieldName('name')?.text, symbolType: 'method' };
}

/** Bodies of Java types, whose members are split one by one. */
const JAVA_BODIES = new Set(['class_body', 'interface_body', 'enum_body', 'annotation_type_body']);
/** Bodies of C# types and namespaces. */
const CSHARP_BODIES = new Set(['declaration_list', 'enum_member_declaration_list']);

/**
 * A class, interface, enum, record or namespace whose members are split one
 * by one: its body node and name, or null for anything else.
 */
type ContainerOf = (node: Parser.SyntaxNode) => { body: Parser.SyntaxNode; name?: string } | null;

const containerWith = (bodies: Set<string>): ContainerOf => (node) => {
  const body = node.childForFieldName('body') ?? node.namedChildren.find((child) => bodies.has(child.type));
  if (!body || !bodies.has(body.type)) return null;
  return { body, name: node.childForFieldName('name')?.text };
};

const DEFINITIONS = {
  python: pythonDefinition,
  go: goDefinition,
  rust: rustDefinition,
  java: memberDefinition,
  csharp: memberDefinition,
};

const CONTAINERS: Partial<Record<Language, ContainerOf>> = {
  java: containerWith(JAVA_BODIES),
  csharp: containerWith(CSHARP_BODIES),
};

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
 * A run of rows to place: a comment (it joins the definition right below
 * it), plain code (grouped with its neighbours), a definition (a segment of
 * its own), or the closing rows of a class or namespace (they join the
 * segment before them, so a lone `}` is never a segment).
 */
interface Item {
  start: number;
  end: number;
  kind: 'comment' | 'code' | 'definition' | 'closing';
  definition?: Definition;
  /** The class or namespace the item is inside, if any */
  parent?: string;
}

/**
 * Turn nodes into items in file order. A container (Java/C# class or
 * namespace) becomes its header rows, then its members, then its closing
 * rows; everything else is one item.
 */
function* walk(
  nodes: Parser.SyntaxNode[],
  definitionOf: (node: Parser.SyntaxNode) => Definition | null,
  containerOf: ContainerOf | undefined,
  parent?: string
): Generator<Item> {
  for (const node of nodes) {
    const start = node.startPosition.row;
    const end = lastRow(node);
    if (LEADING_TYPES.has(node.type)) {
      yield { start, end, kind: 'comment', parent };
      continue;
    }
    const container = containerOf?.(node);
    const members = container?.body.namedChildren ?? [];
    if (container && members.length > 0) {
      const first = members[0]!;
      const last = members[members.length - 1]!;
      yield { start, end: first.startPosition.row - 1, kind: 'code', parent: container.name ?? parent };
      yield* walk(members, definitionOf, containerOf, container.name ?? parent);
      yield { start: lastRow(last) + 1, end, kind: 'closing', parent: container.name ?? parent };
      continue;
    }
    const definition = definitionOf(node) ?? (container ? { symbolName: container.name, symbolType: 'class' as const } : null);
    yield definition ? { start, end, kind: 'definition', definition, parent } : { start, end, kind: 'code', parent };
  }
}

/**
 * Place items in order: a definition becomes its own segment, taking the
 * comments directly above it (no blank line between); everything else is
 * grouped with its neighbours. Segments are whole lines, and every line of
 * the file lands in exactly one.
 */
function splitItems(items: Item[], lines: string[]): ExtractedSegment[] {
  const segments: ExtractedSegment[] = [];
  const segment = (start: number, end: number, metadata: ExtractedSegment['metadata']): ExtractedSegment => ({
    content: lines.slice(start, end + 1).join('\n'),
    contentType: 'code',
    startLine: start + 1,
    endLine: end + 1,
    metadata,
  });

  let run: { start: number; end: number; parent?: string } | null = null; // rows of grouped code
  let comments: Item[] = []; // comments not yet placed
  let placed = -1; // last row in a segment or the run: a trailing comment shares its row
  const addToRun = (item: Item) => {
    if (item.end <= placed || item.end < item.start) return;
    run = run ? { ...run, end: item.end } : { start: Math.max(item.start, placed + 1), end: item.end, parent: item.parent };
    placed = item.end;
  };
  const flushRun = () => {
    if (run) segments.push(segment(run.start, run.end, { symbolType: 'module', parentSymbol: run.parent }));
    run = null;
  };

  for (const item of items) {
    if (item.kind === 'comment') {
      comments.push(item);
      continue;
    }
    if (item.kind === 'closing') {
      for (const comment of comments) addToRun(comment);
      comments = [];
      const last = segments[segments.length - 1];
      if (!run && last && item.end > placed && last.endLine === placed + 1) {
        // Extend the segment just placed (a method) over the closing rows
        segments[segments.length - 1] = segment(last.startLine - 1, item.end, last.metadata);
        placed = item.end;
      } else {
        addToRun(item);
      }
      continue;
    }
    if (item.kind === 'code') {
      for (const comment of comments) addToRun(comment);
      comments = [];
      addToRun(item);
      continue;
    }

    // The comments touching the definition belong to it; earlier ones to the run
    let start = item.start;
    let attached = comments.length;
    while (attached > 0 && comments[attached - 1]!.end === start - 1) {
      attached--;
      start = comments[attached]!.start;
    }
    for (const comment of comments.slice(0, attached)) addToRun(comment);
    comments = [];
    flushRun();
    start = Math.max(start, placed + 1);
    if (item.end >= start) {
      segments.push(segment(start, item.end, { ...item.definition!, parentSymbol: item.parent }));
      placed = item.end;
    }
  }
  for (const comment of comments) addToRun(comment);
  flushRun();
  return segments;
}
