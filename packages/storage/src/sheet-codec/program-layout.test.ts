// The program layout cases: `_meta`, and list rows read one by one (a bad row is left out with an issue and never written over).
import { describe, expect, it } from 'vitest';
import { emptyFigures, type CompanyFacts, type Program } from '@partner-desk/core';
import { northwind } from '@partner-desk/core/test-builders';
import { SHEET_COPY } from '@partner-desk/copy';
import type { Cell } from './grid';
import {
  applyRowWrites, freshCompanyFactsGrids, freshProgramGrids, PROGRAM_TABS, readCompanyFactsBook, readProgramBook, type BookRead, type Grids,
} from './program-layout';
import { FIGURES } from './case-records';
import { COMPANY_SETTINGS, LIST_COLUMNS, PROGRAM_SETTINGS } from './program-records';

const STAMP = '2026-10-26T09:00:00.000Z';

function facts(): CompanyFacts {
  const c: Partial<ReturnType<typeof northwind>> = northwind();
  delete c.name;
  delete c.programs;
  return { ...(c as CompanyFacts), updatedAt: STAMP };
}
const reseller = (): Program => ({ ...northwind().programs[0], updatedAt: STAMP });

const programGrids = (p = reseller()): Grids => structuredClone(freshProgramGrids(p, 'co_northwind000001'));
const factsGrids = (c = facts()): Grids => structuredClone(freshCompanyFactsGrids(c, 'co_northwind000001'));

/** The value, or the failure as `{ tab, message }`. */
function valueOf<T>(read: BookRead<T>): T {
  if (!read.ok) throw new Error(`${read.tab}: ${read.message}`);
  return read.value;
}
const failureOf = <T>(read: BookRead<T>) => (read.ok ? null : { tab: read.tab, message: read.message });
const issuesOf = <T>(read: BookRead<T>) => (read.ok ? read.issues : null);
/** The grids after a save of `next` over `grids`. */
function saved(grids: Grids, next: Program): Grids {
  const read = readProgramBook(grids);
  if (!read.ok) throw new Error(read.message);
  return applyRowWrites(grids, read.writes(next));
}
const filled = (grid: Cell[][] | undefined) => (grid ?? []).slice(1).filter((row) => row.some((cell) => cell !== '' && cell !== null));

describe('the layout', () => {
  it('has the program tabs in this order, with the list tabs under these header rows', () => {
    expect(PROGRAM_TABS).toEqual(['Program Sheet', 'Program', 'Reasons', 'Entry', 'Benefits', 'Requirements', 'Performance bar', 'Public page', '_meta']);
    const grids = programGrids();
    for (const [list, columns] of Object.entries(LIST_COLUMNS)) expect(grids[list]![0]).toEqual([...columns]);
    expect(grids['Program Sheet']).toEqual([]);
    expect(grids['Public page']).toEqual([]);
  });

  it('writes one row per company setting under the header, in order, and the format version in _meta', () => {
    const grids = factsGrids();
    expect(grids['Company facts']![0]).toEqual(['Setting', 'Value']);
    expect(grids['Company facts']!.slice(1).map((row) => row[0])).toEqual([...COMPANY_SETTINGS, ...Object.values(FIGURES)]);
    expect(grids['Company facts']!.find((row) => row[0] === 'Customers who renew (%)')).toEqual(['Customers who renew (%)', 90]);
    expect(grids['Our cost lines']).toEqual([['Cost', 'When', 'Amount', 'Source', 'Id']]);
    expect(grids._meta).toEqual([['key', 'value'], ['schemaVersion', 2], ['companyId', 'co_northwind000001'], ['createdWith', 'desk.partnerstandard.com']]);
  });

  it('writes one row per program setting, the lists under their headers, and both ids in _meta', () => {
    const grids = programGrids();
    expect(grids.Program!.slice(1).map((row) => row[0])).toEqual([...PROGRAM_SETTINGS]);
    expect(grids.Reasons).toEqual([['Reason'], ...reseller().why.map((why) => [why])]);
    expect(grids.Requirements).toHaveLength(7);
    expect(grids._meta).toContainEqual(['programId', reseller().id]);
    expect(grids._meta).toContainEqual(['schemaVersion', 1]);
  });
});

