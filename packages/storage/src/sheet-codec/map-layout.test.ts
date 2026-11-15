// A MAP's file as PartnerStandard Desk keeps it. The partner's name, stage and signing are on the partner record, so
// the Plan tab holds the partner type's id, its type, the horizon length, the later horizons and the next review.
// Rows that can't be read are left out with an issue, as in every PartnerStandard Desk file; an issue never holds what a cell holds.
import { describe, expect, it } from 'vitest';
import type { MapPlan, MapReview, ReviewItem, ReviewNumber } from '@partner-desk/core';
import { buildSamplePlan } from '@partner-desk/method';
import { decodeMap } from './decode';
import { encodeMap } from './encode';
import type { Cell, Workbook } from './grid';
import { formatLaterHorizons, MAP_LAYOUT, parseLaterHorizons } from './map-layout';
import { asMapVersion2 } from './test-fixtures';
import { CURRENT_SCHEMA_VERSIONS } from './version';

const TODAY = '2026-10-31';
const COMPANY = 'co_abcdefghij';
const sample = () => buildSamplePlan(TODAY) as MapPlan;
const T = MAP_LAYOUT.tabs;
const encoded = (plan: MapPlan = sample()) => encodeMap(plan, COMPANY, { appUrl: 'https://desk.test/plans' });

