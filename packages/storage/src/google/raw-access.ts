// Test support: the contract's hand edits on fake Google (hand-edits.ts holds the edits, for every store that keeps a
// workbook). Not production code.
import { workbookRawAccess, workbookSettingsRawAccess, type HandEditTarget } from '../hand-edits';
import type { WorkbookLayout } from '../sheet-codec/layouts';
import type { RawAccess, SettingsRawAccess } from '../types';
import type { FakeGoogle } from './fake-google';

/** Fake Google's spreadsheets as hand-edit targets: a rename changes the tab's title, as in Sheets. */
export function fakeGoogleTarget(fake: FakeGoogle): HandEditTarget {
  return {
    getWorkbook: async (fileId) => fake.getWorkbook(fileId),
    setWorkbook: async (fileId, wb) => fake.setWorkbook(fileId, wb),
    state: async (fileId) => fake.spreadsheet(fileId)?.sheets.map(({ title, rowCount, columnCount }) => ({ title, rowCount, columnCount })),
    renameTab: async (fileId, from, to) => {
      const sheet = fake.spreadsheet(fileId)?.sheets.find((s) => s.title === from);
      if (!sheet) throw new Error(`no tab ${from}`);
      sheet.title = to;
    },
  };
}

/** RawAccess on fake Google for one kind of workbook. Entity 'info' (id 'info') is the Market tab. */
export const googleRawAccess = <E extends string>(fake: FakeGoogle, layout: WorkbookLayout<E>): RawAccess =>
  workbookRawAccess(fakeGoogleTarget(fake), layout);

/** SettingsRawAccess on fake Google: hand edits on a Company facts or program file, by tab and header. */
export const googleSettingsRawAccess = (fake: FakeGoogle): SettingsRawAccess => workbookSettingsRawAccess(fakeGoogleTarget(fake));
