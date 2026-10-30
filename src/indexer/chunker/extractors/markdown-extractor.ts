/**
 * Markdown Extractor
 *
 * Splits a document into sections: each heading with everything under it,
 * up to the next heading, as one 'docs' segment of the file's own lines.
 * The heading stays with its text (a table is found by its title), every
 * line lands in exactly one segment, and the marked lexer finds the headings
 * so a `#` line inside a code fence is not mistaken for one.
 */

import { marked } from 'marked';

import type { ExtractedSegment, ExtractionResult } from '../types.js';

/**
 * Extract segments from markdown content.
 *
 * @param content - The markdown content
 * @returns Extraction result with segments and original content
 */
export function extractMarkdownSegments(content: string): ExtractionResult {
  const text = content.replace(/\r\n?/g, '\n'); // marked does the same
  const lines = text.split('\n');
  const tokens = marked.lexer(text);

  // Row and title of each heading. The tokens' raw text rebuilds the document
  // exactly; if it ever doesn't, positions can't be trusted: one segment.
  const headings: Array<{ row: number; title: string }> = [];
  let row = 0;
  let length = 0;
  for (const token of tokens) {
    if (token.type === 'heading') headings.push({ row, title: token.text });
    row += token.raw.split('\n').length - 1;
    length += token.raw.length;
  }
  const starts = length === text.length ? headings : [];

  // Section boundaries: the preface (if any), then one per heading
  const sections: Array<{ start: number; title?: string }> = [];
  if (starts[0]?.row !== 0) sections.push({ start: 0 });
  for (const heading of starts) sections.push({ start: heading.row, title: heading.title });

  const segments: ExtractedSegment[] = [];
  let pendingStart: number | null = null; // start of a section merged into the next
  sections.forEach((section, i) => {
    const start = pendingStart ?? section.start;
    let end = (sections[i + 1]?.start ?? lines.length) - 1;
    while (end >= start && !lines[end]!.trim()) end--;
    if (end < start) return;

    // A heading with nothing under it, or a preface too short to index (the
    // `---` that opens front matter), joins the next section
    const isLast = i === sections.length - 1;
    const tooShort = section.title === undefined && lines.slice(start, end + 1).join('\n').trim().length < 10;
    if ((tooShort || (section.title !== undefined && end === section.start)) && !isLast) {
      pendingStart = start;
      return;
    }
    pendingStart = null;

    // Skip leading blank lines of a preface
    let first = start;
    while (first < end && !lines[first]!.trim()) first++;
    segments.push({
      content: lines.slice(first, end + 1).join('\n'),
      contentType: 'docs',
      startLine: first + 1,
      endLine: end + 1,
      metadata: { sectionHeader: section.title },
    });
  });

  return { segments, originalContent: content };
}

/**
 * Check if content is markdown based on extension or content.
 */
export function isMarkdown(extension: string): boolean {
  const mdExtensions = new Set(['md', 'mdx', 'markdown']);
  return mdExtensions.has(extension.toLowerCase());
}
