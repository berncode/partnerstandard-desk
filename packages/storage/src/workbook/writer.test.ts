// The writer cases for both workbooks.
import { describe, expect, it } from 'vitest';
import { deleteSectionChanges, type ChangeStamp, type MapChange, type MapPlan, type MapRecord, type MarketChange, type PartnerChange } from '@partner-desk/core';
import { NOW, sampleMarket } from '@partner-desk/core/test-builders';
import { buildSamplePlan, buildSampleRecord } from '@partner-desk/method';
import { decodeMap, decodeMarket, decodePartnerBook, type DecodeErrorKind } from '../sheet-codec/decode';
import { encodeMap, encodeMarket, encodePartnerBook } from '../sheet-codec/encode';
import type { Cell, Workbook } from '../sheet-codec/grid';
import { MARKET_LAYOUT, PARTNERS_LAYOUT } from '../sheet-codec/layouts';
import { MAP_LAYOUT } from '../sheet-codec/map-layout';
import { asMapVersion2, asMarketVersion1, asPartnersVersion2, asPartnersVersion3, bookWithProposals, MARKET_META, PARTNERS_META, richBook } from '../sheet-codec/test-fixtures';
import { rowChecks } from '../google/row-checks';
import { appendRows } from './append-rows';
import { applyWrites, decodeFailure, MAP_SPEC, MARKET_SPEC, PARTNERS_SPEC, planChanges, type ChangesPlan } from './writer';

const P = PARTNERS_LAYOUT.tabs;
const M = MARKET_LAYOUT.tabs;
const book = () => encodePartnerBook(richBook(), PARTNERS_META);
const market = () => encodeMarket(sampleMarket(), MARKET_META);
/** The 0-based column of a partner field in a new file. */
const col = (key: string) => PARTNERS_LAYOUT.columns.partner.findIndex((c) => c.key === key);
/** The version 4 to 5 upgrade's write: the Proposals tab's header row, on a tab that has none, checked blank. */
const PROPOSALS_HEADER_WRITE = {
  op: 'update', tab: P.proposalItem, row: 1, expectId: '', idCol: 0,
  cells: PARTNERS_LAYOUT.columns.proposalItem.map((c, i) => ({ col: i, value: c.header })),
  expectCells: PARTNERS_LAYOUT.columns.proposalItem.map((_, i) => ({ col: i, value: '' })),
};

function makeStamp(): ChangeStamp {
  let n = 0;
  return { now: NOW, actor: 'Ruth', newId: (entity) => `${entity}_new${++n}` };
}

function ok<T, E extends string>(result: ChangesPlan<T, E>) {
  if (!result.ok) throw new Error(`${result.error}: ${result.message}`);
  return result;
}

function runBook(wb: Workbook, ...changes: PartnerChange[]) {
  const result = ok(planChanges(PARTNERS_SPEC, wb, changes, makeStamp()));
  const next = applyWrites(wb, result.writes);
  const decoded = decodePartnerBook(next);
  if (!decoded.ok) throw new Error(decoded.error.message);
  return { result, next, decoded: decoded.value };
}

function runMarket(wb: Workbook, ...changes: MarketChange[]) {
  const result = ok(planChanges(MARKET_SPEC, wb, changes, makeStamp()));
  const next = applyWrites(wb, result.writes);
  const decoded = decodeMarket(next);
  if (!decoded.ok) throw new Error(decoded.error.message);
  return { result, next, decoded: decoded.value };
}

/** Sets a cell by header name. `row` is the array index (0 = header). */
function setCell(wb: Workbook, tab: string, row: number, header: string, value: Cell) {
  const index = wb[tab]![0]!.indexOf(header);
  if (index === -1) throw new Error(`no column ${header}`);
  wb[tab]![row]![index] = value;
}

const infoRow = (wb: Workbook, label: string) => wb[M.info]!.find((row) => row[0] === label)!;

