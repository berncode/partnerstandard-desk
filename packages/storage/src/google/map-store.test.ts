// The Google side of a MAP's file: what is made in Drive, its name, tabs and dropdowns; which cells a change writes;
// and hand edits it never writes over. The shared cases are in the contract.
import { describe, expect, it } from 'vitest';
import type { MapChange, MapPlan, MapRecord } from '@partner-desk/core';
import { NOW } from '@partner-desk/core/test-builders';
import { buildSamplePlan, buildSampleRecord, PARTNER_TYPE_LABELS } from '@partner-desk/method';
import type { Cell, Workbook } from '../sheet-codec/grid';
import { MAP_LAYOUT } from '../sheet-codec/map-layout';
import { asMapVersion2 } from '../sheet-codec/test-fixtures';
import type { MapFileChange } from '../types';
import { FakeGoogle, fakeClient } from './fake-google';
import { MemoryFolderStore } from './folders';
import { createGoogleMapStore, mapFileName } from './map-store';

const owner = { userId: 'u_1', displayName: 'Anna Keller' };
const stamp = { now: NOW, actor: 'Ruth' };
const TODAY = NOW.slice(0, 10);
const T = MAP_LAYOUT.tabs;
const record = buildSampleRecord(TODAY) as MapRecord;
const change = (c: MapChange, r: MapRecord = record): MapFileChange => ({ ...c, record: r });
type ValuesBody = { valueInputOption: string; data: Array<{ range: string; values: Cell[][] }> };

function setup() {
  const fake = new FakeGoogle();
  return { fake, maps: createGoogleMapStore({ client: fakeClient(fake), folders: new MemoryFolderStore(), appBaseUrl: 'https://desk.test' }) };
}

async function made() {
  const env = setup();
  const plan = buildSamplePlan(TODAY) as MapPlan;
  const { fileId } = await env.maps.create(owner, 'co_abcdefghij', plan, 'Brightwave Systems');
  return { ...env, plan, fileId };
}

const header = (wb: Workbook, tab: string) => wb[tab]![0]!;
const cellAt = (wb: Workbook, tab: string, id: string, name: string) => wb[tab]!.find((row) => row[0] === id)![header(wb, tab).indexOf(name)];
/** The cell writes of the last values write, as "range: values". */
function lastValueWrites(fake: FakeGoogle): string[] {
  const writes = fake.calls.filter((c) => c.method === 'POST' && c.url.pathname.endsWith('/values:batchUpdate'));
  return (writes.at(-1)!.body as ValuesBody).data.map((d) => `${d.range}: ${JSON.stringify(d.values[0])}`);
}

