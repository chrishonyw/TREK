import { extname } from 'node:path';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import { extractText } from '../llm-parse/text-extract';

/**
 * Plain text out of a traveller's planning document.
 *
 * Word goes through mammoth's Markdown conversion rather than its raw-text one:
 * planning notes lean on links (Tabelog pages, Google Maps short links), and the
 * raw text drops every href that is hidden behind a label. Excel is read row by
 * row with the cells joined by " | ", so a column layout (date | time | place |
 * notes) survives as something a model can still read as a table. Everything
 * else reuses the booking importer's extractor (PDF text layer, e-mail, HTML).
 */
export async function extractItineraryText(buffer: Buffer, fileName: string): Promise<string> {
  const ext = extname(fileName).toLowerCase();
  if (ext === '.docx') return docxText(buffer);
  if (ext === '.xlsx') return xlsxText(buffer);
  return extractText(buffer, fileName);
}

async function docxText(buffer: Buffer): Promise<string> {
  // convertToMarkdown is typed as deprecated upstream but is the only mode that
  // keeps hyperlink targets; images are dropped so the text is not flooded with
  // base64.
  const convert = (mammoth as unknown as {
    convertToMarkdown: (input: { buffer: Buffer }, options?: object) => Promise<{ value: string }>;
  }).convertToMarkdown;
  const result = await convert({ buffer }, { convertImage: mammoth.images.imgElement(async () => ({ src: '' })) });
  return result.value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/__/g, '')
    .replace(/\\([-.()[\]#*_!>+])/g, '$1')
    // A pasted link is its own label: "[url](url)" says it twice, and the model
    // pays for both.
    .replace(/\[([^\]\n]+)\]\(\1\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function xlsxText(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const out: string[] = [];
  workbook.eachSheet((sheet) => {
    out.push(`## ${sheet.name}`);
    sheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const text = cellText(cell);
        if (text) cells.push(text);
      });
      if (cells.length) out.push(cells.join(' | '));
    });
  });
  return out.join('\n').trim();
}

function cellText(cell: ExcelJS.Cell): string {
  const text = (cell.text ?? '').toString().replace(/\s+/g, ' ').trim();
  const link = cell.hyperlink;
  if (link && !text.includes(link)) return text ? `${text} (${link})` : link;
  return text;
}
