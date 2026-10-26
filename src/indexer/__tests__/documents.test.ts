/**
 * Word and PDF specs become Markdown before indexing. spec.docx is laid out as
 * Word saves it (Heading 1/2 styles, numbered and bulleted lists, a table);
 * spec.pdf has two pages, printed by macOS cupsfilter, which wraps lines at
 * the page width.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isConvertedDocument, readAsText } from '../documents.js';
import { chunkFile } from '../chunker/index.js';
import { scanDirectory } from '../scanner.js';
import { getLanguageForExtension, getTypeForLanguage, type FileInfo } from '../types.js';

const FIXTURES = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');
const fixture = (name: string) => join(FIXTURES, name);
const scratch = mkdtempSync(join(tmpdir(), 'ctx-documents-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function info(path: string, size = statSync(path).size): FileInfo {
  const extension = path.split('.').pop()!;
  const language = getLanguageForExtension(extension);
  return { path, relativePath: path, extension, language, type: getTypeForLanguage(language), size, modifiedAt: new Date().toISOString() };
}

describe('readAsText', () => {
  it('turns a Word file into Markdown: headings, lists and tables', async () => {
    const md = await readAsText(fixture('spec.docx'));

    expect(md).toContain('# Refunds Specification');
    expect(md).toContain('## Approval');
    expect(md).toContain('Refunds above 500 rand require approval from a finance manager.');
    expect(md).toContain('| Amount | Approver |\n| --- | --- |');
    expect(md).toContain('| Above 500 rand | Finance manager |');
    expect(md).toContain('| Store credit \\| voucher | Automatic |'); // a | in a cell cannot break the table
    expect(md).toMatch(/^- +Requested within 30 days of delivery$/m);
    expect(md).toMatch(/^1\. +Check eligibility$/m);
    expect(md).toMatch(/^2\. +Approve or reject$/m);
  });

  it('extracts the text of a PDF, page by page', async () => {
    const md = await readAsText(fixture('spec.pdf'));

    expect(md).toContain('within 5 business\ndays.\n\nChargebacks\n'); // page 1 ends, page 2 begins
    expect(md).toContain('Chargebacks are handled by the bank');
  });

  it('reads any other file as UTF-8 text, unchanged', async () => {
    const text = await readAsText(fileURLToPath(import.meta.url));
    expect(text).toContain("describe('readAsText'");
  });

  it('rejects a damaged Word or PDF file rather than indexing garbage', async () => {
    for (const name of ['broken.docx', 'broken.pdf']) {
      writeFileSync(join(scratch, name), 'not really a document');
      await expect(readAsText(join(scratch, name))).rejects.toThrow();
    }
  });

  it('knows which files it converts', () => {
    expect(isConvertedDocument('a/Spec.DOCX')).toBe(true);
    expect(isConvertedDocument('a/spec.pdf')).toBe(true);
    expect(isConvertedDocument('a/spec.md')).toBe(false);
    expect(isConvertedDocument('a/old.doc')).toBe(false);
  });
});

describe('indexing Word and PDF specs', () => {
  it('finds them when scanning a folder, as documentation', async () => {
    const { files } = await scanDirectory(FIXTURES);
    const found = Object.fromEntries(files.map((f) => [f.relativePath, f.type]));

    expect(found).toMatchObject({ 'spec.docx': 'docs', 'spec.pdf': 'docs' });
  });

  it('chunks both, citing their content', async () => {
    const docx = await chunkFile(info(fixture('spec.docx')));
    const pdf = await chunkFile(info(fixture('spec.pdf')));

    expect(docx.map((c) => c.content).join('\n')).toContain('finance manager');
    expect(pdf.map((c) => c.content).join('\n')).toContain('handled by the bank');
  });

  it('judges size by the converted text, so a large file with little text is indexed', async () => {
    const chunks = await chunkFile(info(fixture('spec.docx'), 10 * 1024 * 1024)); // 10 MB of images and layout
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('reports a damaged file as an error and moves on', async () => {
    writeFileSync(join(scratch, 'damaged.pdf'), 'not really a document');
    const errors: string[] = [];

    const chunks = await chunkFile(info(join(scratch, 'damaged.pdf')), {}, { onError: (e) => errors.push(e.message) });

    expect(chunks).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});
