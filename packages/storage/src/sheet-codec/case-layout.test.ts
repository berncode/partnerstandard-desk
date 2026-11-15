// How one business case lies in its spreadsheet: the Business Case app's tables without their Case column, one case per file.
import { describe, expect, it } from 'vitest';
import { SHEET_COPY } from '@partner-desk/copy';
import type { BusinessCase } from '@partner-desk/core';
import { sampleCase } from '../case-store.contract';
import { CASE_TABS, freshCaseGrids, readCaseBook } from './case-layout';
import { CASE_SETTINGS, FIGURES, OFFER_SETTINGS } from './case-records';
import { applyRowWrites, type BookRead, type Grids } from './program-layout';

const sample = sampleCase();
const grids = (c: BusinessCase = sample): Grids => structuredClone(freshCaseGrids(c, c.companyId));

function valueOf<T>(read: BookRead<T>): T {
  if (!read.ok) throw new Error(`${read.tab}: ${read.message}`);
  return read.value;
}
const failureOf = <T>(read: BookRead<T>) => (read.ok ? null : { tab: read.tab, message: read.message });
const issuesOf = <T>(read: BookRead<T>) => (read.ok ? read.issues : null);
function saved(g: Grids, next: BusinessCase): Grids {
  const read = readCaseBook(g);
  if (!read.ok) throw new Error(read.message);
  return applyRowWrites(g, read.writes(next));
}
const setting = (g: Grids, tab: string, name: string) => g[tab]!.find((row) => row[0] === name)!;

describe('the case layout', () => {
  it('has the tabs in this order, and no Case column on any of them', () => {
    expect(CASE_TABS).toEqual(['Offer', 'Products', 'Partner type', 'Case', 'Costs', 'Our case', 'Strategic reasons', '_meta']);
    const g = grids();
    expect(g.Offer![0]).toEqual(['Setting', 'Value']);
    expect(g.Case![0]).toEqual(['Setting', 'Value']);
    expect(g['Our case']![0]).toEqual(['Setting', 'Value']);
    expect(g.Products![0]).toEqual(['Product', 'Paid', 'Price', 'Per', 'Amount', 'Id']);
    expect(g.Costs![0]).toEqual(['Side', 'Cost', 'When', 'Amount', 'Source', 'Id']);
    expect(g['Strategic reasons']![0]).toEqual(['Reason', 'Matters', 'Alone too', 'Id']);
    expect(g['Partner type']).toHaveLength(2);
    expect(g._meta).toEqual([['key', 'value'], ['schemaVersion', 1], ['companyId', sample.companyId], ['caseId', sample.id], ['createdWith', 'desk.partnerstandard.com']]);
  });

  it("writes one row per setting, in the Business Case app's words", () => {
    const g = grids();
    expect(g.Offer!.slice(1).map((row) => row[0])).toEqual([...OFFER_SETTINGS]);
    expect(g.Case!.slice(1).map((row) => row[0])).toEqual([...CASE_SETTINGS]);
    expect(setting(g, 'Offer', 'Preferred conditions')).toEqual(['Preferred conditions', 'On']);
    expect(setting(g, 'Offer', 'Registered level name')).toEqual(['Registered level name', 'Silver']);
    expect(setting(g, 'Case', 'PartnerStandard Desk type')).toEqual(['PartnerStandard Desk type', 'Reseller']);
    expect(setting(g, 'Case', 'Stage when made')).toEqual(['Stage when made', 'Onboarding']);
    expect(setting(g, 'Case', 'Notes')).toEqual(['Notes', 'flat-fee, bars']);
    expect(setting(g, 'Case', 'Starts as')).toEqual(['Starts as', 'Registered']);
    expect(setting(g, 'Our case', FIGURES.margin)).toEqual([FIGURES.margin, sample.ours.figures.margin]);
    expect(g.Costs!.slice(1).map((row) => row[0])).toEqual([
      ...sample.costs.map(() => 'Partner'), ...sample.ours.costs.map(() => 'Ours'), ...sample.ours.alone.costs.map(() => 'Ours if alone'),
    ]);
  });

  it('reads back what it wrote, with no issues', () => {
    const read = readCaseBook(grids());
    expect(valueOf(read)).toEqual(sample);
    expect(issuesOf(read)).toEqual([]);
  });

  it('reads an empty Program id, Recalculated on and Shared on as none', () => {
    const c = { ...sample, programId: null, recalculatedAt: null, shared: null, notes: [] };
    const g = grids(c);
    expect(setting(g, 'Case', 'Program id')).toEqual(['Program id', '']);
    expect(valueOf(readCaseBook(g))).toEqual(c);
  });
});