describe('reading', () => {
  it('reads back what it wrote, with no issues', () => {
    expect(valueOf(readCompanyFactsBook(factsGrids()))).toEqual(facts());
    const read = readProgramBook(programGrids());
    expect(valueOf(read)).toEqual(reseller());
    expect(issuesOf(read)).toEqual([]);
  });

  it('reads a hand-added blank row, a reordered row and an extra column fine', () => {
    const grids = programGrids();
    grids.Program = [grids.Program![0]!, ...grids.Program!.slice(1).reverse()];
    grids.Program.splice(5, 0, []);
    grids.Reasons!.splice(2, 0, ['', '']);
    grids.Requirements = [grids.Requirements![0]!, ...grids.Requirements!.slice(1).reverse()];
    grids.Benefits = grids.Benefits!.map((row, i) => [...row, i === 0 ? 'Notes' : `note ${i}`]);
    expect(valueOf(readProgramBook(grids))).toEqual(reseller());
  });

  it('leaves out a list row it cannot read, naming the real row, and reads the rest', () => {
    const grids = programGrids();
    grids['Performance bar']!.splice(1, 0, []);
    grids['Performance bar']![2]![1] = 'five';
    const read = readProgramBook(grids);
    expect(valueOf(read).bars).toEqual(reseller().bars.slice(1));
    expect(issuesOf(read)).toEqual([{ tab: 'Performance bar', row: 3, message: "At least in Performance bar row 3 isn't a number." }]);
  });

  it('leaves out a list row that breaks a rule of the program, and the rest still reads', () => {
    const grids = programGrids();
    grids['Performance bar']![1]![1] = -4;
    const read = readProgramBook(grids);
    expect(valueOf(read).bars).toEqual(reseller().bars.slice(1));
    expect(issuesOf(read)).toEqual([{ tab: 'Performance bar', row: 2, message: expect.stringMatching(/^Performance bar row 2: At least/) }]);
  });

  it('leaves out every row of a benefit named twice, and its own benefits with them', () => {
    const grids = programGrids();
    const dealreg = grids.Benefits!.find((row) => row[5] === 'dealreg')!;
    grids.Benefits!.push([...dealreg]);
    const read = readProgramBook(grids);
    expect(valueOf(read).reg).not.toContain('dealreg');
    expect(issuesOf(read)!.map((issue) => issue.row)).toEqual([2, grids.Benefits!.length]);
  });

  it('reads a deleted Requirements row as not asked for, and a save puts the row back', () => {
    const grids = programGrids();
    grids.Requirements = grids.Requirements!.filter((row) => row[0] !== 'Quarterly business review');
    const read = readProgramBook(grids);
    expect(valueOf(read).prefReq.qbr).toBe(false);
    expect(issuesOf(read)).toEqual([]);
    const after = saved(grids, { ...valueOf(read), prefReq: { ...valueOf(read).prefReq, qbr: true } });
    expect(valueOf(readProgramBook(after)).prefReq.qbr).toBe(true);
  });

  it('names a deleted tab, a missing column and a repeated setting', () => {
    const grids = programGrids();
    delete grids['Performance bar'];
    expect(failureOf(readProgramBook(grids))).toEqual({ tab: 'Performance bar', message: SHEET_COPY.ISSUES.MISSING_TAB('Performance bar') });

    const columns = programGrids();
    columns.Reasons![0] = ['Why'];
    expect(failureOf(readProgramBook(columns))).toEqual({ tab: 'Reasons', message: SHEET_COPY.ISSUES.MISSING_COLUMN('Reasons', 'Reason') });

    const twice = programGrids();
    twice.Program!.push(['Focus', 'DACH']);
    expect(failureOf(readProgramBook(twice))).toEqual({ tab: 'Program', message: `Program rows 6 and ${twice.Program!.length} have the same Setting.` });
  });

  it('names the setting in a problem, and never what was typed', () => {
    const grids = factsGrids();
    grids['Company facts']!.find((row) => row[0] === 'Customers who renew (%)')![1] = 'ninety';
    expect(failureOf(readCompanyFactsBook(grids))).toEqual({ tab: 'Company facts', message: "Customers who renew (%) in Company facts isn't a number." });
    const program = programGrids();
    program.Program!.find((row) => row[0] === 'Partner type')![1] = 'Wholesaler';
    expect(failureOf(readProgramBook(program))).toEqual({ tab: 'Program', message: "Partner type in Program isn't a partner type this tool knows." });
    const range = factsGrids();
    range['Company facts']!.find((row) => row[0] === 'Customers who renew (%)')![1] = 140;
    expect(failureOf(readCompanyFactsBook(range))?.message).toMatch(/^Customers who renew \(%\) in Company facts: /);
  });

  it('reads a date a person typed into Publish the criteria on (a date serial) as YYYY-MM-DD, afternoon included', () => {
    const grids = programGrids();
    grids.Program!.find((row) => row[0] === 'Publish the criteria on')![1] = 46402.75;
    expect(valueOf(readProgramBook(grids)).publish).toBe('2027-01-15');
  });

  it("reads the ids from _meta when a person changed the Id or Company setting, says so, and a save puts them back", () => {
    const grids = programGrids();
    const idRow = grids.Program!.findIndex((row) => row[0] === 'Id');
    const companyRow = grids.Program!.findIndex((row) => row[0] === 'Company');
    grids.Program![idRow]![1] = 'pr_typedbyhand';
    grids.Program![companyRow]![1] = 'co_typedbyhand';
    const read = readProgramBook(grids);
    expect(valueOf(read)).toEqual(reseller());
    expect(issuesOf(read)).toEqual([
      { tab: 'Program', row: idRow + 1, message: expect.stringMatching(/^Id in Program /) },
      { tab: 'Program', row: companyRow + 1, message: expect.stringMatching(/^Company in Program /) },
    ]);
    const after = saved(grids, valueOf(read));
    expect(issuesOf(readProgramBook(after))).toEqual([]);
    expect(after.Program![idRow]![1]).toBe(reseller().id);
  });

  it('reads a file without our _meta as not ours, and one from a newer version as newer', () => {
    const none = programGrids();
    delete none._meta;
    expect(failureOf(readProgramBook(none))).toEqual({ tab: '_meta', message: SHEET_COPY.ISSUES.NOT_OURS });
    const newer = factsGrids();
    newer._meta![1] = ['schemaVersion', 3];
    expect(failureOf(readCompanyFactsBook(newer))).toEqual({ tab: '_meta', message: SHEET_COPY.ISSUES.NEWER_VERSION });
    const noId = programGrids();
    noId._meta = noId._meta!.filter((row) => row[0] !== 'programId');
    expect(failureOf(readProgramBook(noId))).toEqual({ tab: '_meta', message: SHEET_COPY.ISSUES.NOT_OURS });
  });
});

