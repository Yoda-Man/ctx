/**
 * Word and PDF specs become Markdown before indexing. spec.docx is laid out as
 * Word saves it (Heading 1/2 styles, a table); spec.pdf was printed by macOS
 * cupsfilter, which wraps lines at the page width.
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isConvertedDocument, readAsText } from '../documents.js';
import { chunkFile } from '../chunker/index.js';
import { getLanguageForExtension, getTypeForLanguage } from '../types.js';

const fixture = (name: string) => join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', name);

describe('readAsText', () => {
  it('turns a Word file into Markdown, headings and tables included', async () => {
    const md = await readAsText(fixture('spec.docx'));

    expect(md).toContain('# Refunds Specification');
    expect(md).toContain('## Approval');
    expect(md).toContain('Refunds above 500 rand require approval from a finance manager.');
    expect(md).toContain('| Amount | Approver |\n| --- | --- |');
    expect(md).toContain('| Above 500 rand | Finance manager |');
  });

  it('extracts the text of a PDF', async () => {
    const md = await readAsText(fixture('spec.pdf'));

    expect(md).toContain('Refunds Specification');
    expect(md).toContain('within 5 business\ndays');
  });

  it('reads any other file as UTF-8 text, unchanged', async () => {
    const text = await readAsText(fileURLToPath(import.meta.url));
    expect(text).toContain("describe('readAsText'");
  });

  it('knows which files it converts', () => {
    expect(isConvertedDocument('a/Spec.DOCX')).toBe(true);
    expect(isConvertedDocument('a/spec.pdf')).toBe(true);
    expect(isConvertedDocument('a/spec.md')).toBe(false);
  });
});

describe('indexing a Word spec', () => {
  it('is chunked as documentation', async () => {
    const path = fixture('spec.docx');
    expect(getTypeForLanguage(getLanguageForExtension('docx'))).toBe('docs');
    expect(getTypeForLanguage(getLanguageForExtension('pdf'))).toBe('docs');

    const chunks = await chunkFile({
      path,
      relativePath: 'spec.docx',
      extension: 'docx',
      language: 'markdown',
      type: 'docs',
      size: 1721,
      modifiedAt: new Date().toISOString(),
    });

    expect(chunks.map((c) => c.content).join('\n')).toContain('finance manager');
  });
});
