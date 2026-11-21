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
 * Supports: TypeScript (and TSX), JavaScript, Python, Go, Rust, Java, C#, C,
 * C++, PHP, Ruby, PowerShell, and, through WebAssembly parsers (see
 * wasm-grammars.ts), Dart, Kotlin and Swift. Where code sits inside classes,
 * namespaces or modules (Java, C#, C++, PHP, Ruby, PowerShell, Dart, Kotlin,
 * Swift), the extractor steps inside: each method is a segment, labelled
 * with its class. It also steps into C and C++ include guards, other
 * preprocessor blocks and `extern "C"` blocks. Other languages are split by
 * size.
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
import CLang from 'tree-sitter-c';
import CppLang from 'tree-sitter-cpp';
import PhpLang from 'tree-sitter-php';
import RubyLang from 'tree-sitter-ruby';
// An ES module with top-level await, imported by file like tree-sitter-c-sharp
import PowerShellLang from 'tree-sitter-powershell/bindings/node/index.js';

import { wasmParserFor } from './wasm-grammars.js';

import type { Language } from '../../types.js';
import type { ContentType, ExtractedSegment, ExtractionResult } from '../types.js';

// tree-sitter's Language type (compiled parser) vs our Language type (string union)
type TreeSitterLanguage = Parameters<Parser['setLanguage']>[0];

/**
 * A whole file as one segment, which the chunker splits by size: for files
 * with no parser, config files, and files whose parser failed.
 */
export function wholeFile(
  content: string,
  contentType: ContentType,
  metadata: ExtractedSegment['metadata'] = { symbolType: 'module' }
): ExtractedSegment {
  return { content, contentType, startLine: 1, endLine: content.split('\n').length, metadata };
}

/**
 * Language to tree-sitter parser mapping.
 */
function getParserLanguage(language: Language, extension?: string): TreeSitterLanguage | null {
  switch (language) {
    case 'typescript':
      // JSX in a .tsx file is a syntax error to the plain TypeScript grammar
      return (extension === 'tsx' ? TypeScriptLang.tsx : TypeScriptLang.typescript) as TreeSitterLanguage;
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
    case 'c':
      // A .h file may be C or C++; the C++ grammar reads both
      return (extension === 'h' ? CppLang : CLang) as TreeSitterLanguage;
    case 'cpp':
      return CppLang as TreeSitterLanguage;
    case 'php':
      return PhpLang.php as TreeSitterLanguage;
    case 'ruby':
      return RubyLang as TreeSitterLanguage;
    case 'powershell':
      return PowerShellLang as TreeSitterLanguage;
    default:
      return null;
  }
}

/**
 * Extract segments from code using tree-sitter AST parsing.
 *
 * Dart, Kotlin and Swift are parsed only once prepareLanguage() has loaded
 * their WebAssembly parser; until then they are split by size.
 *
 * @param content - The source code content
 * @param language - The programming language
 * @param extension - The file extension, which picks the grammar where one
 *   language has two (.tsx, .h)
 * @returns The file's segments
 */
export function extractCodeSegments(
  content: string,
  language: Language,
  extension?: string
): ExtractionResult {
  const parserLang = getParserLanguage(language, extension);
  const wasmParser = parserLang ? undefined : wasmParserFor(language);
  const definitionOf = DEFINITIONS[language] ?? jsDefinition;
  const containerOf = CONTAINERS[language];
  const itemsOf = (root: SyntaxNode) => [...walk(root.namedChildren, definitionOf, containerOf)];

  let items: Item[];
  if (parserLang) {
    const parser = new Parser();
    parser.setLanguage(parserLang);
    items = itemsOf(parser.parse(content).rootNode);
  } else {
    const tree = wasmParser?.parse(content);
    // Other languages: the whole file, which the chunker splits by size
    if (!tree) return { segments: content.trim() ? [wholeFile(content, 'code')] : [] };
    try {
      items = itemsOf(tree.rootNode);
    } finally {
      tree.delete(); // WebAssembly memory is not garbage-collected
    }
  }

  return { segments: splitItems(items, content.split('\n')) };
}