describe('writing over what is there', () => {
  it('writes each setting into its own row wherever a person moved it, keeps their extra column, and blanks rows left over', () => {
    const grids = programGrids();
    grids.Program = [grids.Program![0]!, ...grids.Program!.slice(1).reverse()];
    grids.Benefits = grids.Benefits!.map((row, i) => [...row, i === 0 ? 'Notes' : `note ${i}`]);
    const changed = { ...reseller(), focus: 'DACH', why: ['One reason only'] };
    const after = saved(grids, changed);
    expect(valueOf(readProgramBook(after))).toEqual(changed);
    expect(after.Program!.slice(1).map((row) => row[0])).toEqual([...PROGRAM_SETTINGS].reverse());
    expect(after.Benefits!.map((row) => row[6])).toEqual(grids.Benefits!.map((row) => row[6]));
    expect(filled(after.Reasons)).toEqual([['One reason only']]);
  });

  it('adds and removes own benefits by their key, and never touches the output tabs or _meta', () => {
    const grids = programGrids();
    grids['Program Sheet'] = [['Old sheet']];
    const own = { k: 'own_newbene1', g: 'Support' as const, n: 'Our own help desk' };
    const added = saved(grids, { ...reseller(), own: [own], pref: [...reseller().pref, own.k] });
    expect(valueOf(readProgramBook(added)).own).toEqual([own]);
    expect(valueOf(readProgramBook(added)).pref).toContain(own.k);
    const removed = saved(added, reseller());
    expect(valueOf(readProgramBook(removed))).toEqual(reseller());
    expect(filled(removed.Benefits).some((row) => row.includes(own.k))).toBe(false);
    expect(removed['Program Sheet']).toEqual([['Old sheet']]);
    expect(removed._meta).toEqual(grids._meta);
  });

  it('never writes a list row it could not read, and puts new items below everything', () => {
    const grids = programGrids();
    grids['Performance bar']![1]![1] = 'five';
    const next = { ...valueOf(readProgramBook(grids)), bars: [{ label: 'A', value: 1, unit: 'x' }, { label: 'B', value: 2, unit: 'y' }] };
    const after = saved(grids, next);
    expect(after['Performance bar']![1]).toEqual(grids['Performance bar']![1]);
    expect(valueOf(readProgramBook(after)).bars).toEqual(next.bars);
  });
});

