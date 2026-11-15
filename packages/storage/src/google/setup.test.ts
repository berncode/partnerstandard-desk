// The setup cases, for both workbooks.
import { describe, expect, it } from 'vitest';
import { sampleMarket, sampleBook } from '@partner-desk/core/test-builders';
import { SHEET_COPY } from '@partner-desk/copy';
import { encodeMarket, encodePartnerBook } from '../sheet-codec/encode';
import { labelsOf } from '../sheet-codec/labels';
import { MARKET_LAYOUT, PARTNERS_LAYOUT, type WorkbookLayout } from '../sheet-codec/layouts';
import { MARKET_META, PARTNERS_META } from '../sheet-codec/test-fixtures';
import { setupRequests, tabLayout, VALIDATED_ROWS } from './setup';

type Request = Record<string, Record<string, unknown>>;
type Validation = { range: Record<string, number>; rule: { strict: boolean; condition: { values: Array<{ userEnteredValue: string }> } } };
type Protection = { range: Record<string, number>; warningOnly: boolean; description: string };

const marketWb = encodeMarket(sampleMarket(), MARKET_META);
const workbooks = [
  { name: 'Partners', layout: PARTNERS_LAYOUT as WorkbookLayout<string>, wb: encodePartnerBook(sampleBook(), PARTNERS_META) },
  { name: 'market', layout: MARKET_LAYOUT as WorkbookLayout<string>, wb: marketWb },
];

function requestsFor(layout: WorkbookLayout<string>, wb: Parameters<typeof setupRequests>[1]) {
  const requests = setupRequests(layout, wb) as Request[];
  const ofKind = (kind: string) => requests.filter((r) => kind in r).map((r) => r[kind]!);
  const sheetIdOf = (title: string) => tabLayout(layout).find((t) => t.title === title)!.sheetId;
  const validations = ofKind('setDataValidation') as unknown as Validation[];
  const dropdownAt = (tab: string, col: number) => validations.find((v) => v.range.sheetId === sheetIdOf(tab) && v.range.startColumnIndex === col);
  return { requests, ofKind, sheetIdOf, validations, dropdownAt };
}
const choices = (v: Validation | undefined) => v?.rule.condition.values.map((x) => x.userEnteredValue);

describe.each(workbooks)('setupRequests: the $name workbook', ({ layout, wb }) => {
  const { requests, ofKind, sheetIdOf, validations, dropdownAt } = requestsFor(layout, wb);
  const tab = (key: string) => layout.tabs[key]!;

  it('lays out every tab in order, with _meta hidden and entity headers frozen', () => {
    expect(tabLayout(layout).map((t) => t.title)).toEqual(layout.tabOrder);
    expect(tabLayout(layout).find((t) => t.title === tab('meta'))).toMatchObject({ hidden: true, frozenRows: 0 });
    expect(tabLayout(layout).find((t) => t.title === tab('start'))).toMatchObject({ hidden: false, frozenRows: 0 });
    for (const entity of layout.entityOrder) expect(tabLayout(layout).find((t) => t.title === tab(entity))).toMatchObject({ frozenRows: 1, hidden: false });
    expect(ofKind('updateSheetProperties')[0]).toMatchObject({ properties: { sheetId: 0, title: tab('start'), index: 0 } });
    expect(ofKind('addSheet').map((a) => (a.properties as { title: string }).title)).toEqual(layout.tabOrder.slice(1));
  });

  it('makes each tab wide enough for its columns, and never narrower than Google’s 26', () => {
    const columnCounts = Object.fromEntries(ofKind('addSheet').map((a) => {
      const props = a.properties as { title: string; gridProperties: { columnCount: number } };
      return [props.title, props.gridProperties.columnCount];
    }));
    for (const entity of layout.entityOrder) expect(columnCounts[tab(entity)]).toBe(Math.max(26, layout.columns[entity]!.length));
    expect(columnCounts[tab('meta')]).toBe(26);
    // Every column-ranged request stays inside its tab's grid.
    const widthOf = new Map(tabLayout(layout).map((t) => [t.sheetId, t.columnCount]));
    for (const request of requests) {
      const [args] = Object.values(request) as Array<{ range?: Record<string, unknown>; protectedRange?: { range: Record<string, number> } }>;
      const range = (args!.protectedRange?.range ?? args!.range) as { sheetId: number; endColumnIndex?: number; endIndex?: number; dimension?: string } | undefined;
      if (!range) continue;
      const end = range.dimension === 'COLUMNS' ? range.endIndex : range.endColumnIndex;
      expect(end ?? 0).toBeLessThanOrEqual(widthOf.get(range.sheetId)!);
    }
  });

  it('adds a strict dropdown with the app’s labels to every list column, and 0 to 3 to every score column', () => {
    for (const entity of layout.entityOrder) {
      layout.columns[entity]!.forEach((col, index) => {
        const v = dropdownAt(tab(entity), index);
        if (col.kind === 'enum') expect(choices(v)).toEqual(labelsOf(col.enumName!));
        else if (col.kind === 'score') expect(choices(v)).toEqual(['0', '1', '2', '3']);
        else expect(v).toBeUndefined();
        if (v) expect(v).toMatchObject({ range: { startRowIndex: 1, endRowIndex: VALIDATED_ROWS }, rule: { strict: true } });
      });
    }
    expect(validations.every((v) => v.rule.strict)).toBe(true);
  });

  it('warns before edits to ID columns, header rows and the _meta tab', () => {
    const protections = ofKind('addProtectedRange').map((p) => p.protectedRange as Protection);
    expect(protections.every((p) => p.warningOnly && p.description === SHEET_COPY.DRIVE.protectedNote)).toBe(true);
    for (const entity of layout.entityOrder) {
      const sheetId = sheetIdOf(tab(entity));
      expect(protections).toContainEqual(expect.objectContaining({ range: { sheetId, startColumnIndex: 0, endColumnIndex: 1 } }));
      expect(protections).toContainEqual(expect.objectContaining({ range: { sheetId, startRowIndex: 0, endRowIndex: 1 } }));
    }
    expect(protections).toContainEqual(expect.objectContaining({ range: { sheetId: sheetIdOf(tab('meta')) } }));
  });
});