describe('reading a case edited by hand', () => {
  it('leaves out a cost line whose Side it cannot read, naming the row, and never writes over it', () => {
    const g = grids();
    g.Costs![1]![0] = 'Theirs';
    const read = readCaseBook(g);
    expect(valueOf(read).costs).toEqual(sample.costs.slice(1));
    expect(issuesOf(read)).toEqual([{ tab: 'Costs', row: 2, message: 'Side in Costs row 2 must be Partner, Ours or Ours if alone.' }]);
    const after = saved(g, valueOf(read));
    expect(after.Costs![1]).toEqual(g.Costs![1]);
    expect(valueOf(readCaseBook(after))).toEqual(valueOf(read));
  });

  it('leaves out a strategic reason that breaks a rule of the case, and the rest still reads', () => {
    const g = grids();
    g['Strategic reasons']![1]![0] = 'x'.repeat(201);
    const read = readCaseBook(g);
    expect(valueOf(read).ours.strategic).toEqual(sample.ours.strategic.slice(1));
    expect(issuesOf(read)).toEqual([{ tab: 'Strategic reasons', row: 2, message: 'Strategic reasons row 2: Reason must be 200 characters or fewer.' }]);
  });

  it('leaves out both rows of a product whose Id is there twice', () => {
    const g = grids();
    g.Products!.push([...g.Products![1]!]);
    const read = readCaseBook(g);
    expect(valueOf(read).offer.products).toEqual(sample.offer.products.slice(1));
    expect(issuesOf(read)!.map((issue) => issue.row)).toEqual([2, 4]);
  });

  it('names the setting in a problem, and never what was typed', () => {
    const g = grids();
    setting(g, 'Offer', 'Customers who renew (%)')[1] = 'most';
    expect(failureOf(readCaseBook(g))).toEqual({ tab: 'Offer', message: "Customers who renew (%) in Offer isn't a number." });
    const range = grids();
    setting(range, 'Case', 'Deals year 2')[1] = -1;
    expect(failureOf(readCaseBook(range))).toEqual({ tab: 'Case', message: 'Deals year 2 in Case: Deals in year 2 must be 0 or more.' });
    const type = grids();
    setting(type, 'Case', 'PartnerStandard Desk type')[1] = 'Wholesaler';
    expect(failureOf(readCaseBook(type))).toEqual({ tab: 'Case', message: "PartnerStandard Desk type in Case isn't a partner type this tool knows." });
  });

  it('refuses a Partner type tab with a second row, or a row it cannot read', () => {
    const two = grids();
    two['Partner type']!.push([...two['Partner type']![1]!]);
    expect(failureOf(readCaseBook(two))?.tab).toBe('Partner type');
    const bad = grids();
    bad['Partner type']![1]![1] = 'half';
    expect(failureOf(readCaseBook(bad))).toEqual({ tab: 'Partner type', message: "Brings the lead (%) in Partner type row 2 isn't a number." });
  });

  it("reads the ids from _meta when a person changed the Id setting, says so, and a save puts it back", () => {
    const g = grids();
    const idRow = g.Case!.findIndex((row) => row[0] === 'Id');
    g.Case![idRow]![1] = 'bc_typedbyhand';
    const read = readCaseBook(g);
    expect(valueOf(read)).toEqual(sample);
    expect(issuesOf(read)).toEqual([{ tab: 'Case', row: idRow + 1, message: expect.stringMatching(/^Id in Case /) }]);
    expect(issuesOf(readCaseBook(saved(g, valueOf(read))))).toEqual([]);
  });

  it("gives a Partner type row whose Id was cleared the case's Type id, with no issue, and a save writes it back", () => {
    const g = grids();
    const idColumn = g['Partner type']![0]!.indexOf('Id');
    g['Partner type']![1]![idColumn] = '';
    const read = readCaseBook(g);
    expect(valueOf(read)).toEqual(sample);
    expect(issuesOf(read)).toEqual([]);
    const after = saved(g, valueOf(read));
    expect(after['Partner type']![1]![idColumn]).toBe(sample.typeId);
    expect(valueOf(readCaseBook(after))).toEqual(sample);
  });

  it("reads a changed Type id as the Partner type row's Id, says so, and a save writes the two in agreement", () => {
    for (const typed of ['type_typedbyhand', '']) {
      const g = grids();
      setting(g, 'Case', 'Type id')[1] = typed;
      const read = readCaseBook(g);
      expect(valueOf(read)).toEqual(sample);
      const row = g.Case!.findIndex((r) => r[0] === 'Type id') + 1;
      expect(issuesOf(read)).toEqual([{ tab: 'Case', row, message: expect.stringMatching(/^Type id in Case /) }]);
      const after = saved(g, valueOf(read));
      expect(setting(after, 'Case', 'Type id')[1]).toBe(sample.typeId);
      expect(issuesOf(readCaseBook(after))).toEqual([]);
    }
  });

  it('takes the Id typed in the Partner type row over the Type id, says so, and a save writes it to Type id', () => {
    const g = grids();
    const idColumn = g['Partner type']![0]!.indexOf('Id');
    g['Partner type']![1]![idColumn] = 'type_typedbyhand';
    const read = readCaseBook(g);
    const value = valueOf(read);
    expect(value.typeId).toBe('type_typedbyhand');
    expect(value.offer.types.map((t) => t.id)).toEqual(['type_typedbyhand']);
    expect(issuesOf(read)).toEqual([{ tab: 'Case', row: expect.any(Number), message: expect.stringMatching(/^Type id in Case /) }]);
    const after = saved(g, value);
    expect(setting(after, 'Case', 'Type id')[1]).toBe('type_typedbyhand');
    expect(issuesOf(readCaseBook(after))).toEqual([]);
  });

  it('names a deleted tab, and reads a file without our _meta as not ours', () => {
    const g = grids();
    delete g.Costs;
    expect(failureOf(readCaseBook(g))).toEqual({ tab: 'Costs', message: SHEET_COPY.ISSUES.MISSING_TAB('Costs') });
    const none = grids();
    delete none._meta;
    expect(failureOf(readCaseBook(none))).toEqual({ tab: '_meta', message: SHEET_COPY.ISSUES.NOT_OURS });
  });

  it("keeps a person's own setting row and column through a save", () => {
    const g = grids();
    g.Case!.push(['My note', 'Call Anna first']);
    g.Products = g.Products!.map((row, i) => [...row, i === 0 ? 'Notes' : `note ${i}`]);
    const after = saved(g, { ...sample, title: 'Changed' });
    expect(after.Case).toContainEqual(['My note', 'Call Anna first']);
    expect(after.Products!.map((row) => row[6])).toEqual(g.Products.map((row) => row[6]));
    expect(valueOf(readCaseBook(after)).title).toBe('Changed');
  });

  it("finds a Costs row typed out of side order by its Id, and keeps it and the person's own column on its row through a save", () => {
    const g = grids();
    g.Costs = g.Costs!.map((row, i) => [...row, i === 0 ? 'My notes' : `note ${i}`]);
    // An Ours line typed below the Ours if alone lines, without an Id.
    g.Costs.push(['Ours', 'Extra help', 'Every year', 700, 'Sales', '', 'typed note']);
    const at = g.Costs.length;
    const read = readCaseBook(g);
    expect(valueOf(read).ours.costs.at(-1)).toEqual({ id: `row_${at}`, name: 'Extra help', when: 'yearly', amount: 700, source: 'sales' });
    const after = saved(g, { ...valueOf(read), title: 'Only the title' });
    const expected = g.Costs.map((row, i) => (i === at - 1 ? ['Ours', 'Extra help', 'Every year', 700, 'Sales', `row_${at}`, 'typed note'] : row));
    expect(after.Costs).toEqual(expected);
    expect(valueOf(readCaseBook(after))).toEqual({ ...valueOf(read), title: 'Only the title' });
  });

  it('blanks only the row of a product removed from the middle', () => {
    const extra = { id: 'prod_3', name: 'Training days', paid: 'once' as const, price: 900, per: 'site' as const, amount: 2 };
    const c = { ...sample, offer: { ...sample.offer, products: [...sample.offer.products, extra] } };
    const g = grids(c);
    const after = saved(g, { ...c, offer: { ...c.offer, products: [c.offer.products[0]!, extra] } });
    expect(after.Products![1]).toEqual(g.Products![1]);
    expect(after.Products![2]).toEqual(['', '', '', '', '', '']);
    expect(after.Products![3]).toEqual(g.Products![3]);
    expect(valueOf(readCaseBook(after)).offer.products).toEqual([c.offer.products[0], extra]);
  });

  it('puts a new product below the last row in use, and never into a row it could not read', () => {
    const g = grids();
    g.Products![2]![2] = 'a lot';
    const read = readCaseBook(g);
    const added = { id: 'prod_new', name: 'Added', paid: 'once' as const, price: 10, per: 'site' as const, amount: 2 };
    const after = saved(g, { ...valueOf(read), offer: { ...valueOf(read).offer, products: [...valueOf(read).offer.products, added] } });
    expect(after.Products![2]).toEqual(g.Products![2]);
    expect(after.Products![3]).toEqual(['Added', 'Once', 10, 'site', 2, 'prod_new']);
  });

  it('reads and saves a case made before the new name under its old row, "Partner Desk type", without a second row', () => {
    const g = grids();
    setting(g, 'Case', 'PartnerStandard Desk type')[0] = 'Partner Desk type'; // as made before 2026-11-10
    const rowsBefore = g.Case!.length;
    expect(valueOf(readCaseBook(g)).partnerType).toBe(sample.partnerType);
    const after = saved(g, { ...sample, title: 'A new title' });
    expect(after.Case).toHaveLength(rowsBefore);
    expect(after.Case!.filter((row) => String(row[0]).endsWith('Desk type')).map((row) => row[0])).toEqual(['Partner Desk type']);
    expect(valueOf(readCaseBook(after))).toMatchObject({ title: 'A new title', partnerType: sample.partnerType });
  });
});