describe('Company facts version 2: our figures and cost lines', () => {
  /** Facts with our figures and two cost lines of ours. */
  const withOurs = (): CompanyFacts => ({
    ...facts(),
    ours: {
      figures: {
        margin: 80, marginSource: 'finance',
        serve: { find: 1200, close: 3000, salesSource: 'sales', support1: 400, support2: 250, supportSource: 'assumption', servicesCost: 90, servicesCharge: 150, servicesSource: 'other' },
      },
      costs: [
        { id: 'oc_manager01', name: 'Partner manager time', when: 'yearly', amount: 24000, source: 'finance' },
        { id: 'oc_launch001', name: 'Launch kit', when: 'start', amount: 3000, source: 'assumption' },
      ],
    },
  });

  /** A file as version 1 wrote it: no figure settings, no Our cost lines tab, schemaVersion 1. */
  function version1(): Grids {
    const grids = factsGrids();
    const figures = new Set<Cell>(Object.values(FIGURES));
    grids['Company facts'] = grids['Company facts']!.filter((row) => !figures.has(row[0] ?? null));
    delete grids['Our cost lines'];
    grids._meta![1] = ['schemaVersion', 1];
    return grids;
  }
  function savedFacts(grids: Grids, next: CompanyFacts): Grids {
    const read = readCompanyFactsBook(grids);
    if (!read.ok) throw new Error(read.message);
    return applyRowWrites(grids, read.writes(next));
  }

  it('reads back our figures and cost lines as written', () => {
    const read = readCompanyFactsBook(factsGrids(withOurs()));
    expect(valueOf(read)).toEqual(withOurs());
    expect(issuesOf(read)).toEqual([]);
  });

  it('reads a version 1 file with nothing of ours', () => {
    expect(valueOf(readCompanyFactsBook(version1())).ours).toEqual({ figures: emptyFigures(), costs: [] });
  });

  it('writes the figure rows, the Our cost lines tab and version 2 on the next save', () => {
    const grids = version1();
    const after = savedFacts(grids, withOurs());
    const rows = after['Company facts']!;
    expect(rows.slice(1).map((row) => row[0])).toEqual([...COMPANY_SETTINGS, ...Object.values(FIGURES)]);
    expect(rows.find((row) => row[0] === FIGURES.margin)).toEqual([FIGURES.margin, 80]);
    expect(rows.find((row) => row[0] === FIGURES.marginSource)).toEqual([FIGURES.marginSource, 'Finance']);
    expect(after['Our cost lines']).toEqual([
      ['Cost', 'When', 'Amount', 'Source', 'Id'],
      ['Partner manager time', 'Every year', 24000, 'Finance', 'oc_manager01'],
      ['Launch kit', 'To get started', 3000, 'Assumption', 'oc_launch001'],
    ]);
    expect(after._meta).toContainEqual(['schemaVersion', 2]);
    expect(valueOf(readCompanyFactsBook(after))).toEqual(withOurs());
  });

  it('keeps a figure setting typed by hand into a version 1 file, and adds only the others', () => {
    const grids = version1();
    grids['Company facts']!.push([FIGURES.margin, 70]);
    expect(valueOf(readCompanyFactsBook(grids)).ours.figures.margin).toBe(70);
    const after = savedFacts(grids, withOurs());
    expect(after['Company facts']!.filter((row) => row[0] === FIGURES.margin)).toEqual([[FIGURES.margin, 80]]);
    expect(valueOf(readCompanyFactsBook(after))).toEqual(withOurs());
  });

  it('reads an empty figure as 0 and an empty source as Assumption', () => {
    const grids = factsGrids(withOurs());
    grids['Company facts']!.find((row) => row[0] === FIGURES.find)![1] = '';
    grids['Company facts']!.find((row) => row[0] === FIGURES.salesSource)![1] = '';
    const serve = valueOf(readCompanyFactsBook(grids)).ours.figures.serve;
    expect(serve.find).toBe(0);
    expect(serve.salesSource).toBe('assumption');
  });

  it('reads a cost line typed by hand, without an Id, and a save keeps it with an Id', () => {
    const grids = factsGrids(withOurs());
    grids['Our cost lines']!.push(['Events', 'every year', '5000', 'sales']);
    const read = readCompanyFactsBook(grids);
    const typed = valueOf(read).ours.costs[2]!;
    expect(typed).toEqual({ id: expect.any(String), name: 'Events', when: 'yearly', amount: 5000, source: 'sales' });
    expect(issuesOf(read)).toEqual([]);
    const after = savedFacts(grids, valueOf(read));
    expect(after['Our cost lines']![3]).toEqual(['Events', 'Every year', 5000, 'Sales', typed.id]);
    expect(valueOf(readCompanyFactsBook(after)).ours.costs[2]).toEqual(typed);
  });

  it('leaves out a cost line it cannot read, naming the row, and never writes over it', () => {
    const grids = factsGrids(withOurs());
    grids['Our cost lines']![1]![2] = 'lots';
    const read = readCompanyFactsBook(grids);
    expect(valueOf(read).ours.costs).toEqual([withOurs().ours.costs[1]]);
    expect(issuesOf(read)).toEqual([{ tab: 'Our cost lines', row: 2, message: "Amount in Our cost lines row 2 isn't a number." }]);
    const after = savedFacts(grids, { ...valueOf(read), ours: { ...valueOf(read).ours, costs: [] } });
    expect(after['Our cost lines']![1]).toEqual(grids['Our cost lines']![1]);
    expect(issuesOf(readCompanyFactsBook(after))).toEqual(issuesOf(read));
  });

  it('names a figure setting that cannot be read, and an Our cost lines tab a person renamed', () => {
    const grids = factsGrids(withOurs());
    grids['Company facts']!.find((row) => row[0] === FIGURES.marginSource)![1] = 'A guess';
    expect(failureOf(readCompanyFactsBook(grids))).toEqual({
      tab: 'Company facts', message: 'Gross margin source in Company facts must be Assumption, Finance, Sales, Partner or Other.',
    });
    const renamed = factsGrids(withOurs());
    renamed.Costs = renamed['Our cost lines'];
    delete renamed['Our cost lines'];
    expect(failureOf(readCompanyFactsBook(renamed))).toEqual({ tab: 'Our cost lines', message: SHEET_COPY.ISSUES.MISSING_TAB('Our cost lines') });
  });

  it("blanks only the row of a cost line removed, and keeps a person's own column on each line's row", () => {
    const grids = factsGrids(withOurs());
    grids['Our cost lines'] = grids['Our cost lines']!.map((row, i) => [...row, i === 0 ? 'My notes' : `note ${i}`]);
    const after = savedFacts(grids, { ...withOurs(), ours: { ...withOurs().ours, costs: [withOurs().ours.costs[1]!] } });
    expect(after['Our cost lines']![1]).toEqual(['', '', '', '', '', 'note 1']);
    expect(after['Our cost lines']![2]).toEqual(grids['Our cost lines']![2]);
  });
});
