import { describe, expect, it } from 'vitest';
import { DRIVE_API, SHEETS_API } from './client';
import { FakeGoogle, fakeClient } from './fake-google';

async function blankSheet() {
  const fake = new FakeGoogle();
  const client = fakeClient(fake);
  const { id } = await client.post<{ id: string }>(DRIVE_API, { name: 'x', mimeType: 'application/vnd.google-apps.spreadsheet' });
  return { fake, client, id };
}

describe('FakeGoogle fidelity', () => {
  it('applies a :batchUpdate all or nothing', async () => {
    const { fake, client, id } = await blankSheet();
    const before = structuredClone(fake.spreadsheet(id));
    await expect(client.post(`${SHEETS_API}/${id}:batchUpdate`, {
      requests: [
        { addSheet: { properties: { sheetId: 5, title: 'New', index: 1 } } },
        { setDataValidation: { range: { sheetId: 0 } } },
        { bogusRequest: {} },
      ],
    })).rejects.toMatchObject({ kind: 'bad_request' });
    expect(fake.spreadsheet(id)).toEqual(before);
  });

  it('rejects values that extend past an explicit range, writing nothing', async () => {
    const { fake, client, id } = await blankSheet();
    const write = (data: Array<{ range: string; values: unknown[][] }>) =>
      client.post(`${SHEETS_API}/${id}/values:batchUpdate`, { valueInputOption: 'RAW', data });
    await expect(write([{ range: "'Sheet1'!A1", values: [['a']] }, { range: "'Sheet1'!C5", values: [['a', 'b']] }])).rejects.toMatchObject({ kind: 'bad_request' });
    await expect(write([{ range: "'Sheet1'!A5:C5", values: [['a', 'b', 'c', 'd']] }])).rejects.toMatchObject({ kind: 'bad_request' });
    await expect(write([{ range: "'Sheet1'!A5:C5", values: [['a'], ['b']] }])).rejects.toMatchObject({ kind: 'bad_request' });
    expect(fake.getWorkbook(id).Sheet1).toEqual([]);
    await write([{ range: "'Sheet1'!A5:C5", values: [['a', 'b', 'c']] }, { range: "'Sheet1'", values: [['x', 'y'], ['z']] }]);
    expect(fake.getWorkbook(id).Sheet1![0]).toEqual(['x', 'y']);
  });

  it('still serves a trashed spreadsheet, as Google does', async () => {
    const { fake, client, id } = await blankSheet();
    await client.patch(`${DRIVE_API}/${id}`, { trashed: true });
    expect(fake.spreadsheet(id)?.trashed).toBe(true);
    await expect(client.get(`${SHEETS_API}/${id}`)).resolves.toMatchObject({ sheets: [{ properties: { title: 'Sheet1' } }] });
  });

  it('refuses formatting, dropdowns and protection past a tab’s columns (26 unless made wider), changing nothing', async () => {
    const { fake, client, id } = await blankSheet();
    const before = structuredClone(fake.spreadsheet(id));
    const width = (sheetId: number, col: number) => ({
      updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: col, endIndex: col + 1 }, properties: { pixelSize: 100 }, fields: 'pixelSize' },
    });
    const batch = (requests: unknown[]) => client.post(`${SHEETS_API}/${id}:batchUpdate`, { requests });
    for (const request of [
      width(0, 26),
      { setDataValidation: { range: { sheetId: 0, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 26, endColumnIndex: 27 } } },
      { addProtectedRange: { protectedRange: { range: { sheetId: 0, startColumnIndex: 25, endColumnIndex: 27 }, warningOnly: true } } },
      { repeatCell: { range: { sheetId: 0, startColumnIndex: 26, endColumnIndex: 27 } } },
      width(7, 0),
    ]) {
      await expect(batch([request])).rejects.toMatchObject({ kind: 'bad_request' });
    }
    expect(fake.spreadsheet(id)).toEqual(before);
    await batch([width(0, 25), { addSheet: { properties: { sheetId: 5, title: 'Wide', index: 1, gridProperties: { columnCount: 28 } } } }, width(5, 27)]);
    expect(fake.spreadsheet(id)!.sheets.map((s) => s.columnCount)).toEqual([26, 28]);
  });

  it('holds 1000 rows per tab unless grown, refusing writes, reads and dropdowns past them, as Google does', async () => {
    const { fake, client, id } = await blankSheet();
    const write = (range: string) => client.post(`${SHEETS_API}/${id}/values:batchUpdate`, { valueInputOption: 'RAW', data: [{ range, values: [['x']] }] });
    const read = (range: string) => client.get(`${SHEETS_API}/${id}/values:batchGet?ranges=${encodeURIComponent(range)}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
    const batch = (requests: unknown[]) => client.post(`${SHEETS_API}/${id}:batchUpdate`, { requests });
    const dropdown = (row: number) => ({ setDataValidation: { range: { sheetId: 0, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: 1 } } });

    await expect(client.get(`${SHEETS_API}/${id}`)).resolves.toMatchObject({ sheets: [{ properties: { gridProperties: { rowCount: 1000, columnCount: 26 } } }] });
    await write("'Sheet1'!A1000");
    await expect(write("'Sheet1'!A1001")).rejects.toMatchObject({ kind: 'bad_request' });
    await expect(read("'Sheet1'!A1001:B1001")).rejects.toMatchObject({ kind: 'bad_request' });
    await expect(batch([dropdown(1000)])).rejects.toMatchObject({ kind: 'bad_request' });

    await batch([{ appendDimension: { sheetId: 0, dimension: 'ROWS', length: 500 } }, dropdown(1000)]);
    expect(fake.spreadsheet(id)!.sheets[0]!.rowCount).toBe(1500);
    await write("'Sheet1'!A1001");
    expect(fake.getWorkbook(id).Sheet1![1000]).toEqual(['x']);
    await batch([{ deleteDimension: { range: { sheetId: 0, dimension: 'ROWS', startIndex: 0, endIndex: 1 } } }]);
    expect(fake.spreadsheet(id)!.sheets[0]!.rowCount).toBe(1499);
  });

  it('clears a whole tab with updateCells, merges within the grid, and renames a file', async () => {
    const { fake, client, id } = await blankSheet();
    await client.post(`${SHEETS_API}/${id}/values:batchUpdate`, { valueInputOption: 'RAW', data: [{ range: "'Sheet1'", values: [['a', 'b'], ['c']] }] });
    await client.post(`${SHEETS_API}/${id}:batchUpdate`, {
      requests: [
        { updateCells: { range: { sheetId: 0 }, fields: 'userEnteredValue,userEnteredFormat' } },
        { unmergeCells: { range: { sheetId: 0 } } },
        { mergeCells: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } },
      ],
    });
    expect(fake.getWorkbook(id).Sheet1!.flat().every((cell) => cell === null)).toBe(true);
    await expect(client.post(`${SHEETS_API}/${id}:batchUpdate`, {
      requests: [{ mergeCells: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 27 } } }],
    })).rejects.toMatchObject({ kind: 'bad_request' });
    await client.patch(`${DRIVE_API}/${id}`, { name: 'Renamed' });
    expect(fake.spreadsheet(id)!.name).toBe('Renamed');
  });
});