describe('planChanges: entity rows', () => {
  it('writes only the changed cells of the changed row, and its Updated and Updated by cells', () => {
    const { result, decoded } = runBook(book(), { kind: 'update', entity: 'partner', id: 'p_3', patch: { whyItFits: 'Sells to our buyers' } });
    expect(result.writes).toEqual([{
      op: 'update', tab: 'Partners', row: 4, expectId: 'p_3', idCol: 0,
      cells: [{ col: col('whyItFits'), value: 'Sells to our buyers' }, { col: col('updatedAt'), value: NOW }, { col: col('updatedBy'), value: 'Ruth' }],
    }]);
    expect(decoded.value.partners.find((p) => p.id === 'p_3')).toMatchObject({ whyItFits: 'Sells to our buyers', updatedAt: NOW, updatedBy: 'Ruth' });
    expect(decoded.issues).toEqual([]);
  });

  it('writes a company’s facts on its Accounts row', () => {
    const { result, decoded } = runBook(book(), { kind: 'update', entity: 'account', id: 'a_2', patch: { comments: 'Met at a fair' } });
    const account = (key: string) => PARTNERS_LAYOUT.columns.account.findIndex((c) => c.key === key);
    expect(result.writes).toEqual([{
      op: 'update', tab: 'Accounts', row: 3, expectId: 'a_2', idCol: 0,
      cells: [{ col: account('comments'), value: 'Met at a fair' }, { col: account('updatedAt'), value: NOW }, { col: account('updatedBy'), value: 'Ruth' }],
    }]);
    expect(decoded.value.accounts.find((a) => a.id === 'a_2')).toMatchObject({ comments: 'Met at a fair', updatedAt: NOW });
  });

  it('names only the sub-fields a partial patch carries', () => {
    const { result, decoded } = runBook(book(), { kind: 'update', entity: 'partner', id: 'p_1', patch: { desk: { credibility: 1 } } });
    // Credibility is already 1: the named cell is rewritten anyway, its siblings are not.
    expect(result.writes[0]!.op === 'update' && result.writes[0]!.cells.map((c) => c.col)).toEqual([col('desk.credibility'), col('updatedAt'), col('updatedBy')]);
    expect(decoded.value.partners[0]!.desk).toEqual({ customerBase: 3, credibility: 1, capability: 3, commitment: null });
  });

  it('names a CASO letter’s answer or note on its own', () => {
    const wb = book();
    const { result } = runBook(wb, { kind: 'update', entity: 'qualification', id: 'q_1', patch: { caso: { culture: { note: 'Pragmatic' } } } });
    const header = wb[P.qualification]![0]!;
    expect(result.writes[0]).toMatchObject({ op: 'update', tab: P.qualification, row: 2, expectId: 'q_1' });
    expect(result.writes[0]!.op === 'update' && result.writes[0]!.cells[0]).toEqual({ col: header.indexOf('CASO: Culture note'), value: 'Pragmatic' });
  });

  it('refuses a stale update as a conflict and plans no writes', () => {
    const result = planChanges(PARTNERS_SPEC, book(), [
      { kind: 'update', entity: 'partner', id: 'p_1', patch: { whyItFits: 'x' }, expectedUpdatedAt: '2000-01-01T00:00:00.000Z' },
    ], makeStamp());
    expect(result).toMatchObject({ ok: false, error: 'conflict' });
  });

  it('reports a missing tab as a structure error naming it', () => {
    const wb = book();
    delete wb[P.person];
    expect(planChanges(PARTNERS_SPEC, wb, [{ kind: 'delete', entity: 'call', id: 'k_1' }], makeStamp())).toEqual({
      ok: false, error: 'structure', tab: 'People', message: 'The "People" tab is missing',
    });
  });

  it('never touches columns the app does not own, even when reordered', () => {
    const wb = book();
    wb[P.call] = wb[P.call]!.map((row, i) => [i === 0 ? 'My notes' : `keep ${i}`, ...row.slice().reverse()]);
    const { next, decoded } = runBook(wb, { kind: 'update', entity: 'call', id: 'k_1', patch: { notes: 'Pricing sent' } });
    expect(next[P.call]!.map((row) => row[0])).toEqual(['My notes', 'keep 1']);
    expect(decoded.value.calls[0]!.notes).toBe('Pricing sent');
  });

  it('appends a new row with every known column and a new id', () => {
    const { result, next, decoded } = runMarket(market(), { kind: 'add', entity: 'exclusion', values: { company: 'Psi AG', reason: 'Too small' } });
    expect(result.entityIds).toEqual(['exclusion_new1']);
    expect(result.writes).toEqual([{
      op: 'append', tab: 'Exclusions',
      cells: [
        { col: 0, value: 'exclusion_new1' }, { col: 1, value: 'Psi AG' }, { col: 2, value: '' }, { col: 3, value: 'Too small' },
        { col: 4, value: NOW }, { col: 5, value: 'Ruth' },
      ],
    }]);
    expect(next[M.exclusion]![2]).toEqual(['exclusion_new1', 'Psi AG', '', 'Too small', NOW, 'Ruth']);
    expect(decoded.value.exclusions.map((x) => x.id)).toEqual(['x_1', 'exclusion_new1']);
  });

  it('appends after a row whose only content is in a column the user added', () => {
    const wb = market();
    const [header, first] = wb[M.exclusion]!;
    wb[M.exclusion] = [[...header!, 'My notes'], [...first!, ''], ['', '', '', '', '', '', 'Ask Omega again in May'], []];
    const { next } = runMarket(wb, { kind: 'add', entity: 'exclusion', values: { company: 'Psi AG' } });
    expect(next[M.exclusion]![2]).toEqual(['', '', '', '', '', '', 'Ask Omega again in May']);
    expect(next[M.exclusion]![3]).toEqual(['exclusion_new1', 'Psi AG', '', '', NOW, 'Ruth']);
  });

  it('never writes a row it could not decode, and keeps it byte-for-byte', () => {
    const wb = book();
    setCell(wb, P.partner, 2, 'Stage', 'Pending');
    setCell(wb, P.partner, 2, 'Why it fits', '=HYPERLINK("x")');
    const badRow = wb[P.partner]![2]!.slice();
    const changes: PartnerChange[] = [
      { kind: 'update', entity: 'partner', id: 'p_1', patch: { whyItFits: 'Called' } },
      { kind: 'setStep', partnerId: 'p_1', to: 'discovery_call' },
      { kind: 'add', entity: 'partner', values: { accountId: 'a_4', partnerType: 'var' } },
      { kind: 'delete', entity: 'partner', id: 'p_4' },
    ];
    for (const change of changes) {
      const { result, next, decoded } = runBook(wb, change);
      expect(result.writes.filter((w) => w.op !== 'append' && w.tab === P.partner && w.row === 3)).toEqual([]);
      expect(next[P.partner]!.find((row) => row[0] === 'p_2')).toEqual(badRow);
      expect(decoded.issues.map((i) => i.row)).toEqual([3]);
    }
  });

  it('assigns real ids to rows without one and accepts their provisional id', () => {
    const wb = book();
    setCell(wb, P.partner, 1, 'ID', '');
    setCell(wb, P.person, 1, 'ID', '');
    const { result, decoded } = runBook(wb, { kind: 'update', entity: 'person', id: 'tmp_person_2', patch: { title: 'CEO' } });
    // IDs are assigned in tab order: Accounts, then Partners, then People.
    expect(result.writes.find((w) => w.op === 'update' && w.tab === P.person)).toMatchObject({ row: 2, expectId: '' });
    expect(decoded.missingIds).toEqual([]);
    expect(decoded.value.partners[0]!.id).toBe('partner_new1');
    expect(decoded.value.people[0]).toMatchObject({ id: 'person_new2', title: 'CEO', accountId: 'a_1' });
    expect(decoded.issues).toEqual([]);
  });

  it('carries provisional ids through references in the change and in other rows', () => {
    const wb = book();
    setCell(wb, P.partner, 1, 'ID', '');
    const { decoded } = runBook(wb, { kind: 'add', entity: 'call', values: { partnerId: 'tmp_partner_2', date: '2026-10-20' } });
    expect(decoded.value.partners[0]!.id).toBe('partner_new1');
    expect(decoded.value.calls.at(-1)).toMatchObject({ partnerId: 'partner_new1', date: '2026-10-20' });
    // Rows that pointed at the row by its old id keep that id: the sheet holds it, and only the ID cell is written.
    expect(decoded.value.marketLinks[0]!.partnerId).toBe('p_1');
  });

  it('marks a change that names a row without an ID as positional', () => {
    const wb = book();
    setCell(wb, P.partner, 1, 'ID', '');
    const positional = (change: PartnerChange) => ok(planChanges(PARTNERS_SPEC, wb, [change], makeStamp())).positional;
    expect(positional({ kind: 'delete', entity: 'partner', id: 'tmp_partner_2' })).toBe(true);
    expect(positional({ kind: 'setStep', partnerId: 'tmp_partner_2', to: 'discovery_call' })).toBe(true);
    expect(positional({ kind: 'add', entity: 'call', values: { partnerId: 'tmp_partner_2' } })).toBe(true);
    expect(positional({ kind: 'update', entity: 'partner', id: 'p_3', patch: { whyItFits: 'x' } })).toBe(false);
    expect(positional({ kind: 'add', entity: 'call', values: { id: 'tmp_new', partnerId: 'p_3' } })).toBe(false);
  });

  it('marks a MAP change that names a review or an activity without an ID as positional', () => {
    const today = NOW.slice(0, 10);
    const plan: MapPlan = {
      ...(buildSamplePlan(today) as MapPlan),
      reviews: [{
        id: 'rv_1', horizon: 1, state: 'prep', heldOn: null, caseId: null, decisions: '', relationshipNote: '', nextHorizonDays: 90,
        includeScorecard: false, summarySentAt: null, summarySentTo: '', updatedAt: null, updatedBy: null,
      }],
    };
    const wb = encodeMap(plan, 'co_abcdefghij', { appUrl: 'https://desk.test/plans' });
    wb[MAP_LAYOUT.tabs.review]![1]![0] = '';
    wb[MAP_LAYOUT.tabs.activity]![1]![0] = '';
    const record = buildSampleRecord(today) as MapRecord;
    const positional = (change: MapChange) => ok(planChanges(MAP_SPEC, wb, [{ ...change, record }], makeStamp())).positional;
    expect(positional({ kind: 'add', entity: 'reviewNumber', values: { reviewId: 'tmp_review_2', key: 'dealsWon' } })).toBe(true);
    expect(positional({ kind: 'add', entity: 'reviewItem', values: { reviewId: 'tmp_review_2', kind: 'notDone', refId: 'tmp_activity_2' } })).toBe(true);
    expect(positional({ kind: 'add', entity: 'reviewItem', values: { reviewId: 'tmp_review_2', kind: 'hypothesis', refId: 'hy_1' } })).toBe(true);
    expect(positional({ kind: 'update', entity: 'objective', id: plan.objectives[0]!.id, patch: { statement: 'x' } })).toBe(false);
  });

  it('deletes last, giving a row without an ID its id first', () => {
    const wb = market();
    setCell(wb, M.exclusion, 1, 'ID', '');
    const { result, decoded } = runMarket(wb, { kind: 'delete', entity: 'exclusion', id: 'tmp_exclusion_2' });
    expect(result.writes).toEqual([
      { op: 'update', tab: 'Exclusions', row: 2, expectId: '', idCol: 0, cells: [{ col: 0, value: 'exclusion_new1' }] },
      { op: 'delete', tab: 'Exclusions', row: 2, expectId: 'exclusion_new1', idCol: 0 },
    ]);
    expect(decoded.value.exclusions).toEqual([]);
  });

  it('keeps references to a deleted row', () => {
    const { result, decoded } = runMarket(market(), { kind: 'delete', entity: 'hypothesis', id: 'h_1' });
    expect(result.writes).toEqual([{ op: 'delete', tab: 'Partner hypotheses', row: 2, expectId: 'h_1', idCol: 0 }]);
    expect(decoded.value.changes[0]!.entityId).toBe('h_1');
  });

  it('deletes a company’s last partner type, its people and the company in one batch', () => {
    const changes = deleteSectionChanges(richBook(), 'p_2');
    expect(changes).toEqual([
      { kind: 'delete', entity: 'partner', id: 'p_2' }, { kind: 'delete', entity: 'person', id: 'e_2' }, { kind: 'delete', entity: 'account', id: 'a_2' },
    ]);
    const { result, decoded } = runBook(book(), ...changes);
    expect(result.writes).toEqual([
      { op: 'delete', tab: 'Accounts', row: 3, expectId: 'a_2', idCol: 0 },
      { op: 'delete', tab: 'Partners', row: 3, expectId: 'p_2', idCol: 0 },
      { op: 'delete', tab: 'People', row: 3, expectId: 'e_2', idCol: 0 },
    ]);
    expect(decoded.value.accounts.map((a) => a.id)).toEqual(['a_1', 'a_4']);
    expect(decoded.value.partners.map((p) => p.id)).toEqual(['p_1', 'p_3', 'p_4']);
    expect(decoded.value.people.map((e) => e.id)).toEqual(['e_1']);
    // The market link of the deleted partner type stays, for the app to flag (no cascade).
    expect(decoded.value.marketLinks.map((l) => l.id)).toEqual(['l_1', 'l_2']);
    expect(decoded.issues).toEqual([]);
  });

  it('deletes several rows of one tab bottom row first, after the other writes', () => {
    const { result, decoded } = runBook(book(),
      { kind: 'delete', entity: 'partner', id: 'p_1' },
      { kind: 'update', entity: 'partner', id: 'p_3', patch: { whyItFits: 'Still here' } },
      { kind: 'delete', entity: 'partner', id: 'p_4' });
    expect(result.writes.map((w) => [w.op, w.op === 'append' ? null : w.row])).toEqual([['update', 4], ['delete', 5], ['delete', 2]]);
    expect(decoded.value.partners.map((p) => [p.id, p.whyItFits])).toEqual([['p_2', ''], ['p_3', 'Still here']]);
  });
});