describe('setupRequests: the Partners workbook', () => {
  const { validations, dropdownAt } = requestsFor(PARTNERS_LAYOUT, encodePartnerBook(sampleBook(), PARTNERS_META));

  it('makes the Partners tab as wide as its 29 columns, with Stage, Step, Level and MAP health dropdowns', () => {
    expect(PARTNERS_LAYOUT.columns.partner).toHaveLength(29);
    expect(tabLayout(PARTNERS_LAYOUT).find((t) => t.title === 'Partners')?.columnCount).toBe(29);
    const level = PARTNERS_LAYOUT.columns.partner.findIndex((c) => c.key === 'level');
    expect(choices(dropdownAt('Partners', level))).toEqual(['Registered', 'Preferred']);
    const stage = PARTNERS_LAYOUT.columns.partner.findIndex((c) => c.key === 'stage');
    expect(choices(dropdownAt('Partners', stage))).toEqual(['Recruitment', 'Onboarding', 'Growth', 'Expansion', 'Exit']);
    const health = PARTNERS_LAYOUT.columns.partner.findIndex((c) => c.key === 'mapHealth');
    expect(choices(dropdownAt('Partners', health))).toEqual(['On track', 'At risk', 'Off track']);
    // A target customer type on Accounts, 7 lists and 8 scores on Partners, a role, a call kind, 4 CASO answers and the
    // Proposals tab's 3 lists.
    expect(validations).toHaveLength(25);
  });

  it('gives the Proposals tab its Kind, What and Status dropdowns', () => {
    const at = (key: string) => choices(dropdownAt('Proposals', PARTNERS_LAYOUT.columns.proposalItem.findIndex((c) => c.key === key)));
    expect(at('kind')).toEqual(['4C scores', 'Stage', 'Close', 'Signed', 'New partner', 'Hypothesis status', 'Market status']);
    expect(at('what')).toEqual([
      'Customer base (desk check)', 'Credibility (desk check)', 'Capability (desk check)', 'Commitment (desk check)', 'Step', 'Stage',
      'Close as', 'Signed date', 'New partner', 'Hypothesis status', 'Market status',
    ]);
    expect(at('status')).toEqual(['Waiting', 'Accepted', 'Rejected', 'Withdrawn', 'Replaced', 'Expired', 'Not sent']);
  });

  it('gives the Accounts tab a Target customer type dropdown', () => {
    const type = PARTNERS_LAYOUT.columns.account.findIndex((c) => c.key === 'targetCustomerType');
    expect(choices(dropdownAt('Accounts', type))).toEqual(labelsOf('targetCustomerType'));
  });
});

describe('setupRequests: the market workbook', () => {
  const { ofKind, sheetIdOf, validations } = requestsFor(MARKET_LAYOUT, marketWb);

  it('adds dropdowns to the Market tab’s list rows, on the value cell', () => {
    const tab = marketWb[MARKET_LAYOUT.tabs.info]!;
    for (const [label, enumName] of [['Partner type', 'marketPartnerType'], ['How the market buys', 'howMarketBuys'], ['Status', 'marketStatus']] as const) {
      const row = tab.findIndex((r) => r[0] === label);
      const v = validations.find((x) => x.range.sheetId === sheetIdOf('Market') && x.range.startRowIndex === row);
      expect(v?.range).toEqual({ sheetId: sheetIdOf('Market'), startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 1, endColumnIndex: 2 });
      expect(choices(v)).toEqual(labelsOf(enumName));
    }
    // 3 on the Market tab, then kind and state, a hypothesis status and a change's "About".
    expect(validations).toHaveLength(7);
  });

  it('protects the Market tab’s labels, which are its rows’ ids', () => {
    const protections = ofKind('addProtectedRange').map((p) => p.protectedRange as Protection);
    expect(protections).toContainEqual(expect.objectContaining({ range: { sheetId: sheetIdOf('Market'), startColumnIndex: 0, endColumnIndex: 1 } }));
  });

  it('fails loudly when the Market tab has no row for a dropdown field, instead of skipping the dropdown', () => {
    const broken = { ...marketWb, Market: marketWb.Market!.filter((row) => row[0] !== 'How the market buys') };
    expect(() => setupRequests(MARKET_LAYOUT, broken)).toThrow('Setup: no "How the market buys" row on the Market tab');
  });
});
