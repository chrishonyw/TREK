import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { extractItineraryText } from '../../../../src/nest/itinerary-import/itinerary-text';

describe('extractItineraryText', () => {
  it('reads an Excel plan row by row, keeping hyperlinks', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Day plan');
    sheet.addRow(['日期', '時間', '地點', '備註']);
    sheet.addRow(['2/3', '12:00', '二条市場', '海鮮丼']);
    sheet.getCell('C3').value = { text: 'GARAKU', hyperlink: 'https://tabelog.com/hokkaido/A0101/A010103/1003393/' };
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const text = await extractItineraryText(buffer, 'plan.xlsx');

    expect(text).toContain('## Day plan');
    expect(text).toContain('2/3 | 12:00 | 二条市場 | 海鮮丼');
    expect(text).toContain('GARAKU (https://tabelog.com/hokkaido/A0101/A010103/1003393/)');
  });

  it('passes plain text through', async () => {
    expect(await extractItineraryText(Buffer.from('  札幌: 大通公園  '), 'notes.txt')).toBe('札幌: 大通公園');
  });
});
