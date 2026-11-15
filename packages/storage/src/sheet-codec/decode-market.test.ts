// The decode cases for the market workbook.
import { describe, expect, it } from 'vitest';
import type { Market } from '@partner-desk/core';
import { sampleMarket } from '@partner-desk/core/test-builders';
import { decodeMarket, decodePartnerBook } from './decode';
import { encodeMarket } from './encode';
import type { Cell, Workbook } from './grid';
import { MARKET_LAYOUT } from './layouts';
import { asMarketVersion1, MARKET_META } from './test-fixtures';

const T = MARKET_LAYOUT.tabs;
const encoded = (market: Market = sampleMarket()) => encodeMarket(market, MARKET_META);

function decodeOk(wb: Workbook) {
  const result = decodeMarket(wb);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function decodeError(wb: Workbook) {
  const result = decodeMarket(wb);
  if (result.ok) throw new Error('expected a decode error');
  return result.error;
}

function setCell(wb: Workbook, tab: string, row: number, header: string, value: Cell) {
  const grid = wb[tab]!;
  const col = grid[0]!.indexOf(header);
  if (col === -1) throw new Error(`no column ${header}`);
  grid[row]![col] = value;
}

function setInfoValue(wb: Workbook, label: string, value: Cell) {
  const row = wb[T.info]!.find((r) => r[0] === label);
  if (!row) throw new Error(`no row ${label}`);
  row[1] = value;
}

function infoLabelTo(wb: Workbook, label: string, next: string) {
  const row = wb[T.info]!.find((r) => r[0] === label);
  if (!row) throw new Error(`no row ${label}`);
  row[0] = next;
}

describe('decodeMarket: structure', () => {
  it('round-trips the sample market without issues', () => {
    const decoded = decodeOk(encoded());
    expect(decoded.value).toEqual(sampleMarket());
    expect(decoded.issues).toEqual([]);
    expect(decoded.missingIds).toEqual([]);
    expect(decoded.unreadableInfo).toEqual(new Set());
  });

  it('records where each row, column and market field sits', () => {
    const decoded = decodeOk(encoded());
    expect(decoded.locations.get('v_2')).toEqual({ entity: 'valuePoint', tab: 'Value proposition', row: 3 });
    expect(decoded.columns.hypothesis.status).toBe(8);
    expect(decoded.infoRows).toMatchObject({ marketName: 2, feedsProgramId: 4, status: 13, updatedAt: 16, updatedBy: 17 });
  });

  it('takes the market and company ids from _meta', () => {
    const wb = encoded();
    wb['_meta']![2]![1] = 'm_other00001';
    wb['_meta']![3]![1] = 'co_other00001';
    expect(decodeOk(wb).value.info).toMatchObject({ marketId: 'm_other00001', companyId: 'co_other00001' });
  });

  it('refuses a file without a market id or company id in _meta', () => {
    for (const row of [2, 3]) {
      const wb = encoded();
      wb['_meta']![row]![1] = '';
      expect(decodeError(wb)).toEqual({ kind: 'not_ours', tab: '_meta', message: 'This file was not created with PartnerStandard Desk' });
    }
  });

  it('refuses a file saved by a newer schema version', () => {
    const wb = encoded();
    wb['_meta']![1]![1] = 3;
    expect(decodeError(wb)).toEqual({ kind: 'newer_version', tab: '_meta', message: 'This file was saved by a newer version of the app. Reload the page.' });
  });

  it('writes version 2, with the Feeds program row next to the partner type, and reads it back', () => {
    const feeding = sampleMarket();
    feeding.info.feedsProgramId = 'pg_dach0001';
    const wb = encoded(feeding);
    expect(wb['_meta']![1]).toEqual(['schemaVersion', 2]);
    expect(wb[T.info]!.slice(1, 4).map((r) => r[0])).toEqual(['Market', 'Partner type', 'Feeds program']);
    expect(wb[T.info]![3]).toEqual(['Feeds program', 'pg_dach0001', '']);
    const decoded = decodeOk(wb);
    expect(decoded.value).toEqual(feeding);
    expect(decoded.upgrade).toEqual([]);
  });

  it('reads a version 1 market as feeding no program, and says how the next save upgrades it', () => {
    const v1 = asMarketVersion1(encoded());
    const last = v1[T.info]!.length;
    const decoded = decodeOk(v1);
    expect(decoded.issues).toEqual([]);
    expect(decoded.value).toEqual(sampleMarket());
    expect(decoded.value.info.feedsProgramId).toBeNull();
    // The row goes below the last row in use.
    expect(decoded.infoRows.feedsProgramId).toBe(last + 1);
    expect(decoded.upgrade).toEqual([
      { tab: T.info, row: last + 1, col: 0, value: 'Feeds program', anchorCol: null },
      { tab: '_meta', row: 2, col: 1, value: 2, anchorCol: 0 },
    ]);
  });

  it('names a missing Feeds program row in a version 2 file, and still reads the market', () => {
    const wb = encoded();
    wb[T.info] = wb[T.info]!.filter((r) => r[0] !== 'Feeds program');
    const decoded = decodeOk(wb);
    expect(decoded.value.info.feedsProgramId).toBeNull();
    expect(decoded.issues).toEqual([{ tab: T.info, row: 0, message: 'The "Feeds program" row is missing' }]);
  });

  it('names a missing tab, the Market tab included', () => {
    const wb = encoded();
    delete wb[T.info];
    expect(decodeError(wb)).toEqual({ kind: 'missing_tab', tab: 'Market', message: 'The "Market" tab is missing' });
    const noChanges = encoded();
    delete noChanges[T.change];
    expect(decodeError(noChanges)).toEqual({ kind: 'missing_tab', tab: 'Changes', message: 'The "Changes" tab is missing' });
  });

  it('does not read one kind of workbook as the other', () => {
    expect(decodePartnerBook(encoded()).ok).toBe(false);
  });
});

describe('decodeMarket: rows', () => {
  it('turns an unknown kind into a row issue and leaves that row out', () => {
    const wb = encoded();
    setCell(wb, T.valuePoint, 1, 'Kind', 'Equity');
    const decoded = decodeOk(wb);
    expect(decoded.issues).toEqual([
      { tab: 'Value proposition', row: 2, message: 'Kind must be one of Margin or fees, Services revenue, Portfolio, Non-financial' },
    ]);
    expect(decoded.value.valuePoints.map((v) => v.id)).toEqual(['v_2']);
  });

  it('flags a hypothesis with too many value points', () => {
    const wb = encoded();
    setCell(wb, T.hypothesis, 1, 'Value points', 'v_1, v_2, v_3, v_4, v_5');
    expect(decodeOk(wb).issues).toEqual([{ tab: 'Partner hypotheses', row: 2, message: 'Value points: Pick up to 4 value points' }]);
  });

  it('reads a change about a value point and a blank call', () => {
    const wb = encoded();
    setCell(wb, T.change, 1, 'About', 'value point');
    setCell(wb, T.change, 1, 'Call', ' ');
    expect(decodeOk(wb).value.changes[0]).toMatchObject({ entity: 'value_point', callId: null });
  });

  it('keeps an exclusion with an unreadable Updated cell', () => {
    const wb = encoded();
    setCell(wb, T.exclusion, 1, 'Updated', 'last Tuesday');
    const decoded = decodeOk(wb);
    expect(decoded.value.exclusions).toEqual([{ ...sampleMarket().exclusions[0], updatedAt: null }]);
    expect(decoded.issues).toEqual([{ tab: 'Exclusions', row: 2, message: "Updated: couldn't read this timestamp; it will be reset on the next save" }]);
  });
});

describe('decodeMarket: Market tab', () => {
  it('reads rows by label in any order', () => {
    const wb = encoded();
    const [header, ...rows] = wb[T.info]!;
    wb[T.info] = [header!, ...rows.reverse()];
    expect(decodeOk(wb).value.info).toEqual(sampleMarket().info);
  });

  it('flags a bad value and keeps loading with a default', () => {
    const wb = encoded();
    setInfoValue(wb, 'Status', 'Done');
    setInfoValue(wb, 'Expected partners', 'a dozen');
    const decoded = decodeOk(wb);
    expect(decoded.value.info).toMatchObject({ status: 'open', expectedCandidates: null });
    expect(decoded.issues).toEqual([
      { tab: 'Market', row: 12, message: 'Expected partners must be a whole number or empty' },
      { tab: 'Market', row: 13, message: 'Status must be one of Open, Validated, Partly validated, Invalidated' },
    ]);
  });

  it('reads the row under its former label, Expected candidates', () => {
    const wb = encoded();
    infoLabelTo(wb, 'Expected partners', 'Expected candidates');
    const decoded = decodeOk(wb);
    expect(decoded.value.info.expectedCandidates).toBe(sampleMarket().info.expectedCandidates);
    expect(decoded.infoRows.expectedCandidates).toBe(12);
    expect(decoded.issues).toEqual([]);
  });

  it('refuses a partner type a market cannot have', () => {
    const wb = encoded();
    setInfoValue(wb, 'Partner type', 'Technology Partner');
    const decoded = decodeOk(wb);
    expect(decoded.value.info.partnerType).toBe('reseller');
    expect(decoded.unreadableInfo).toEqual(new Set(['partnerType']));
    expect(decoded.issues).toHaveLength(1);
    expect(decoded.issues[0]).toMatchObject({ tab: 'Market', row: 3 });
    expect(decoded.issues[0]!.message).toMatch(/^Partner type must be one of Referral Partner, Co-Seller, Reseller/);
  });

  it('lists the fields that hold a stand-in because the sheet value is unreadable or invalid', () => {
    const wb = encoded();
    setInfoValue(wb, 'Status', 'Done');
    setInfoValue(wb, 'Our product', '');
    setInfoValue(wb, 'Expected partners', -3);
    setInfoValue(wb, 'Updated', 'last Tuesday');
    wb[T.info] = wb[T.info]!.filter((row) => row[0] !== 'How the market buys');
    expect(decodeOk(wb).unreadableInfo).toEqual(new Set(['status', 'ourProduct', 'expectedCandidates', 'updatedAt']));
  });

  it('flags a missing row; missing Copied from, Updated and Updated by rows are fine', () => {
    const wb = encoded();
    wb[T.info] = wb[T.info]!.filter((row) => !['How the market buys', 'Copied from', 'Updated', 'Updated by'].includes(String(row[0])));
    const decoded = decodeOk(wb);
    expect(decoded.value.info).toMatchObject({ howMarketBuys: 'unknown', copiedFrom: null, updatedAt: null, updatedBy: 'Someone in the sheet' });
    expect(decoded.infoRows.updatedAt).toBeUndefined();
    expect(decoded.issues).toEqual([{ tab: 'Market', row: 0, message: 'The "How the market buys" row is missing' }]);
  });

  it('flags a required field left empty', () => {
    const wb = encoded();
    setInfoValue(wb, 'Our product', '');
    const decoded = decodeOk(wb);
    expect(decoded.value.info.ourProduct).toBe('');
    expect(decoded.issues).toEqual([{ tab: 'Market', row: 5, message: 'Our product is required' }]);
  });

  it('reads must-haves one per line, skipping empty lines', () => {
    const wb = encoded();
    setInfoValue(wb, 'Must-haves', ' Sells to SMBs \r\n\nHas a CFO network\n');
    expect(decodeOk(wb).value.info.mustHaves).toEqual(['Sells to SMBs', 'Has a CFO network']);
  });

  it('reads Check again flags in Market-tab order, and flags one it cannot read', () => {
    const wb = encoded();
    wb[T.info]!.find((row) => row[0] === 'Market')![2] = 'YES';
    wb[T.info]!.find((row) => row[0] === 'Statement')![2] = '';
    wb[T.info]!.find((row) => row[0] === 'Status')![2] = 'perhaps';
    const decoded = decodeOk(wb);
    expect(decoded.value.info.checkAgain).toEqual(['marketName', 'mustHaves']);
    expect(decoded.issues).toEqual([{ tab: 'Market', row: 13, message: 'Check again must be "yes" or empty' }]);
  });

  it('reads an Updated typed as a serial number, and never puts the cell into an issue', () => {
    const wb = encoded();
    setInfoValue(wb, 'Updated', 46316.25);
    setInfoValue(wb, 'Status', 'SECRET-1');
    const decoded = decodeOk(wb);
    expect(decoded.value.info.updatedAt).toBe('2026-10-21T06:00:00.000Z');
    expect(decoded.issues.map((i) => i.message).join(' ')).not.toContain('SECRET');
  });
});