describe('planChanges: a partner type whose company is missing', () => {
  it('is never written, through any save, and its company’s rows still are', () => {
    const wb = book();
    setCell(wb, P.partner, 2, 'Partner account', 'a_gone1');
    const handRow = wb[P.partner]![2]!.slice();
    const changes: PartnerChange[] = [
      { kind: 'update', entity: 'partner', id: 'p_1', patch: { whyItFits: 'Called' } },
      { kind: 'add', entity: 'partner', values: { accountId: 'a_2', partnerType: 'reseller' } },
      { kind: 'update', entity: 'account', id: 'a_2', patch: { comments: 'Still a partner' } },
      { kind: 'delete', entity: 'partner', id: 'p_4' },
    ];
    for (const change of changes) {
      const { result, next, decoded } = runBook(wb, change);
      expect(result.writes.filter((w) => w.op !== 'append' && w.tab === P.partner && w.row === 3)).toEqual([]);
      expect(next[P.partner]!.find((row) => row[0] === 'p_2')).toEqual(handRow);
      expect(decoded.issues.map((i) => [i.tab, i.row])).toEqual([[P.partner, 3]]);
    }
  });
});

describe('planChanges: a value the codec could not read is never written back', () => {
  it('leaves an unreadable score out of an update to another field of its row', () => {
    const wb = book();
    setCell(wb, P.partner, 1, 'Desk: Credibility', 'high');
    const { result, next, decoded } = runBook(wb, { kind: 'update', entity: 'partner', id: 'p_1', patch: { whyItFits: 'Called', desk: { capability: 2 } } });
    const cols = result.writes.flatMap((w) => (w.op === 'update' ? w.cells.map((c) => c.col) : []));
    expect(cols).not.toContain(col('desk.credibility'));
    expect(cols).toContain(col('desk.capability'));
    expect(next[P.partner]![1]![col('desk.credibility')]).toBe('high');
    expect(decoded.unreadable.get('p_1')).toEqual(new Set(['desk.credibility']));
  });

  it('leaves an unreadable value out when the row gets its id', () => {
    const wb = book();
    setCell(wb, P.person, 1, 'ID', '');
    setCell(wb, P.person, 1, 'Email', 'not an email');
    const { result, next } = runBook(wb, { kind: 'update', entity: 'person', id: 'tmp_person_2', patch: { title: 'CEO' } });
    const email = PARTNERS_LAYOUT.columns.person.findIndex((c) => c.key === 'email');
    expect(result.writes.flatMap((w) => (w.op === 'update' ? w.cells.map((c) => c.col) : []))).not.toContain(email);
    expect(next[P.person]![1]![email]).toBe('not an email');
  });

  it('leaves an unreadable Answered on and Target updated out of a proposal row’s answer, and keeps what was typed', () => {
    const wb = encodePartnerBook(bookWithProposals(), PARTNERS_META);
    setCell(wb, P.proposalItem, 1, 'Target updated', 'last Tuesday');
    setCell(wb, P.proposalItem, 1, 'Answered on', 'soon');
    const { result, next, decoded } = runBook(wb, { kind: 'update', entity: 'proposalItem', id: 'r_1', patch: { status: 'rejected', answerNote: 'Not yet' } });
    const header = wb[P.proposalItem]![0]!;
    const cols = result.writes.flatMap((w) => (w.op === 'update' && w.tab === P.proposalItem ? w.cells.map((c) => c.col) : []));
    expect(cols).not.toContain(header.indexOf('Target updated'));
    expect(cols).not.toContain(header.indexOf('Answered on'));
    expect(next[P.proposalItem]![1]![header.indexOf('Target updated')]).toBe('last Tuesday');
    expect(next[P.proposalItem]![1]![header.indexOf('Answered on')]).toBe('soon');
    expect(decoded.value.proposalItems[0]).toMatchObject({ status: 'rejected', answerNote: 'Not yet', targetUpdated: null, answeredOn: null });
    expect(decoded.unreadable.get('r_1')).toEqual(new Set(['answeredOn', 'targetUpdated']));
  });

  it('writes it when the change sets that field', () => {
    const wb = book();
    setCell(wb, P.partner, 1, 'Desk: Credibility', 'high');
    const { next, decoded } = runBook(wb, { kind: 'update', entity: 'partner', id: 'p_1', patch: { desk: { credibility: null } } });
    expect(next[P.partner]![1]![col('desk.credibility')]).toBe('');
    expect(decoded.issues).toEqual([]);
  });

  it('never writes a Market tab stand-in back when another field is saved', () => {
    const wb = market();
    infoRow(wb, 'Partner type')[1] = 'Wholesaler of sorts';
    const { result, next } = runMarket(wb, { kind: 'updateInfo', patch: { statusNote: 'x' } });
    expect(result.writes.some((w) => w.op === 'update' && w.row === wb[M.info]!.indexOf(infoRow(wb, 'Partner type')) + 1)).toBe(false);
    expect(infoRow(next, 'Partner type')[1]).toBe('Wholesaler of sorts');
  });
});