function decodeOk(wb: Workbook) {
  const result = decodeMap(wb);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function decodeError(wb: Workbook) {
  const result = decodeMap(wb);
  if (result.ok) throw new Error('expected a decode error');
  return result.error;
}

const header = (wb: Workbook, tab: string) => wb[tab]![0]!;
/** Sets a cell by header name. `row` is the array index (0 = header). */
function setCell(wb: Workbook, tab: string, row: number, name: string, value: Cell) {
  const col = header(wb, tab).indexOf(name);
  if (col === -1) throw new Error(`no column ${name}`);
  wb[tab]![row]![col] = value;
}
/** Sets the value of a Plan tab row by its label. */
function setPlan(wb: Workbook, label: string, value: Cell) {
  const row = wb[T.plan]!.find((r) => r[0] === label);
  if (!row) throw new Error(`no Plan row ${label}`);
  row[1] = value;
}
const rowOf = (wb: Workbook, tab: string, id: string) => wb[tab]!.findIndex((row) => row[0] === id);

const REVIEW: MapReview = {
  id: 'rv_sample1', horizon: 1, state: 'prep', heldOn: null, caseId: 'bc_sample01', decisions: 'Run the webinar again',
  relationshipNote: 'Warm', nextHorizonDays: 90, includeScorecard: true, summarySentAt: '2026-10-30T10:00:00.000Z',
  summarySentTo: 'Lena Ortiz, Priya Shah', updatedAt: '2026-10-30T09:00:00.000Z', updatedBy: 'Anna Keller',
};
const NUMBERS: ReviewNumber[] = [
  { id: 'rn_sample1', reviewId: REVIEW.id, key: 'dealsWon', actual: 2, target: 3, source: 'sales', note: 'One more in March', nextTarget: 4 },
  { id: 'rn_sample2', reviewId: REVIEW.id, key: 'weBill', actual: 12500.5, target: null, source: null, note: '', nextTarget: null },
];
const ITEMS: ReviewItem[] = [
  {
    id: 'ri_sample1', reviewId: REVIEW.id, kind: 'commitment', refId: null, title: 'Train five more sellers', side: 'partner',
    ownerId: 'p_sample3', dueDate: '2026-12-15', milestoneId: 'm_sample2', answer: null, note: '', moved: false,
  },
  {
    id: 'ri_sample2', reviewId: REVIEW.id, kind: 'hypothesis', refId: 'hy_abc', title: '', side: null, ownerId: null, dueDate: null,
    milestoneId: null, answer: 'doesnt_hold', note: 'Buyers changed', moved: false,
  },
];
/** The sample plan with one review, its numbers and its items. */
const reviewed = (): MapPlan => ({ ...sample(), reviews: [REVIEW], reviewNumbers: NUMBERS, reviewItems: ITEMS });
/** A version 1 file: no review tabs, and version 1 in `_meta`. */
function versionOne(plan: MapPlan = sample()): Workbook {
  const wb = encoded(plan);
  for (const tab of [T.review, T.reviewNumber, T.reviewItem]) delete wb[tab];
  wb['_meta']![1]![1] = 1;
  return wb;
}

/** A version 2 file as the staging build wrote it (test-fixtures.ts). */
const versionTwo = (plan: MapPlan = reviewed()): Workbook => asMapVersion2(encoded(plan));

describe('encodeMap', () => {
  const wb = encoded();

  it('makes the MAP app’s tabs in its order, the three review tabs, and a version 3 _meta with the company', () => {
    expect(Object.keys(wb)).toEqual([
      'Start here', 'Plan', 'Objectives', 'Activities', 'People', 'Milestones', 'Exit Triggers', 'Reviews', 'Review numbers', 'Review items', '_meta',
    ]);
    expect(MAP_LAYOUT.tabOrder).toEqual(Object.keys(wb));
    expect(CURRENT_SCHEMA_VERSIONS.map).toBe(3);
    expect(wb['_meta']).toEqual([['key', 'value'], ['schemaVersion', 3], ['companyId', COMPANY], ['createdWith', 'desk.partnerstandard.com']]);
  });

  it('writes the review tabs’ columns, an item’s owner and milestone by name as an activity’s, and lists as their labels', () => {
    expect(header(wb, T.review)).toEqual([
      'ID', 'Horizon', 'State', 'Held on', 'Business case ID', 'Decisions', 'Relationship note', 'Next horizon (days)', 'Scorecard in summary',
      'Summary sent', 'Sent to', 'Last updated', 'Updated by',
    ]);
    expect(header(wb, T.reviewNumber)).toEqual(['ID', 'Review ID', 'Number', 'Actual', 'Target', 'Source', 'Note', 'Next target']);
    expect(header(wb, T.reviewItem)).toEqual([
      'ID', 'Review ID', 'Kind', 'Activity or hypothesis ID', 'Title', 'Side', 'Owner', 'Due date', 'Milestone', 'Answer', 'Note', 'Moved to the plan',
    ]);
    expect(wb[T.review]).toHaveLength(1);
    const full = encoded(reviewed());
    expect(full[T.review]![1]).toEqual([
      'rv_sample1', 1, 'Prep started', '', 'bc_sample01', 'Run the webinar again', 'Warm', 90, 'yes', '2026-10-30T10:00:00.000Z',
      'Lena Ortiz, Priya Shah', '2026-10-30T09:00:00.000Z', 'Anna Keller',
    ]);
    expect(full[T.reviewNumber]![1]).toEqual(['rn_sample1', 'rv_sample1', 'Deals won', 2, 3, 'Sales', 'One more in March', 4]);
    expect(full[T.reviewNumber]![2]).toEqual(['rn_sample2', 'rv_sample1', 'We bill', 12500.5, '', '', '', '']);
    expect(full[T.reviewItem]![1]).toEqual([
      'ri_sample1', 'rv_sample1', 'Commitment', '', 'Train five more sellers', 'Partner', 'Priya Shah', '2026-12-15', 'Day 60: First joint opportunity', '', '', '',
    ]);
    expect(full[T.reviewItem]![2]).toEqual(['ri_sample2', 'rv_sample1', 'Hypothesis', 'hy_abc', '', '', '', '', '', 'Doesn’t hold', 'Buyers changed', '']);
  });

  it('writes the Plan tab as field and value rows, without the partner’s name, stage or signing', () => {
    expect(wb[T.plan]).toEqual([
      ['Field', 'Value'],
      ['Partner type id', 'p_sample'],
      ['Partner type', 'Reseller'],
      ['Horizon length', 90],
      ['Later horizons', ''],
      ['Next review', sample().info.nextReviewDate],
    ]);
  });

  it('writes the MAP app’s columns on every list tab', () => {
    expect(header(wb, T.objective)).toEqual(['ID', 'Side', 'Objective', 'How we’ll know']);
    expect(header(wb, T.activity)).toEqual([
      'ID', 'Activity', 'Category', 'Side', 'Owner', 'Due date', 'Status', 'Completed date', 'Milestone', 'Note', 'Last updated', 'Updated by',
    ]);
    expect(header(wb, T.person)).toEqual(['ID', 'Side', 'Name', 'Title', 'Email', 'Role']);
    expect(header(wb, T.milestone)).toEqual(['ID', 'Milestone', 'Target date', 'Success criteria', 'Achieved date']);
    expect(header(wb, T.exitTrigger)).toEqual(['ID', 'Condition', 'Status']);
    const plan = sample();
    expect(wb[T.activity]).toHaveLength(plan.activities.length + 1);
    expect(wb[T.person]).toHaveLength(plan.people.length + 1);
  });

  it('writes lists as their labels, and an activity’s owner and milestone by name', () => {
    const plan = sample();
    const activity = plan.activities[0]!;
    const row = wb[T.activity]![1]!;
    const at = (name: string) => row[header(wb, T.activity).indexOf(name)];
    expect(at('ID')).toBe(activity.id);
    expect(at('Owner')).toBe(plan.people.find((p) => p.id === activity.ownerId)!.name);
    expect(at('Milestone')).toBe(plan.milestones.find((m) => m.id === activity.milestoneId)!.name);
    expect(at('Last updated')).toBe(activity.updatedAt);
    expect(wb[T.person]!.slice(1).map((r) => r[5])).toContain('Executive Sponsor');
    expect(wb[T.objective]!.slice(1).map((r) => r[1])).toEqual(['Us', 'Us', 'Partner', 'Partner']);
  });

  it('says on the Start here tab that the file is the app’s database, and links to the plans', () => {
    const lines = wb[T.start]!.flat();
    expect(lines[0]).toBe('PartnerStandard Desk');
    expect(lines).toContain('https://desk.test/plans');
    expect(lines).toContain('• Use the dropdowns for Status, Category, Side and Role.');
    expect(lines).toContain('• Write an Owner and a Milestone as they are named on the People and Milestones tabs.');
    expect(lines.slice(5, 7)).toEqual([
      'This file is part of PartnerStandard Desk’s database. Work in PartnerStandard Desk, not here.',
      'Please don’t edit, move or delete this file by hand. If you are an admin and must change it:',
    ]);
    expect(lines).toContain('• PartnerStandard Desk writes the Reviews, Review numbers and Review items tabs. Leave them as they are.');
    expect(lines.join('\n')).not.toMatch(/Editing by hand is fine|Add your own columns/);
  });
});

describe('decodeMap', () => {
  it('round-trips the sample plan without issues', () => {
    const decoded = decodeOk(encoded());
    expect(decoded.value).toEqual(sample());
    expect(decoded.issues).toEqual([]);
    expect(decoded.missingIds).toEqual([]);
    expect(decoded.upgrade).toEqual([]);
  });

  it('round-trips later horizons, an empty plan and formula-looking text as plain text', () => {
    const plan: MapPlan = {
      ...sample(),
      info: { ...sample().info, laterHorizons: [{ startDate: '2027-01-30', horizonDays: 60 }, { startDate: '2027-04-01', horizonDays: 120 }], nextReviewDate: null },
      objectives: [{ id: 'o_x1', side: 'us', statement: '=SUM(A1)', successMeasure: '+43 calls\n@team' }],
    };
    expect(decodeOk(encoded(plan)).value).toEqual(plan);
    const empty: MapPlan = { ...plan, objectives: [], activities: [], people: [], milestones: [], exitTriggers: [] };
    expect(decodeOk(encoded(empty)).value).toEqual(empty);
  });

  it('round-trips a review with its numbers and items', () => {
    const decoded = decodeOk(encoded(reviewed()));
    expect(decoded.value).toEqual(reviewed());
    expect(decoded.issues).toEqual([]);
  });

  it('reads a version 1 file with no review rows, and gives the cells that make its three review tabs', () => {
    const decoded = decodeOk(versionOne());
    expect(decoded.value).toEqual(sample());
    expect(decoded.issues).toEqual([]);
    const headerCells = (tab: string) => MAP_LAYOUT.columns[tab === T.review ? 'review' : tab === T.reviewNumber ? 'reviewNumber' : 'reviewItem']
      .map((col, i) => ({ tab, row: 1, col: i, value: col.header, anchorCol: null }));
    expect(decoded.upgrade).toEqual([
      ...headerCells(T.review), ...headerCells(T.reviewNumber), ...headerCells(T.reviewItem),
      { tab: '_meta', row: 2, col: 1, value: 3, anchorCol: 0 },
    ]);
    expect(decoded.columns.reviewItem).toMatchObject({ id: 0, reviewId: 1, kind: 2 });
  });

  describe('a version 2 file (the review tabs as the staging build wrote them)', () => {
    it('reads the ids under Owner ID and Milestone ID as the people and milestones they name, and an empty Sent to', () => {
      const decoded = decodeOk(versionTwo());
      expect(decoded.value).toEqual({ ...reviewed(), reviews: [{ ...REVIEW, summarySentTo: '' }] });
      expect(decoded.issues).toEqual([]);
      expect(decoded.columns.reviewItem).toMatchObject({ refId: 3, ownerId: 6, milestoneId: 8 });
      expect(decoded.columns.review).toMatchObject({ summarySentAt: 9, summarySentTo: 12, updatedAt: 10 });
    });

    it('gives the cells that upgrade it: the three headers, each id as its name, the Sent to header and the version', () => {
      const decoded = decodeOk(versionTwo());
      expect(decoded.upgrade).toEqual([
        { tab: T.review, row: 1, col: 12, value: 'Sent to', anchorCol: 0 },
        { tab: T.reviewItem, row: 1, col: 3, value: 'Activity or hypothesis ID', anchorCol: 0 },
        { tab: T.reviewItem, row: 1, col: 6, value: 'Owner', anchorCol: 0 },
        { tab: T.reviewItem, row: 1, col: 8, value: 'Milestone', anchorCol: 0 },
        { tab: T.reviewItem, row: 2, col: 6, value: 'Priya Shah', anchorCol: 0 },
        { tab: T.reviewItem, row: 2, col: 8, value: 'Day 60: First joint opportunity', anchorCol: 0 },
        { tab: '_meta', row: 2, col: 1, value: 3, anchorCol: 0 },
      ]);
      // Upgraded, it reads as a version 3 file does.
      const upgraded = versionTwo();
      for (const cell of decoded.upgrade) upgraded[cell.tab]![cell.row - 1]![cell.col] = cell.value;
      expect(decodeOk(upgraded)).toMatchObject({ value: decoded.value, issues: [], upgrade: [] });
    });

    it('keeps an id that names no row as it is: the item reads with that link empty and marked, as an activity does', () => {
      const wb = versionTwo();
      setCell(wb, T.reviewItem, 1, 'Owner ID', 'p_gone01');
      const decoded = decodeOk(wb);
      expect(decoded.upgrade.filter((c) => c.tab === T.reviewItem && c.row === 2)).toEqual([{ tab: T.reviewItem, row: 2, col: 8, value: 'Day 60: First joint opportunity', anchorCol: 0 }]);
      expect(decoded.value.reviewItems[0]).toEqual({ ...ITEMS[0]!, ownerId: null });
      expect(decoded.issues).toEqual([{ tab: 'Review items', row: 2, message: 'Owner: no row on the "People" tab has this name, or that row can’t be read' }]);
      expect(decoded.unreadable.get(ITEMS[0]!.id)).toEqual(new Set(['ownerId']));
    });

    it('never writes a row it can’t otherwise read: its Owner ID cell stays as it is', () => {
      const wb = versionTwo();
      setCell(wb, T.reviewItem, 1, 'Kind', 'Wish');
      const decoded = decodeOk(wb);
      expect(decoded.value.reviewItems).toEqual([ITEMS[1]]);
      expect(decoded.upgrade.filter((c) => c.tab === T.reviewItem && c.row === 2)).toEqual([]);
    });

    it('names an id only by a People row the decoder reads, so an item is never linked to another person of that name', () => {
      // The item's owner is a person whose row can't be read, named as a readable row further down.
      const wb = versionTwo();
      const unreadable = sample().people[0]!.id;
      setCell(wb, T.reviewItem, 1, 'Owner ID', unreadable);
      setCell(wb, T.person, rowOf(wb, T.person, unreadable), 'Name', 'Priya Shah');
      setCell(wb, T.person, rowOf(wb, T.person, unreadable), 'Side', 'Nobody');
      const decoded = decodeOk(wb);
      expect(decoded.value.people.map((p) => p.id)).not.toContain(unreadable);
      expect(decoded.upgrade.filter((c) => c.tab === T.reviewItem && c.row === 2).map((c) => c.col)).toEqual([8]);
      expect(decoded.value.reviewItems[0]).toMatchObject({ id: ITEMS[0]!.id, ownerId: null });
    });

    it('leaves an id alone whose name another row has too, so the name never points at someone else', () => {
      const wb = versionTwo();
      setCell(wb, T.person, 1, 'Name', 'Priya Shah');
      const decoded = decodeOk(wb);
      expect(decoded.upgrade.filter((c) => c.tab === T.reviewItem && c.row === 2).map((c) => c.col)).toEqual([8]);
    });

    it('takes an upgrade made already, or a header typed by hand, as it is, and a missing column is named', () => {
      // A save already wrote the headers, but not the version: nothing is written twice.
      const half = versionTwo();
      const upgrade = decodeOk(versionTwo()).upgrade.filter((c) => c.tab !== '_meta');
      for (const cell of upgrade) half[cell.tab]![cell.row - 1]![cell.col] = cell.value;
      expect(decodeOk(half).upgrade).toEqual([{ tab: '_meta', row: 2, col: 1, value: 3, anchorCol: 0 }]);
      const renamed = versionTwo();
      setCell(renamed, T.reviewItem, 0, 'Owner ID', 'Who');
      expect(decodeError(renamed)).toMatchObject({ kind: 'missing_column', tab: 'Review items', message: expect.stringContaining('Owner') });
    });
  });

  it('upgrades a version 1 file whose review tab a save already made, and leaves a review tab with anything in it alone', () => {
    const made = versionOne();
    made[T.review] = [];
    expect(decodeOk(made).upgrade.filter((c) => c.tab === T.review)).toHaveLength(MAP_LAYOUT.columns.review.length);
    const typed = versionOne();
    typed[T.review] = [['My own notes']];
    expect(decodeError(typed)).toMatchObject({ kind: 'missing_column', tab: 'Reviews' });
  });

  it('reads a number typed as "12k" as empty, with an issue, and keeps the row', () => {
    const wb = encoded(reviewed());
    setCell(wb, T.reviewNumber, 1, 'Actual', '12k');
    const decoded = decodeOk(wb);
    expect(decoded.value.reviewNumbers[0]).toEqual({ ...NUMBERS[0]!, actual: null });
    expect(decoded.issues).toEqual([{ tab: 'Review numbers', row: 2, message: 'Actual must be a number, like 12000 or 12.5, or empty' }]);
    expect(decoded.unreadable.get(NUMBERS[0]!.id)).toEqual(new Set(['actual']));
  });

  it('reads numbers loosely: a number cell, decimals and a label in any case', () => {
    const wb = encoded(reviewed());
    setCell(wb, T.reviewNumber, 2, 'Target', ' 12000.75 ');
    setCell(wb, T.reviewNumber, 2, 'Number', 'WE BILL');
    setCell(wb, T.reviewItem, 2, 'Answer', 'doesnt hold');
    const decoded = decodeOk(wb);
    expect(decoded.value.reviewNumbers[1]).toEqual({ ...NUMBERS[1]!, target: 12000.75 });
    expect(decoded.value.reviewItems[1]!.answer).toBe('doesnt_hold');
    expect(decoded.issues).toEqual([]);
  });

  it('leaves out numbers and items whose review row is gone, and an item of a kind it doesn’t know, with issues', () => {
    const wb = encoded(reviewed());
    wb[T.review] = wb[T.review]!.slice(0, 1);
    const orphans = decodeOk(wb);
    expect(orphans.value).toEqual(sample());
    expect(orphans.issues).toEqual([
      { tab: 'Review numbers', row: 2, message: 'Review ID: no row on the "Reviews" tab has this ID, or that row can’t be read' },
      { tab: 'Review numbers', row: 3, message: 'Review ID: no row on the "Reviews" tab has this ID, or that row can’t be read' },
      { tab: 'Review items', row: 2, message: 'Review ID: no row on the "Reviews" tab has this ID, or that row can’t be read' },
      { tab: 'Review items', row: 3, message: 'Review ID: no row on the "Reviews" tab has this ID, or that row can’t be read' },
    ]);
    expect([...orphans.locations.keys()].filter((id) => /^r[ni]_/.test(id))).toEqual([]);

    const unknown = encoded(reviewed());
    setCell(unknown, T.reviewItem, 1, 'Kind', 'SECRET wish');
    const decoded = decodeOk(unknown);
    expect(decoded.value.reviewItems).toEqual([ITEMS[1]]);
    expect(decoded.issues).toEqual([{ tab: 'Review items', row: 2, message: 'Kind must be one of Not done, Blocker, Commitment, Hypothesis' }]);
  });

  it('knows a file that isn’t ours, one too new, a missing tab and a missing column', () => {
    const noMeta = encoded();
    delete noMeta['_meta'];
    expect(decodeError(noMeta)).toMatchObject({ kind: 'not_ours' });
    const newer = encoded();
    newer['_meta']![1]![1] = 4;
    expect(decodeError(newer)).toMatchObject({ kind: 'newer_version' });
    const noTab = encoded();
    delete noTab[T.activity];
    expect(decodeError(noTab)).toEqual({ kind: 'missing_tab', tab: 'Activities', message: 'The "Activities" tab is missing' });
    const noPlan = encoded();
    delete noPlan[T.plan];
    expect(decodeError(noPlan)).toEqual({ kind: 'missing_tab', tab: 'Plan', message: 'The "Plan" tab is missing' });
    const noColumn = encoded();
    noColumn[T.person]![0]![2] = 'Full name';
    expect(decodeError(noColumn)).toEqual({ kind: 'missing_column', tab: 'People', message: 'The "People" tab is missing the "Name" column' });
  });

  it('needs the partner type id and the partner type on the Plan tab', () => {
    const noId = encoded();
    noId[T.plan] = noId[T.plan]!.filter((row) => row[0] !== 'Partner type id');
    expect(decodeError(noId)).toEqual({ kind: 'missing_row', tab: 'Plan', message: 'The "Partner type id" row is missing' });
    const blankId = encoded();
    setPlan(blankId, 'Partner type id', ' ');
    expect(decodeError(blankId)).toEqual({ kind: 'missing_row', tab: 'Plan', message: 'Partner type id is empty' });
    const badType = encoded();
    setPlan(badType, 'Partner type', 'SECRET');
    expect(decodeError(badType)).toMatchObject({ kind: 'missing_row', tab: 'Plan' });
    expect(decodeError(badType).message).not.toContain('SECRET');
  });

  it('reads the Plan tab by label, in any order, and loose labels and values', () => {
    const wb = encoded();
    wb[T.plan] = [wb[T.plan]![0]!, ...wb[T.plan]!.slice(1).reverse()];
    setPlan(wb, 'Horizon length', '60 days');
    setPlan(wb, 'Partner type', 'reseller');
    wb[T.plan]!.find((row) => row[0] === 'Next review')![0] = 'next REVIEW';
    const decoded = decodeOk(wb);
    expect(decoded.value.info).toEqual({ ...sample().info, horizonDays: 60 });
    expect(decoded.issues).toEqual([]);
  });

  it('keeps reading the MAP when a Plan value can’t be read: the default stands in, with an issue, and the value is marked', () => {
    const wb = encoded();
    setPlan(wb, 'Horizon length', 'SECRET-1');
    setPlan(wb, 'Next review', 'SECRET-2');
    const decoded = decodeOk(wb);
    expect(decoded.value.info).toEqual({ ...sample().info, horizonDays: 90, nextReviewDate: null });
    expect(decoded.issues).toEqual([
      { tab: 'Plan', row: 4, message: 'Horizon length must be a whole number of days from 7 to 730' },
      { tab: 'Plan', row: 6, message: 'Next review: use a date like 2026-10-21 (YYYY-MM-DD)' },
    ]);
    expect(decoded.unreadablePlan).toEqual(new Set(['horizonDays', 'nextReviewDate']));
    expect(decoded.planRows).toEqual({ partnerId: 2, partnerType: 3, horizonDays: 4, laterHorizons: 5, nextReviewDate: 6 });
  });

  it('reads a MAP without the optional Plan rows, and names a missing Horizon length', () => {
    const wb = encoded();
    wb[T.plan] = wb[T.plan]!.filter((row) => !['Later horizons', 'Next review', 'Horizon length'].includes(String(row[0])));
    const decoded = decodeOk(wb);
    expect(decoded.value.info).toEqual({ ...sample().info, horizonDays: 90, nextReviewDate: null });
    expect(decoded.issues).toEqual([{ tab: 'Plan', row: 0, message: 'The "Horizon length" row is missing' }]);
    expect(decoded.planRows).toEqual({ partnerId: 2, partnerType: 3 });
  });

  it('keeps the later horizons it can read, and says the row needs attention', () => {
    const wb = encoded();
    setPlan(wb, 'Later horizons', '2027-01-30 · 60 days; SECRET; 2027-04-01 | 120d');
    const decoded = decodeOk(wb);
    expect(decoded.value.info.laterHorizons).toEqual([{ startDate: '2027-01-30', horizonDays: 60 }, { startDate: '2027-04-01', horizonDays: 120 }]);
    expect(decoded.issues).toEqual([
      { tab: 'Plan', row: 5, message: 'Later horizons: write each one like “2026-07-20 · 90 days”, separated by semicolons' },
    ]);
    expect(decoded.unreadablePlan).toEqual(new Set(['laterHorizons']));
  });

  it('reads lists loosely: case, spaces and the MAP app’s other words', () => {
    const wb = encoded();
    setCell(wb, T.activity, 1, 'Status', 'completed');
    setCell(wb, T.activity, 2, 'Category', ' MARKETING ');
    setCell(wb, T.person, 1, 'Role', 'sponsor');
    const decoded = decodeOk(wb);
    expect(decoded.value.activities[0]!.status).toBe('done');
    expect(decoded.value.activities[1]!.category).toBe('marketing');
    expect(decoded.value.people[0]!.role).toBe('exec_sponsor');
    expect(decoded.issues).toEqual([]);
  });

  it('leaves out a row that can’t be read, with an issue that names the column and never the cell', () => {
    const wb = encoded();
    const plan = sample();
    setCell(wb, T.activity, 2, 'Status', 'SECRET-1');
    setCell(wb, T.activity, 3, 'Activity', ' ');
    setCell(wb, T.objective, 1, 'Side', '');
    const decoded = decodeOk(wb);
    expect(decoded.value.activities.map((a) => a.id)).toEqual(plan.activities.filter((_, i) => i !== 1 && i !== 2).map((a) => a.id));
    expect(decoded.value.objectives.map((o) => o.id)).toEqual(plan.objectives.slice(1).map((o) => o.id));
    expect(decoded.issues).toEqual([
      { tab: 'Objectives', row: 2, message: 'Side is empty' },
      { tab: 'Activities', row: 3, message: 'Status must be one of Not started, In progress, Blocked, Done, N/A' },
      { tab: 'Activities', row: 4, message: 'Activity title is required' },
    ]);
    expect(decoded.locations.has(plan.activities[1]!.id)).toBe(false);
  });

  it('keeps a row whose owner or milestone names nobody, with that link empty and marked', () => {
    const wb = encoded();
    const plan = sample();
    setCell(wb, T.activity, 1, 'Owner', 'SECRET Person');
    setCell(wb, T.activity, 2, 'Milestone', 'day 30:  partner ENABLED');
    const decoded = decodeOk(wb);
    expect(decoded.value.activities[0]).toEqual({ ...plan.activities[0]!, ownerId: null });
    // Names are matched loosely: case and spaces.
    expect(decoded.value.activities[1]!.milestoneId).toBe('m_sample1');
    expect(decoded.issues).toEqual([{ tab: 'Activities', row: 2, message: 'Owner: no row on the "People" tab has this name, or that row can’t be read' }]);
    expect(decoded.unreadable.get(plan.activities[0]!.id)).toEqual(new Set(['ownerId']));
  });

  it('links an owner on a person’s row that can’t be read to nobody', () => {
    const wb = encoded();
    const plan = sample();
    const owner = plan.people.find((p) => p.id === plan.activities[0]!.ownerId)!;
    setCell(wb, T.person, rowOf(wb, T.person, owner.id), 'Email', 'not an email');
    setCell(wb, T.person, rowOf(wb, T.person, owner.id), 'Name', '');
    const decoded = decodeOk(wb);
    expect(decoded.value.people.map((p) => p.id)).not.toContain(owner.id);
    expect(decoded.value.activities.filter((a) => a.ownerId === owner.id)).toEqual([]);
  });

  it('links a name two people share to the first of them, and says so on the second', () => {
    const wb = encoded();
    const plan = sample();
    const first = plan.people[0]!;
    setCell(wb, T.person, 2, 'Name', first.name.toUpperCase());
    const decoded = decodeOk(wb);
    expect(decoded.value.people).toHaveLength(plan.people.length);
    expect(decoded.issues).toEqual([{ tab: 'People', row: 3, message: 'Name: an earlier row on the "People" tab has the same name. Add something to tell them apart.' }]);
    const owned = decoded.value.activities.filter((a) => plan.activities.find((b) => b.id === a.id)!.ownerId === first.id);
    expect(owned.every((a) => a.ownerId === first.id)).toBe(true);
  });

  it('gives a row typed without an ID a provisional one, and keeps both rows of a pasted copy', () => {
    const wb = encoded();
    wb[T.exitTrigger]!.push(['', 'No deals in 60 days', 'Watch']);
    wb[T.objective]!.push([...wb[T.objective]![1]!]);
    const decoded = decodeOk(wb);
    const last = wb[T.exitTrigger]!.length;
    expect(decoded.value.exitTriggers.at(-1)).toEqual({ id: `tmp_exitTrigger_${last}`, condition: 'No deals in 60 days', status: 'watch' });
    const copyRow = wb[T.objective]!.length;
    expect(decoded.missingIds).toEqual([
      { entity: 'objective', row: copyRow, provisionalId: `tmp_objective_${copyRow}` },
      { entity: 'exitTrigger', row: last, provisionalId: `tmp_exitTrigger_${last}` },
    ]);
    expect(decoded.issues).toEqual([{ tab: 'Objectives', row: copyRow, message: 'Duplicate ID: a new one will be assigned on the next save' }]);
  });

  it('reads an unreadable Last updated as empty, keeping the activity', () => {
    const wb = encoded();
    setCell(wb, T.activity, 1, 'Last updated', 'SECRET');
    setCell(wb, T.activity, 1, 'Updated by', '');
    const decoded = decodeOk(wb);
    expect(decoded.value.activities[0]).toMatchObject({ updatedAt: null, updatedBy: null });
    expect(decoded.issues).toEqual([{ tab: 'Activities', row: 2, message: 'Last updated: couldn\'t read this timestamp; it will be reset on the next save' }]);
  });

  it('reads serial dates and keeps the person’s own columns out of the plan', () => {
    const wb = encoded();
    setCell(wb, T.milestone, 1, 'Target date', 46000);
    wb[T.milestone]![0]!.push('My notes');
    wb[T.milestone]![1]!.push('Ask Tom');
    const decoded = decodeOk(wb);
    expect(decoded.value.milestones[0]!.targetDate).toBe('2025-12-09');
    expect(decoded.issues).toEqual([]);
  });
});

describe('later horizons', () => {
  it('writes a short list people can read, and reads it back', () => {
    const horizons = [{ startDate: '2027-01-30', horizonDays: 60 }, { startDate: '2027-04-01', horizonDays: 120 }];
    expect(formatLaterHorizons(horizons)).toBe('2027-01-30 · 60 days; 2027-04-01 · 120 days');
    expect(parseLaterHorizons(formatLaterHorizons(horizons))).toEqual({ ok: true, value: horizons });
  });

  it('reads an empty cell as none, and loose hand edits', () => {
    expect(parseLaterHorizons(null)).toEqual({ ok: true, value: [] });
    expect(parseLaterHorizons('')).toEqual({ ok: true, value: [] });
    expect(parseLaterHorizons('2027-01-30 | 60d\n2027-04-01·120 Days')).toEqual({
      ok: true, value: [{ startDate: '2027-01-30', horizonDays: 60 }, { startDate: '2027-04-01', horizonDays: 120 }],
    });
  });

  it('keeps the entries it can read, and refuses a cell that isn’t text', () => {
    expect(parseLaterHorizons('2027-01-30 · 60 days; soon; 2027-02-30 · 60 days; 2027-05-01 · 3 days')).toEqual({
      ok: false, value: [{ startDate: '2027-01-30', horizonDays: 60 }],
    });
    expect(parseLaterHorizons(42)).toEqual({ ok: false, value: [] });
  });
});
