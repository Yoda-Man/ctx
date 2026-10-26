/**
 * Word and PDF documents are converted to Markdown before indexing, so specs
 * in either format are chunked, searched and cited like any Markdown file.
 * Conversion runs on this machine; nothing is uploaded.
 */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const CONVERTED = new Set(['.docx', '.pdf']);

/** Whether a file is converted to Markdown rather than read as text. */
export function isConvertedDocument(path: string): boolean {
  return CONVERTED.has(extname(path).toLowerCase());
}

/** Read a file as text: .docx and .pdf as Markdown, anything else as UTF-8. */
export async function readAsText(path: string): Promise<string> {
  const ext = extname(path).toLowerCase();
  if (ext === '.docx') return docxToMarkdown(path);
  if (ext === '.pdf') return pdfToMarkdown(path);
  return readFile(path, 'utf-8');
}

/** Word → HTML (mammoth) → Markdown (turndown): keeps headings, lists and tables. */
async function docxToMarkdown(path: string): Promise<string> {
  const { default: mammoth } = await import('mammoth');
  const { default: TurndownService } = await import('turndown');
  const { value: html } = await mammoth.convertToHtml({ path });

  const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
  // turndown has no table support; specs are full of tables, so render them as Markdown tables.
  turndown.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement: (content) => ` ${content.trim().replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|')} |`,
  });
  turndown.addRule('tableRow', { filter: 'tr', replacement: (content) => `\n|${content}` });
  turndown.addRule('table', {
    filter: 'table',
    replacement: (content) => {
      const rows = content.trim().split('\n');
      const columns = (rows[0]?.match(/(?<!\\)\|/g)?.length ?? 1) - 1;
      rows.splice(1, 0, `|${' --- |'.repeat(columns)}`);
      return `\n\n${rows.join('\n')}\n\n`;
    },
  });
  return turndown.turndown(html);
}

/** PDF → text, one paragraph block per page (PDFs carry no heading structure). */
async function pdfToMarkdown(path: string): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(path)));
  const { text } = await extractText(pdf, { mergePages: false });
  return text.map((page) => page.trim()).filter(Boolean).join('\n\n');
}