describe('planChanges: the Market tab', () => {
  it('updates the edited value and the Updated rows in place', () => {
    const { result, decoded } = runMarket(market(), {
      kind: 'updateInfo', patch: { statement: 'New statement' }, expectedUpdatedAt: sampleMarket().info.updatedAt,
    });
    expect(result.writes).toEqual([
      { op: 'update', tab: 'Market', row: 11, expectId: 'Statement', idCol: 0, cells: [{ col: 1, value: 'New statement' }, { col: 2, value: '' }] },
      { op: 'update', tab: 'Market', row: 16, expectId: 'Updated', idCol: 0, cells: [{ col: 1, value: NOW }] },
      { op: 'update', tab: 'Market', row: 17, expectId: 'Updated by', idCol: 0, cells: [{ col: 1, value: 'Ruth' }] },
    ]);
    expect(decoded.value.info).toMatchObject({ statement: 'New statement', checkAgain: ['mustHaves'], updatedAt: NOW });
  });

  it('refuses a stale Market update as a conflict', () => {
    expect(planChanges(MARKET_SPEC, market(), [{ kind: 'updateInfo', patch: { statusNote: 'x' }, expectedUpdatedAt: null }], makeStamp()))
      .toMatchObject({ ok: false, error: 'conflict' });
  });

  it('adds back a missing row', () => {
    const wb = market();
    wb[M.info] = wb[M.info]!.filter((row) => row[0] !== 'Updated');
    const { result, decoded } = runMarket(wb, { kind: 'updateInfo', patch: { statusNote: 'x' } });
    expect(result.writes).toContainEqual({ op: 'append', tab: 'Market', cells: [{ col: 0, value: 'Updated' }, { col: 1, value: NOW }, { col: 2, value: '' }] });
    expect(decoded.value.info.updatedAt).toBe(NOW);
  });

  it('never rewrites a value it could not read, unless that field is edited', () => {
    const wb = market();
    infoRow(wb, 'Expected partners')[1] = 'a dozen';
    infoRow(wb, 'Expected partners')[2] = 'yes';

    const cleared = runMarket(wb, { kind: 'clearCheckAgain', target: { entity: 'market', field: 'expectedCandidates' } });
    expect(cleared.result.writes[0]).toEqual({ op: 'update', tab: 'Market', row: 12, expectId: 'Expected partners', idCol: 0, cells: [{ col: 2, value: '' }] });
    expect(infoRow(cleared.next, 'Expected partners')).toEqual(['Expected partners', 'a dozen', '']);

    const other = runMarket(cleared.next, { kind: 'updateInfo', patch: { statusNote: 'x' } });
    expect(other.result.writes.map((w) => w.op !== 'append' && w.row)).not.toContain(11);
    expect(infoRow(other.next, 'Expected partners')[1]).toBe('a dozen');

    const fixed = runMarket(other.next, { kind: 'updateInfo', patch: { expectedCandidates: 12 } });
    expect(infoRow(fixed.next, 'Expected partners')).toEqual(['Expected partners', 12, '']);
    expect(fixed.decoded.issues).toEqual([]);
  });

  it('writes a value into the row under its former label, keeping that label', () => {
    const wb = market();
    infoRow(wb, 'Expected partners')[0] = 'Expected candidates';
    const { result, next } = runMarket(wb, { kind: 'updateInfo', patch: { expectedCandidates: 30 } });
    expect(result.writes).toContainEqual({ op: 'update', tab: 'Market', row: 12, expectId: 'Expected candidates', idCol: 0, cells: [{ col: 1, value: 30 }] });
    expect(infoRow(next, 'Expected candidates')).toEqual(['Expected candidates', 30, '']);
  });

  it('rewrites an Updated cell it could not read', () => {
    const wb = market();
    infoRow(wb, 'Updated')[1] = 'last Tuesday';
    const { next, decoded } = runMarket(wb, { kind: 'updateInfo', patch: { statusNote: 'x' }, expectedUpdatedAt: null });
    expect(infoRow(next, 'Updated')[1]).toBe(NOW);
    expect(decoded.issues).toEqual([]);
  });
});

