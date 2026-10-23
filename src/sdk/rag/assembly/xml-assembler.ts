/**
 * XML Context Assembler
 *
 * Formats chunks as XML for LLM consumption.
 * XML format is often preferred because:
 * - Clear structure for LLMs to parse
 * - Easy to reference sources by ID
 * - Unambiguous content boundaries
 *
 * Output format:
 * ```xml
 * <sources>
 *   <source id="1" file="docs/auth.md" line="42" score="0.95">
 *     Content of the first chunk...
 *   </source>
 *   ...
 * </sources>
 * ```
 */

import type { Chunk } from '../vector-store/types.js';
import type {
  XMLAssemblerConfig,
  AssemblyOptions,
  SourceAttribution,
} from './types.js';
import { BaseAssembler } from './base-assembler.js';

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Default XML assembler configuration.
 */
export const DEFAULT_XML_CONFIG: Required<
  Pick<
    XMLAssemblerConfig,
    'rootTag' | 'sourceTag' | 'includeFilePath' | 'includeLocation' | 'prettyPrint'
  >
> = {
  rootTag: 'sources',
  sourceTag: 'source',
  includeFilePath: true,
  includeLocation: true,
  prettyPrint: true,
};

// ============================================================================
// XML Assembler
// ============================================================================

/**
 * Assembler that outputs XML-formatted context.
 *
 * @example
 * ```typescript
 * const assembler = new XMLAssembler({
 *   ordering: 'sandwich',
 *   tokenBudget: { maxTokens: 4000 },
 *   includeScores: true,
 * });
 *
 * const result = await assembler.assemble(rerankedResults);
 * // <sources>
 * //   <source id="1" file="auth.md" score="0.95">...</source>
 * // </sources>
 * ```
 */
export class XMLAssembler extends BaseAssembler {
  readonly name: string;

  /** XML-specific configuration */
  private readonly xmlConfig: typeof DEFAULT_XML_CONFIG;

  constructor(config?: XMLAssemblerConfig) {
    super(config);
    this.name = config?.name ?? 'XMLAssembler';
    this.xmlConfig = {
      ...DEFAULT_XML_CONFIG,
      rootTag: config?.rootTag ?? DEFAULT_XML_CONFIG.rootTag,
      sourceTag: config?.sourceTag ?? DEFAULT_XML_CONFIG.sourceTag,
      includeFilePath: config?.includeFilePath ?? DEFAULT_XML_CONFIG.includeFilePath,
      includeLocation: config?.includeLocation ?? DEFAULT_XML_CONFIG.includeLocation,
      prettyPrint: config?.prettyPrint ?? DEFAULT_XML_CONFIG.prettyPrint,
    };
  }

  /**
   * Format chunks as XML.
   */
  protected _format = async (
    chunks: Chunk[],
    sources: SourceAttribution[],
    _options?: AssemblyOptions
  ): Promise<string> => {
    if (chunks.length === 0) {
      return this.xmlConfig.prettyPrint
        ? `<${this.xmlConfig.rootTag}>\n</${this.xmlConfig.rootTag}>`
        : `<${this.xmlConfig.rootTag}></${this.xmlConfig.rootTag}>`;
    }

    const indent = this.xmlConfig.prettyPrint ? '  ' : '';
    const newline = this.xmlConfig.prettyPrint ? '\n' : '';

    const sourceElements = chunks.map((chunk, index) => {
      const source = sources[index]!; // Sources are guaranteed to be 1:1 with chunks
      const attributes = this.buildAttributes(source);
      const content = escapeXml(chunk.content);

      return `${indent}<${this.xmlConfig.sourceTag}${attributes}>${newline}${indent}${indent}${content}${newline}${indent}</${this.xmlConfig.sourceTag}>`;
    });

    return [
      `<${this.xmlConfig.rootTag}>`,
      ...sourceElements,
      `</${this.xmlConfig.rootTag}>`,
    ].join(newline);
  };

  /**
   * Build XML attribute string for a source.
   */
  private buildAttributes(source: SourceAttribution): string {
    const attrs: string[] = [];

    // Always include ID
    attrs.push(`id="${source.index}"`);

    // Include file path if configured and available
    if (this.xmlConfig.includeFilePath && source.source) {
      attrs.push(`file="${escapeXmlAttribute(source.source)}"`);
    }

    // Include location if configured and available
    if (this.xmlConfig.includeLocation && source.location) {
      attrs.push(`location="${escapeXmlAttribute(source.location)}"`);
    }

    // Include section if available
    if (source.section) {
      attrs.push(`section="${escapeXmlAttribute(source.section)}"`);
    }

    // Include score if configured
    if (this.config.includeScores) {
      attrs.push(`score="${source.score.toFixed(3)}"`);
    }

    return attrs.length > 0 ? ' ' + attrs.join(' ') : '';
  }

  /**
   * XML formatting has more overhead than plain text.
   */
  protected override getFormattingOverhead(): number {
    // Account for tags, attributes, indentation
    // <source id="1" file="..." location="...">...</source>
    return 100;
  }
}

// ============================================================================
// XML Utilities
// ============================================================================

/**
 * Escape special characters for XML content.
 *
 * @param text - Text to escape
 * @returns Escaped text safe for XML content
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escape special characters for XML attribute values.
 *
 * @param text - Text to escape
 * @returns Escaped text safe for XML attributes
 */
export function escapeXmlAttribute(text: string): string {
  return escapeXml(text)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