/** The node API both native tree-sitter and web-tree-sitter provide. */
interface SyntaxNode {
  readonly type: string;
  readonly text: string;
  readonly startPosition: { row: number; column: number };
  readonly endPosition: { row: number; column: number };
  readonly namedChildren: SyntaxNode[];
  childForFieldName(name: string): SyntaxNode | null;
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
function jsDefinition(node: SyntaxNode): Definition | null {
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
function pythonDefinition(node: SyntaxNode): Definition | null {
  if (node.type === 'decorated_definition') {
    const definition = node.childForFieldName('definition');
    return definition ? pythonDefinition(definition) : null;
  }
  if (node.type === 'function_definition') return { symbolName: node.childForFieldName('name')?.text, symbolType: 'function' };
  if (node.type === 'class_definition') return { symbolName: node.childForFieldName('name')?.text, symbolType: 'class' };
  return null;
}

/** A top-level Go declaration: func, method or type. Consts and vars are module code. */
function goDefinition(node: SyntaxNode): Definition | null {
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
function rustDefinition(node: SyntaxNode): Definition | null {
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
function memberDefinition(node: SyntaxNode): Definition | null {
  if (!MEMBER_TYPES.has(node.type)) return null;
  return { symbolName: node.childForFieldName('name')?.text, symbolType: 'method' };
}

/** Bodies of Java types, whose members are split one by one. */
const JAVA_BODIES = new Set(['class_body', 'interface_body', 'enum_body', 'annotation_type_body']);
/** Bodies of C# types and namespaces. */
const CSHARP_BODIES = new Set(['declaration_list', 'enum_member_declaration_list']);

/**
 * A class, interface, enum, record or namespace whose members are split one
 * by one: its body node and name, or null for anything else. `scope` says what
 * a function inside it is: a method (a type, the default), a function (a
 * namespace), or whatever it is outside (a block, such as #ifdef).
 */
type ContainerOf = (node: SyntaxNode) => { body: SyntaxNode; name?: string; scope?: 'namespace' | 'block' } | null;

const containerWith = (bodies: Set<string>, types?: Set<string>): ContainerOf => (node) => {
  // Where a function's body has the same node type as a class body, only the listed node types are containers
  if (types && !types.has(node.type)) return null;
  const body = node.childForFieldName('body') ?? node.namedChildren.find((child) => bodies.has(child.type));
  if (!body || !bodies.has(body.type)) return null;
  return { body, name: nameOf(node) };
};

/** Node types that hold a definition's name when it has no `name` field. */
const NAME_TYPES = new Set(['identifier', 'type_identifier', 'simple_identifier', 'simple_name', 'function_name', 'constant']);

function nameOf(node: SyntaxNode): string | undefined {
  const name = node.childForFieldName('name') ?? node.namedChildren.find((child) => NAME_TYPES.has(child.type));
  if (name) return name.text;
  // Dart: a method_signature holds a function_signature (or getter_signature...) that has the name
  const signature = node.namedChildren.find((child) => child.type.endsWith('_signature'));
  return signature ? nameOf(signature) : undefined;
}

/** A definition picked out by node type alone, named by nameOf. */
const byType = (types: Record<string, SymbolType>) => (node: SyntaxNode): Definition | null => {
  const symbolType = types[node.type];
  return symbolType ? { symbolName: nameOf(node), symbolType } : null;
};

/** The name at the end of a C/C++ declarator chain: int *f(void) → f, void A::m() → A::m. */
function declaratorName(node: SyntaxNode): string | undefined {
  let declarator = node.childForFieldName('declarator');
  while (declarator?.childForFieldName('declarator')) declarator = declarator.childForFieldName('declarator');
  return declarator?.text;
}

const C_TYPES = new Set(['struct_specifier', 'union_specifier', 'enum_specifier', 'class_specifier']);

/** A C/C++ function, or a struct, union, enum or class with a body (also inside a typedef). */
function cDefinition(node: SyntaxNode): Definition | null {
  if (node.type === 'function_definition') return { symbolName: declaratorName(node), symbolType: 'function' };
  if (node.type === 'template_declaration') {
    const inner = node.namedChildren.find((child) => child.type === 'function_definition' || C_TYPES.has(child.type));
    return inner ? cDefinition(inner) : null;
  }
  if (C_TYPES.has(node.type)) return node.childForFieldName('body') ? { symbolName: nameOf(node), symbolType: 'type' } : null;
  if (node.type === 'declaration' || node.type === 'type_definition') {
    const type = node.childForFieldName('type');
    if (!type || !C_TYPES.has(type.type) || !type.childForFieldName('body')) return null;
    const name = node.type === 'type_definition' ? declaratorName(node) : undefined;
    return { symbolName: name ?? nameOf(type), symbolType: 'type' };
  }
  return null;
}

const C_BODIES = new Set(['declaration_list', 'field_declaration_list']);
const CLASS_SPECIFIERS = new Set(['class_specifier', 'struct_specifier']);
/** Conditional blocks, include guards above all: their contents are split one by one. */
const PREPROCESSOR_BLOCKS = new Set(['preproc_ifdef', 'preproc_if', 'preproc_else', 'preproc_elif', 'preproc_elifdef']);
const hasMethods = (body: SyntaxNode) =>
  body.namedChildren.some((child) => child.type === 'function_definition' || child.type === 'template_declaration');

/**
 * C/C++ containers: namespaces, extern "C" blocks, preprocessor blocks, and
 * classes or structs that define methods, also inside a template or a
 * declaration (`struct S { ... } s;`). A struct of plain fields stays one
 * type segment.
 */
function cContainer(node: SyntaxNode): ReturnType<ContainerOf> {
  if (PREPROCESSOR_BLOCKS.has(node.type)) return { body: node, scope: 'block' };
  if (node.type === 'template_declaration' || node.type === 'declaration') {
    const inner =
      node.type === 'declaration'
        ? node.childForFieldName('type')
        : node.namedChildren.find((child) => CLASS_SPECIFIERS.has(child.type));
    return inner && CLASS_SPECIFIERS.has(inner.type) ? cContainer(inner) : null;
  }
  const body = node.childForFieldName('body');
  if (!body || !C_BODIES.has(body.type)) return null;
  if (node.type === 'namespace_definition') return { body, name: nameOf(node), scope: 'namespace' };
  if (node.type === 'linkage_specification') return { body, scope: 'namespace' };
  return hasMethods(body) ? { body, name: nameOf(node) } : null;
}

/** PowerShell: the script's statement list, and classes, whose members are their own children. */
const powershellContainer: ContainerOf = (node) => {
  if (node.type === 'statement_list') return { body: node, scope: 'block' };
  return node.type === 'class_statement' ? { body: node, name: nameOf(node) } : null;
};

const phpTypes = containerWith(
  new Set(['declaration_list', 'enum_declaration_list', 'compound_statement']),
  new Set(['class_declaration', 'interface_declaration', 'trait_declaration', 'enum_declaration', 'namespace_definition'])
);
/** PHP: classes, interfaces, traits and enums, and namespaces written with braces. */
const phpContainer: ContainerOf = (node) => {
  const container = phpTypes(node);
  return container && node.type === 'namespace_definition' ? { ...container, scope: 'namespace' } : container;
};

const DEFINITIONS: Partial<Record<Language, (node: SyntaxNode) => Definition | null>> = {
  python: pythonDefinition,
  go: goDefinition,
  rust: rustDefinition,
  java: memberDefinition,
  csharp: memberDefinition,
  c: cDefinition,
  cpp: cDefinition,
  php: byType({ function_definition: 'function', method_declaration: 'method' }),
  ruby: byType({ method: 'function', singleton_method: 'method' }),
  powershell: byType({ function_statement: 'function', class_method_definition: 'method', enum_statement: 'type' }),
  kotlin: byType({ function_declaration: 'function', secondary_constructor: 'method', type_alias: 'type' }),
  swift: byType({
    function_declaration: 'function',
    init_declaration: 'method',
    deinit_declaration: 'method',
    subscript_declaration: 'method',
    protocol_function_declaration: 'method',
    typealias_declaration: 'type',
  }),
  // A Dart function is its signature node followed by a function_body sibling (see walk)
  dart: byType({
    function_signature: 'function',
    getter_signature: 'function',
    setter_signature: 'function',
    method_signature: 'method',
    type_alias: 'type',
  }),
};

const CONTAINERS: Partial<Record<Language, ContainerOf>> = {
  java: containerWith(JAVA_BODIES),
  csharp: containerWith(CSHARP_BODIES),
  c: cContainer,
  cpp: cContainer,
  php: phpContainer,
  ruby: containerWith(new Set(['body_statement']), new Set(['class', 'module', 'singleton_class'])),
  powershell: powershellContainer,
  kotlin: containerWith(new Set(['class_body', 'enum_class_body'])),
  swift: containerWith(new Set(['class_body', 'enum_class_body', 'protocol_body'])),
  dart: containerWith(new Set(['class_body', 'extension_body', 'enum_body'])),
};

/**
 * Nodes that belong to the definition below them when they touch it:
 * comments (Rust: line_comment, block_comment; Dart: documentation_comment;
 * Kotlin and Swift: multiline_comment) and Rust attributes (#[derive]).
 */
const LEADING_TYPES = new Set([
  'comment',
  'line_comment',
  'block_comment',
  'documentation_comment',
  'multiline_comment',
  'attribute_item',
]);

/**
 * The last row a node's text is on. A node that ends at column 0 ends with
 * its newline (tree-sitter-rust's /// doc comments do): its text is on the
 * row before.
 */
function lastRow(node: SyntaxNode): number {
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
 * Turn nodes into items in file order. A container (see CONTAINERS: a class,
 * namespace, module, or a C preprocessor block) becomes its header rows, then
 * its members, then its closing rows; everything else is one item.
 */
function* walk(
  nodes: SyntaxNode[],
  definitionOf: (node: SyntaxNode) => Definition | null,
  containerOf: ContainerOf | undefined,
  parent?: string,
  inType = false
): Generator<Item> {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    const start = node.startPosition.row;
    let end = lastRow(node);
    if (LEADING_TYPES.has(node.type)) {
      yield { start, end, kind: 'comment', parent };
      continue;
    }
    const container = containerOf?.(node);
    const members = container?.body.namedChildren ?? [];
    if (container && members.length > 0) {
      const first = members[0]!;
      const last = members[members.length - 1]!;
      // A block with no header rows of its own (PowerShell's statement list) yields none, so
      // the comment above it joins its first member; a class header always takes it
      if (container.scope !== 'block' || first.startPosition.row > start) {
        yield { start, end: first.startPosition.row - 1, kind: 'code', parent: container.name ?? parent };
      }
      const membersInType = container.scope === 'block' ? inType : container.scope !== 'namespace';
      yield* walk(members, definitionOf, containerOf, container.name ?? parent, membersInType);
      yield { start: lastRow(last) + 1, end, kind: 'closing', parent: container.name ?? parent };
      continue;
    }
    let definition = definitionOf(node) ?? (container ? { symbolName: container.name, symbolType: 'class' as const } : null);
    // Dart: the body follows the signature as a sibling
    if (definition && nodes[index + 1]?.type === 'function_body') end = lastRow(nodes[++index]!);
    // A function inside a class is a method
    if (definition?.symbolType === 'function' && inType) definition = { ...definition, symbolType: 'method' };
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

  // Rows no named node covers (an unfinished `else {` at the end of a file, or
  // a token a parser's error recovery leaves unnamed) still get indexed
  const owned = lines.map(() => false);
  for (const s of segments) for (let row = s.startLine - 1; row < s.endLine; row++) owned[row] = true;
  const gaps: ExtractedSegment[] = [];
  for (let row = 0; row < lines.length; row++) {
    if (owned[row] || !lines[row]!.trim()) continue;
    let end = row;
    while (end + 1 < lines.length && !owned[end + 1]) end++;
    gaps.push(segment(row, end, { symbolType: 'module' }));
    row = end;
  }
  return gaps.length ? [...segments, ...gaps].sort((a, b) => a.startLine - b.startLine) : segments;
}