describe('decodeFailure', () => {
  it('maps every kind of unreadable file to a structure error by its kind, naming the tab', () => {
    const kinds: DecodeErrorKind[] = ['not_ours', 'newer_version', 'missing_tab', 'missing_column'];
    for (const kind of kinds) {
      // The words don't matter: the kind decides.
      expect(decodeFailure({ kind, tab: 'T', message: 'anything at all' })).toEqual({ ok: false, error: 'structure', tab: 'T', message: 'anything at all' });
    }
  });

  it('maps a file made by an earlier version to old_version, so the app can offer a new one', () => {
    expect(decodeFailure({ kind: 'old_version', tab: '_meta', message: 'anything at all' })).toEqual({ ok: false, error: 'old_version', tab: '_meta', message: 'anything at all' });
    const wb = book();
    wb['_meta']![1]![1] = 1;
    expect(planChanges(PARTNERS_SPEC, wb, [{ kind: 'delete', entity: 'call', id: 'k_1' }], makeStamp())).toMatchObject({ ok: false, error: 'old_version' });
  });
});

describe('applyWrites', () => {
  it('refuses a write to a row whose ID changed since it was read', () => {
    const wb = market();
    const { writes } = ok(planChanges(MARKET_SPEC, wb, [{ kind: 'update', entity: 'exclusion', id: 'x_1', patch: { reason: 'x' } }], makeStamp()));
    // What the cell holds now may be the user's content (rows moved by hand), so the message names only the ID.
    wb[M.exclusion]![1]![0] = 'Typed by a person';
    expect(() => applyWrites(wb, writes)).toThrow('Row 2 of "Exclusions" changed since it was read: expected ID "x_1"');
  });

  it('leaves the workbook it was given alone', () => {
    const wb = book();
    const copy = structuredClone(wb);
    runBook(wb, { kind: 'delete', entity: 'partner', id: 'p_1' });
    expect(wb).toEqual(copy);
  });
});