describe('Google MAP files', () => {
  it('makes one spreadsheet per MAP in PartnerStandard / PartnerStandard Desk, named by partner and type', async () => {
    const { fake, maps, fileId } = await made();
    const sheet = fake.spreadsheet(fileId)!;
    expect(sheet.name).toBe('PartnerStandard Desk – MAP – Brightwave Systems as Reseller');
    expect(mapFileName('Acme', 'var')).toBe('PartnerStandard Desk – MAP – Acme as Value Added Reseller');
    const [root, desk] = fake.folders();
    expect([root!.name, desk!.name]).toEqual(['PartnerStandard', 'PartnerStandard Desk']);
    expect(sheet.parents).toEqual([desk!.id]);
    expect(maps.urlFor({ fileId })).toBe(`https://docs.google.com/spreadsheets/d/${fileId}/edit`);
    const tabs = [...sheet.sheets].sort((a, b) => a.index - b.index);
    expect(tabs.map((t) => t.title)).toEqual([
      'Start here', 'Plan', 'Objectives', 'Activities', 'People', 'Milestones', 'Exit Triggers', 'Reviews', 'Review numbers', 'Review items', '_meta',
    ]);
    expect(tabs.filter((t) => t.hidden).map((t) => t.title)).toEqual(['_meta']);
    expect(tabs.filter((t) => t.frozenRows === 1).map((t) => t.title)).toEqual([
      'Plan', 'Objectives', 'Activities', 'People', 'Milestones', 'Exit Triggers', 'Reviews', 'Review numbers', 'Review items',
    ]);
    const wb = fake.getWorkbook(fileId);
    expect(wb['_meta']).toEqual([['key', 'value'], ['schemaVersion', 3], ['companyId', 'co_abcdefghij'], ['createdWith', 'desk.partnerstandard.com']]);
    expect(wb[T.start]!.flat()).toContain('https://desk.test/plans');
  });

  it('protects the ID columns and the Plan tab’s labels, and gives every list its dropdown', async () => {
    const { fake, fileId } = await made();
    const sheet = fake.spreadsheet(fileId)!;
    const idOf = (title: string) => sheet.sheets.find((s) => s.title === title)!.sheetId;
    for (const tab of [T.plan, T.objective, T.activity, T.person, T.milestone, T.exitTrigger, T.review, T.reviewNumber, T.reviewItem]) {
      expect(sheet.protections, tab).toContainEqual(expect.objectContaining({ range: { sheetId: idOf(tab), startColumnIndex: 0, endColumnIndex: 1 }, warningOnly: true }));
    }
    type Validation = { range: { sheetId: number; startRowIndex: number; endRowIndex: number; startColumnIndex: number }; rule: { condition: { values: Array<{ userEnteredValue: string }> } } };
    const lists = (sheet.validations as Validation[]).map((v) => [
      sheet.sheets.find((s) => s.sheetId === v.range.sheetId)!.title, v.range.startColumnIndex, v.rule.condition.values.map((c) => c.userEnteredValue).join('|'),
    ]);
    expect(lists).toEqual([
      ['Plan', 1, Object.values(PARTNER_TYPE_LABELS).join('|')],
      ['Objectives', 1, 'Us|Partner'],
      ['Activities', 2, 'Sales|Marketing|Product|Other'],
      ['Activities', 3, 'Us|Partner|Joint'],
      ['Activities', 6, 'Not started|In progress|Blocked|Done|N/A'],
      ['People', 1, 'Us|Partner'],
      ['People', 5, 'Executive Sponsor|Partner Manager|Sales Lead|Marketing Lead|Technical Lead|Other'],
      ['Exit Triggers', 2, 'OK|Watch|Triggered'],
      ['Reviews', 2, 'Prep started|Held'],
      ['Review numbers', 2, 'Deals won|We bill|The partner earns|Open deals|Open deals value|Number by partner category|Would recommend us (0 to 10)'],
      ['Review numbers', 5, 'Assumption|Finance|Sales|Partner|Other'],
      ['Review items', 2, 'Not done|Blocker|Commitment|Hypothesis'],
      ['Review items', 5, 'Us|Partner|Joint'],
      ['Review items', 9, 'Holds|Changed|Doesn’t hold'],
    ]);
    // The Partner type dropdown sits on its own row of the Plan tab.
    const planType = (sheet.validations as Validation[])[0]!;
    expect([planType.range.startRowIndex, planType.range.endRowIndex]).toEqual([2, 3]);
  });

  it('writes a status change to its own cells only, as RAW', async () => {
    const { fake, maps, fileId, plan } = await made();
    const open = plan.activities.find((a) => a.status === 'not_started')!;
    const row = plan.activities.indexOf(open) + 2;
    const result = await maps.apply({ fileId }, change({ kind: 'update', entity: 'activity', id: open.id, patch: { status: 'done' }, expectedUpdatedAt: open.updatedAt }), stamp);
    expect(result.ok).toBe(true);
    // Status (G), Completed date (H), Last updated (K) and Updated by (L); the cells between are left alone.
    expect(lastValueWrites(fake)).toEqual([`'Activities'!G${row}:L${row}: ["Done","${TODAY}",null,null,"${NOW}","Ruth"]`]);
  });

  it('rewrites the Owner cells of a renamed person’s activities, and nothing else of them', async () => {
    const { fake, maps, fileId, plan } = await made();
    const priya = plan.people.find((p) => p.name === 'Priya Shah')!;
    const owned = plan.activities.filter((a) => a.ownerId === priya.id);
    expect(owned.length).toBeGreaterThan(1);
    expect((await maps.apply({ fileId }, change({ kind: 'update', entity: 'person', id: priya.id, patch: { name: 'Priya Shah-Lee' } }), stamp)).ok).toBe(true);
    const personRow = plan.people.indexOf(priya) + 2;
    expect(lastValueWrites(fake)).toEqual([
      ...owned.map((a) => `'Activities'!E${plan.activities.indexOf(a) + 2}:E${plan.activities.indexOf(a) + 2}: ["Priya Shah-Lee"]`),
      `'People'!C${personRow}:C${personRow}: ["Priya Shah-Lee"]`,
    ]);
    const wb = fake.getWorkbook(fileId);
    for (const a of owned) expect(cellAt(wb, T.activity, a.id, 'Owner')).toBe('Priya Shah-Lee');
  });

  it('never writes over an Owner that names nobody, unless the change sets the owner', async () => {
    const { fake, maps, fileId, plan } = await made();
    const activity = plan.activities[0]!;
    const wb = fake.getWorkbook(fileId);
    wb[T.activity]!.find((row) => row[0] === activity.id)![header(wb, T.activity).indexOf('Owner')] = 'Somebody new';
    fake.setWorkbook(fileId, wb);
    const read = await maps.read({ fileId });
    expect(read.ok && read.snapshot.value.activities[0]!.ownerId).toBeNull();

    await maps.apply({ fileId }, change({ kind: 'update', entity: 'activity', id: activity.id, patch: { note: 'Moved to Monday' } }), stamp);
    expect(cellAt(fake.getWorkbook(fileId), T.activity, activity.id, 'Owner')).toBe('Somebody new');
    // A person called that is added: the cell now names them.
    const added = await maps.apply({ fileId }, change({ kind: 'add', entity: 'person', values: { side: 'us', name: 'Somebody New', role: 'other' } }), stamp);
    const now = await maps.read({ fileId });
    expect(now.ok && now.snapshot.value.activities[0]!.ownerId).toBe(added.ok && added.entityId);

    await maps.apply({ fileId }, change({ kind: 'update', entity: 'activity', id: activity.id, patch: { ownerId: null } }), stamp);
    expect(cellAt(fake.getWorkbook(fileId), T.activity, activity.id, 'Owner')).toBe('');
  });

  it('writes plan details to their own Plan row, and adds a missing row back at the end', async () => {
    const { fake, maps, fileId } = await made();
    await maps.apply({ fileId }, change({ kind: 'updateInfo', patch: { nextReviewDate: '2026-12-15' } }), stamp);
    expect(lastValueWrites(fake)).toEqual([`'Plan'!B6:B6: ["2026-12-15"]`]);

    const wb = fake.getWorkbook(fileId);
    wb[T.plan] = wb[T.plan]!.filter((row) => row[0] !== 'Next review');
    fake.setWorkbook(fileId, wb);
    await maps.apply({ fileId }, change({ kind: 'updateInfo', patch: { nextReviewDate: '2027-01-05' } }), stamp);
    expect(fake.getWorkbook(fileId)[T.plan]!.at(-1)).toEqual(['Next review', '2027-01-05']);
    const read = await maps.read({ fileId });
    expect(read.ok && read.snapshot.value.info.nextReviewDate).toBe('2027-01-05');
  });

  it('keeps a Horizon length it can’t read until a person sets the length', async () => {
    const { fake, maps, fileId, plan } = await made();
    const wb = fake.getWorkbook(fileId);
    wb[T.plan]!.find((row) => row[0] === 'Horizon length')![1] = 'ninety';
    fake.setWorkbook(fileId, wb);
    await maps.apply({ fileId }, change({ kind: 'updateInfo', patch: { nextReviewDate: '2026-12-15' } }), stamp);
    expect(fake.getWorkbook(fileId)[T.plan]!.find((row) => row[0] === 'Horizon length')![1]).toBe('ninety');
    await maps.apply({ fileId }, change({ kind: 'updateInfo', patch: { horizonDays: plan.info.horizonDays } }), stamp);
    expect(fake.getWorkbook(fileId)[T.plan]!.find((row) => row[0] === 'Horizon length')![1]).toBe(plan.info.horizonDays);
    const read = await maps.read({ fileId });
    expect(read.ok && read.snapshot.issues).toEqual([]);
  });

  it('refuses a change that would write Later horizons it can’t read all of, and writes nothing', async () => {
    const { fake, maps, fileId } = await made();
    const wb = fake.getWorkbook(fileId);
    wb[T.plan]!.find((row) => row[0] === 'Later horizons')![1] = 'after the summer';
    fake.setWorkbook(fileId, wb);
    const message = 'PartnerStandard Desk can’t read all of the "Later horizons" row on the "Plan" tab. Fix it there first.';
    const start = await maps.apply({ fileId }, change({
      kind: 'startHorizon', expectedStartDate: record.signedDate!, expectedHorizon: 0, startDate: TODAY, horizonDays: 60, milestones: [],
    }), stamp);
    expect(start).toEqual({ ok: false, error: 'invalid', message });
    expect(await maps.apply({ fileId }, change({ kind: 'updateInfo', patch: { horizonDays: 60 } }), stamp)).toEqual({ ok: false, error: 'invalid', message });
    expect(fake.getWorkbook(fileId)).toEqual(wb);
    // Other changes still go through.
    expect((await maps.apply({ fileId }, change({ kind: 'updateInfo', patch: { nextReviewDate: null } }), stamp)).ok).toBe(true);
  });

  it('reads a version 1 file as it is, and makes its review tabs before _meta on the next save', async () => {
    const { fake, maps, fileId, plan } = await made();
    const old = fake.getWorkbook(fileId);
    for (const tab of [T.review, T.reviewNumber, T.reviewItem]) delete old[tab];
    old['_meta']![1]![1] = 1;
    fake.setWorkbook(fileId, old);
    const read = await maps.read({ fileId });
    expect(read).toMatchObject({ ok: true, snapshot: { value: plan, issues: [] } });
    expect(fake.getWorkbook(fileId)).toEqual(old);

    const activity = plan.activities[0]!;
    expect((await maps.apply({ fileId }, change({ kind: 'update', entity: 'activity', id: activity.id, patch: { note: 'Went well' } }), stamp)).ok).toBe(true);
    const sheet = fake.spreadsheet(fileId)!;
    const tabs = [...sheet.sheets].sort((a, b) => a.index - b.index);
    expect(tabs.map((t) => t.title)).toEqual([
      'Start here', 'Plan', 'Objectives', 'Activities', 'People', 'Milestones', 'Exit Triggers', 'Reviews', 'Review numbers', 'Review items', '_meta',
    ]);
    expect(tabs.filter((t) => t.frozenRows === 1).map((t) => t.title)).toContain('Review items');
    const wb = fake.getWorkbook(fileId);
    expect(wb[T.review]).toEqual([MAP_LAYOUT.columns.review.map((c) => c.header)]);
    expect(wb[T.reviewNumber]).toEqual([MAP_LAYOUT.columns.reviewNumber.map((c) => c.header)]);
    expect(wb[T.reviewItem]).toEqual([MAP_LAYOUT.columns.reviewItem.map((c) => c.header)]);
    expect(wb['_meta']![1]).toEqual(['schemaVersion', 3]);
    expect(cellAt(wb, T.activity, activity.id, 'Note')).toBe('Went well');
    const idOf = (title: string) => sheet.sheets.find((s) => s.title === title)!.sheetId;
    type Validation = { range: { sheetId: number; startColumnIndex: number }; rule: { condition: { values: Array<{ userEnteredValue: string }> } } };
    const lists = (sheet.validations as Validation[])
      .filter((v) => [idOf(T.review), idOf(T.reviewNumber), idOf(T.reviewItem)].includes(v.range.sheetId))
      .map((v) => [sheet.sheets.find((s) => s.sheetId === v.range.sheetId)!.title, v.range.startColumnIndex, v.rule.condition.values.map((c) => c.userEnteredValue).join('|')]);
    expect(lists).toEqual([
      ['Reviews', 2, 'Prep started|Held'],
      ['Review numbers', 2, 'Deals won|We bill|The partner earns|Open deals|Open deals value|Number by partner category|Would recommend us (0 to 10)'],
      ['Review numbers', 5, 'Assumption|Finance|Sales|Partner|Other'],
      ['Review items', 2, 'Not done|Blocker|Commitment|Hypothesis'],
      ['Review items', 5, 'Us|Partner|Joint'],
      ['Review items', 9, 'Holds|Changed|Doesn’t hold'],
    ]);
    for (const tab of [T.review, T.reviewNumber, T.reviewItem]) {
      expect(sheet.protections, tab).toContainEqual(expect.objectContaining({ range: { sheetId: idOf(tab), startColumnIndex: 0, endColumnIndex: 1 }, warningOnly: true }));
    }
    const again = await maps.read({ fileId });
    expect(again).toMatchObject({ ok: true, snapshot: { issues: [] } });
    expect(again.ok && again.snapshot.value.activities[0]!.note).toBe('Went well');
  });

  it('reads a version 2 file as the staging build wrote it, and upgrades it on the next save: names, Sent to, version 3', async () => {
    const { fake, maps, fileId, plan } = await made();
    const priya = plan.people.find((p) => p.name === 'Priya Shah')!;
    const day60 = plan.milestones[1]!;
    const added = await maps.applyMany({ fileId }, [
      { ...change({ kind: 'add', entity: 'review', values: { horizon: 1, nextHorizonDays: 90 } }), newId: 'rv_staging1' },
      change({
        kind: 'add', entity: 'reviewItem',
        values: { reviewId: 'rv_staging1', kind: 'commitment', title: 'Train five more sellers', side: 'partner', ownerId: priya.id, dueDate: '2027-01-20', milestoneId: day60.id },
      }),
      change({ kind: 'add', entity: 'reviewItem', values: { reviewId: 'rv_staging1', kind: 'hypothesis', refId: 'hy_staging1', answer: 'holds' } }),
    ], stamp);
    if (!added.ok) throw new Error('setup');
    const [, commitment, question] = added.entityIds as string[];
    const before = await maps.read({ fileId });
    if (!before.ok) throw new Error('setup');

    // The file as the staging build (format version 2) wrote it: no Sent to, and ids under Owner ID and Milestone ID.
    const v2 = asMapVersion2(fake.getWorkbook(fileId));
    expect(cellAt(v2, T.reviewItem, commitment!, 'Owner ID')).toBe(priya.id);
    fake.setWorkbook(fileId, v2);

    const read = await maps.read({ fileId });
    expect(read).toMatchObject({ ok: true, snapshot: { value: before.snapshot.value, issues: [] } });
    // A read never writes.
    expect(fake.getWorkbook(fileId)).toEqual(v2);

    const activity = plan.activities[0]!;
    expect((await maps.apply({ fileId }, change({ kind: 'update', entity: 'activity', id: activity.id, patch: { note: 'Went well' } }), stamp)).ok).toBe(true);
    const wb = fake.getWorkbook(fileId);
    expect(wb['_meta']![1]).toEqual(['schemaVersion', 3]);
    expect(header(wb, T.review)).toEqual([
      'ID', 'Horizon', 'State', 'Held on', 'Business case ID', 'Decisions', 'Relationship note', 'Next horizon (days)', 'Scorecard in summary',
      'Summary sent', 'Last updated', 'Updated by', 'Sent to',
    ]);
    expect(header(wb, T.reviewItem)).toEqual([
      'ID', 'Review ID', 'Kind', 'Activity or hypothesis ID', 'Title', 'Side', 'Owner', 'Due date', 'Milestone', 'Answer', 'Note', 'Moved to the plan',
    ]);
    expect(cellAt(wb, T.reviewItem, commitment!, 'Owner')).toBe('Priya Shah');
    expect(cellAt(wb, T.reviewItem, commitment!, 'Milestone')).toBe(day60.name);
    expect(cellAt(wb, T.reviewItem, question!, 'Activity or hypothesis ID')).toBe('hy_staging1');
    expect(cellAt(wb, T.activity, activity.id, 'Note')).toBe('Went well');
    const again = await maps.read({ fileId });
    expect(again).toMatchObject({ ok: true, snapshot: { issues: [] } });
    expect(again.ok && again.snapshot.value.reviewItems).toEqual(before.snapshot.value.reviewItems);

    // The upgraded file takes the names the summary went to in its new column.
    const sent = await maps.apply({ fileId }, change({ kind: 'update', entity: 'review', id: 'rv_staging1', patch: { summarySentTo: 'Lena Ortiz' } }), stamp);
    expect(sent.ok).toBe(true);
    expect(cellAt(fake.getWorkbook(fileId), T.review, 'rv_staging1', 'Sent to')).toBe('Lena Ortiz');
  });

  it('moves a deleted MAP to the Drive trash, never deleting it for good', async () => {
    const { fake, maps, fileId } = await made();
    await maps.trash({ fileId });
    expect(fake.spreadsheet(fileId)?.trashed).toBe(true);
  });
});