describe('planChanges: an older file is upgraded on its next save', () => {
  it('writes a version 2 Partners file’s new headers and its version first, then the change', () => {
    const v2 = asPartnersVersion2(book());
    const width = v2[P.partner]![0]!.length;
    const { result, next, decoded } = runBook(v2, { kind: 'update', entity: 'partner', id: 'p_1', patch: { whyItFits: 'Strong' } });
    const headers = ['Program', 'Level', 'MAP health', 'Next milestone'];
    expect(result.writes.slice(0, 3)).toEqual([
      {
        op: 'update', tab: P.partner, row: 1, expectId: 'ID', idCol: 0, cells: headers.map((value, i) => ({ col: width + i, value })),
        expectCells: headers.map((_, i) => ({ col: width + i, value: '' })),
      },
      PROPOSALS_HEADER_WRITE,
      { op: 'update', tab: '_meta', row: 2, expectId: 'schemaVersion', idCol: 0, cells: [{ col: 1, value: 5 }], expectCells: [{ col: 1, value: '2' }] },
    ]);
    // The header cells are checked blank before they are written, and the version still 2.
    const checks = rowChecks(v2, result.writes).filter((c) => (c.row === 1 && c.tab === P.partner) || c.tab === '_meta');
    expect(checks.map((c) => [c.tab, c.row, c.fromCol, c.toCol])).toEqual([[P.partner, 1, width, width + 3], [P.partner, 1, 0, 0], ['_meta', 2, 1, 1], ['_meta', 2, 0, 0]]);
    expect(checks[0]!.matches([[]])).toBe(true);
    expect(checks[0]!.matches([['Region']])).toBe(false);
    expect(checks[2]!.matches([[4]])).toBe(false);
    // The Proposals tab's header row is checked blank too, so a tab typed meanwhile is never written over.
    const header = rowChecks(v2, result.writes).filter((c) => c.tab === P.proposalItem);
    expect(header.map((c) => [c.row, c.fromCol, c.toCol])).toEqual([[1, 0, PARTNERS_LAYOUT.columns.proposalItem.length - 1], [1, 0, 0]]);
    expect(header[0]!.matches([[]])).toBe(true);
    expect(header[0]!.matches([['Idea']])).toBe(false);
    expect(result.writes.slice(3).every((w) => w.tab === P.partner && w.op === 'update' && w.row === 2)).toBe(true);
    expect(next['_meta']![1]).toEqual(['schemaVersion', 5]);
    expect(next[P.proposalItem]).toEqual([PARTNERS_LAYOUT.columns.proposalItem.map((c) => c.header)]);
    expect(decoded.upgrade).toEqual([]);
    expect(decoded.issues).toEqual([]);
    expect(decoded.value.partners.find((p) => p.id === 'p_1')).toMatchObject({ whyItFits: 'Strong', programId: null, level: null, mapHealth: null });
  });

  it('writes a version 3 Partners file’s MAP headers and its version first, then a MAP health in the same save', () => {
    const v3 = asPartnersVersion3(book());
    const width = v3[P.partner]![0]!.length;
    const { result, next, decoded } = runBook(v3, { kind: 'update', entity: 'partner', id: 'p_1', patch: { mapHealth: 'off_track', mapNextMilestone: '2026-12-01' } });
    expect(result.writes.slice(0, 3)).toEqual([
      {
        op: 'update', tab: P.partner, row: 1, expectId: 'ID', idCol: 0,
        cells: [{ col: width, value: 'MAP health' }, { col: width + 1, value: 'Next milestone' }],
        expectCells: [{ col: width, value: '' }, { col: width + 1, value: '' }],
      },
      PROPOSALS_HEADER_WRITE,
      { op: 'update', tab: '_meta', row: 2, expectId: 'schemaVersion', idCol: 0, cells: [{ col: 1, value: 5 }], expectCells: [{ col: 1, value: '3' }] },
    ]);
    const header = next[P.partner]![0]!;
    expect(next[P.partner]![1]![header.indexOf('MAP health')]).toBe('Off track');
    expect(next[P.partner]![1]![header.indexOf('Next milestone')]).toBe('2026-12-01');
    expect(decoded.issues).toEqual([]);
    expect(decoded.value.partners.map((p) => [p.id, p.mapHealth, p.mapNextMilestone])).toEqual([
      ['p_1', 'off_track', '2026-12-01'], ['p_2', null, null], ['p_3', null, null], ['p_4', null, null],
    ]);
  });

  it('writes only the two MAP cells, without the stamp, when a MAP health is saved (ruling R5)', () => {
    const { result } = runBook(book(), { kind: 'setMapSummary', partnerId: 'p_2', health: 'on_track', nextMilestone: '2026-12-01' });
    expect(result.writes).toEqual([{
      op: 'update', tab: P.partner, row: 3, expectId: 'p_2', idCol: 0,
      cells: [{ col: col('mapHealth'), value: 'On track' }, { col: col('mapNextMilestone'), value: '2026-12-01' }],
    }]);
  });

  it('sets a program and level in the same save that upgrades the file', () => {
    const v2 = asPartnersVersion2(book());
    const { next, decoded } = runBook(v2, { kind: 'update', entity: 'partner', id: 'p_1', patch: { programId: 'pg_dach0001', level: 'reg' } });
    expect(decoded.value.partners.find((p) => p.id === 'p_1')).toMatchObject({ programId: 'pg_dach0001', level: 'reg' });
    const header = next[P.partner]![0]!;
    expect(next[P.partner]![1]![header.indexOf('Level')]).toBe('Registered');
  });

  it('adds a version 1 market’s Feeds program row below the last row, and can fill it in the same save', () => {
    const v1 = asMarketVersion1(market());
    const last = v1[M.info]!.length;
    const plain = runMarket(v1, { kind: 'add', entity: 'exclusion', values: { company: 'Psi AG' } });
    expect(plain.result.writes.slice(0, 2)).toEqual([
      { op: 'update', tab: M.info, row: last + 1, expectId: '', idCol: 0, cells: [{ col: 0, value: 'Feeds program' }], expectCells: [{ col: 0, value: '' }] },
      { op: 'update', tab: '_meta', row: 2, expectId: 'schemaVersion', idCol: 0, cells: [{ col: 1, value: 2 }], expectCells: [{ col: 1, value: '1' }] },
    ]);
    expect(plain.next[M.info]!.slice(0, last)).toEqual(v1[M.info]);
    expect(plain.next[M.info]![last]).toEqual(['Feeds program']);
    expect(plain.decoded.issues).toEqual([]);

    const feeding = runMarket(v1, { kind: 'updateInfo', patch: { feedsProgramId: 'pg_dach0001' } });
    expect(feeding.next[M.info]![last]).toEqual(['Feeds program', 'pg_dach0001']);
    expect(feeding.decoded.value.info.feedsProgramId).toBe('pg_dach0001');
    expect(feeding.next['_meta']![1]).toEqual(['schemaVersion', 2]);
  });

  it('upgrades a version 2 MAP file’s Review items: each id becomes its name, its cell checked unchanged before it is written', () => {
    const today = NOW.slice(0, 10);
    const sample = buildSamplePlan(today) as MapPlan;
    const plan: MapPlan = {
      ...sample,
      reviews: [{
        id: 'rv_1', horizon: 1, state: 'prep', heldOn: null, caseId: null, decisions: '', relationshipNote: '', nextHorizonDays: 90,
        includeScorecard: false, summarySentAt: null, summarySentTo: '', updatedAt: null, updatedBy: null,
      }],
      reviewItems: [{
        id: 'ri_1', reviewId: 'rv_1', kind: 'commitment', refId: null, title: 'Train sellers', side: 'partner', ownerId: 'p_sample3',
        dueDate: null, milestoneId: 'm_sample2', answer: null, note: '', moved: false,
      }],
    };
    const v2 = asMapVersion2(encodeMap(plan, 'co_abcdefghij', { appUrl: 'https://desk.test/plans' }));
    const record = buildSampleRecord(today) as MapRecord;
    const change = { kind: 'update' as const, entity: 'objective' as const, id: plan.objectives[0]!.id, patch: { statement: 'x' }, record };
    const result = ok(planChanges(MAP_SPEC, v2, [change], makeStamp()));
    const tab = MAP_LAYOUT.tabs.reviewItem;
    expect(result.writes.find((w) => w.tab === tab && w.op === 'update' && w.row === 2)).toEqual({
      op: 'update', tab, row: 2, expectId: 'ri_1', idCol: 0,
      cells: [{ col: 6, value: 'Priya Shah' }, { col: 8, value: 'Day 60: First joint opportunity' }],
      expectCells: [{ col: 6, value: 'p_sample3' }, { col: 8, value: 'm_sample2' }],
    });
    const check = rowChecks(v2, result.writes).find((c) => c.tab === tab && c.row === 2 && c.fromCol === 6)!;
    expect(check.matches([['p_sample3', '', 'm_sample2']])).toBe(true);
    expect(check.matches([['Somebody new', '', 'm_sample2']])).toBe(false);
    // A person typed into the cell since it was read: nothing of the save is applied.
    const typed = structuredClone(v2);
    typed[tab]![1]![6] = 'Somebody new';
    expect(() => applyWrites(typed, result.writes)).toThrow();
    const decoded = decodeMap(applyWrites(v2, result.writes));
    expect(decoded.ok && decoded.value).toMatchObject({ upgrade: [], issues: [], value: { reviewItems: plan.reviewItems } });
  });

  it('writes nothing to upgrade a file already at the current version', () => {
    const { result } = runBook(book(), { kind: 'update', entity: 'partner', id: 'p_1', patch: { whyItFits: 'Strong' } });
    expect(result.writes.some((w) => w.tab === '_meta' || (w.op === 'update' && w.row === 1))).toBe(false);
  });

  it('places a missing Market row the save adds back below the row the upgrade adds, in the check and the snapshot', () => {
    const v1 = asMarketVersion1(market());
    v1[M.info] = v1[M.info]!.filter((row) => row[0] !== 'Updated');
    const last = v1[M.info]!.length;
    const { result, next } = runMarket(v1, { kind: 'updateInfo', patch: { feedsProgramId: 'pg_dach0001' } });
    expect(next[M.info]!.slice(last).map((row) => row.slice(0, 2))).toEqual([['Feeds program', 'pg_dach0001'], ['Updated', NOW]]);
    const append = result.writes.find((w) => w.op === 'append')!;
    expect(appendRows(v1, result.writes).get(append)).toBe(last + 2);
    expect(rowChecks(v1, result.writes).filter((c) => c.tab === M.info && c.row > last).map((c) => c.row)).toEqual([last + 1, last + 1, last + 2]);
  });
});
