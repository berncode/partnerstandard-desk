import {
  applyMarketChange, applyPartnerChange, parsePartnerChange, type Market, type MarketChange, type PartnerBook, type PartnerChange, type Scores,
} from '@partner-desk/core';
import { anAccount, aPartner, NOW, qualification, call, person, sampleBook, sampleMarket, stamp } from '@partner-desk/core/test-builders';
import { describe, expect, it } from 'vitest';
import { marketInverse, partnerInverse } from './inverse';

const LATER = '2026-10-29T11:00:00.000Z';

/** A value without the Updated stamps and authors, which every write moves forward. */
function content(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, v) => (key === 'updatedAt' || key === 'updatedBy' ? undefined : v)));
}

const DESK: Scores = { customerBase: 3, credibility: 2, capability: null, commitment: null };
const NONE: Scores = { customerBase: null, credibility: null, capability: null, commitment: null };

/** A book with an open section (with scores, a call and a qualification), a closed one, a signed one and an exited one. */
function book(): PartnerBook {
  return sampleBook({
    accounts: [anAccount({ id: 'a_1', company: 'Acme GmbH', comments: 'Founder-led' })],
    partners: [
      aPartner({ id: 'p_1', accountId: 'a_1', whyItFits: 'Local reach', step: 'discovery_call', desk: DESK }),
      aPartner({ id: 'p_3', accountId: 'a_1', partnerType: 'referral', closed: 'no', closedReason: 'Competes with us' }),
      aPartner({ id: 'p_5', accountId: 'a_1', partnerType: 'affiliate', stage: 'growth', step: null, signedDate: '2026-09-01' }),
      aPartner({
        id: 'p_7', accountId: 'a_1', partnerType: 'managed', stage: 'exit', step: null,
        signedDate: '2026-09-01', exitedDate: '2026-10-21', exitReason: 'They left the market.',
      }),
    ],
    people: [person({ id: 'e_1', accountId: 'a_1', name: 'Lea', title: 'Founder', email: null, role: 'sponsor', activeSeller: false })],
    calls: [call({ id: 'k_1', partnerId: 'p_1', topics: { revenueModel: '', costDrivers: 'Consultants', differentiators: '', strategicBets: '', customerPains: '', partnershipExperience: '' } })],
    qualifications: [qualification({
      id: 'q_1', partnerId: 'p_1',
      caso: {
        culture: { answer: 'yes', note: 'Pragmatic' }, additionalValue: { answer: null, note: '' },
        sponsorship: { answer: null, note: '' }, alignedObjectives: { answer: null, note: '' },
      },
    })],
    marketLinks: [],
  });
}

function roundTripPartner(change: PartnerChange, before: PartnerBook = book()) {
  const done = applyPartnerChange(before, change, stamp());
  if (!done.ok) throw new Error(`change refused: ${done.message}`);
  const undo = partnerInverse(change, before, done.entityId);
  if (!undo || Array.isArray(undo)) throw new Error(Array.isArray(undo) ? 'inverse is a list' : 'no inverse');
  const undone = applyPartnerChange(done.value, undo, stamp({ now: LATER }));
  if (!undone.ok) throw new Error(`inverse refused: ${undone.message}`);
  return { before, after: done.value, undone: undone.value, undo };
}

function roundTripMarket(change: MarketChange, before: Market = sampleMarket()) {
  const done = applyMarketChange(before, change, stamp());
  if (!done.ok) throw new Error(`change refused: ${done.message}`);
  const undo = marketInverse(change, before, done.entityId);
  if (!undo) throw new Error('no inverse');
  const undone = applyMarketChange(done.value, undo, stamp({ now: LATER }));
  if (!undone.ok) throw new Error(`inverse refused: ${undone.message}`);
  return { before, after: done.value, undone: undone.value, undo };
}

describe('partnerInverse: each change kind restores the book', () => {
  it('add, by deleting what it created', () => {
    const { before, undone, undo } = roundTripPartner({ kind: 'add', entity: 'person', values: { accountId: 'a_1', name: 'Lea' } });
    expect(undo).toEqual({ kind: 'delete', entity: 'person', id: 'person_new' });
    expect(content(undone)).toEqual(content(before));
  });

  it('update, by restoring the previous values', () => {
    const { before, undone, undo } = roundTripPartner({ kind: 'update', entity: 'account', id: 'a_1', patch: { company: 'Acme AG', comments: '' } });
    expect(undo).toEqual({ kind: 'update', entity: 'account', id: 'a_1', patch: { company: 'Acme GmbH', comments: 'Founder-led' } });
    expect(content(undone)).toEqual(content(before));
  });

  it('update of one sub-field, restoring only that sub-field', () => {
    const desk = roundTripPartner({ kind: 'update', entity: 'partner', id: 'p_1', patch: { desk: { credibility: 0 } } });
    expect(desk.undo).toEqual({ kind: 'update', entity: 'partner', id: 'p_1', patch: { desk: { credibility: 2 } } });
    expect(content(desk.undone)).toEqual(content(desk.before));
    const caso = roundTripPartner({ kind: 'update', entity: 'qualification', id: 'q_1', patch: { caso: { culture: { note: 'Fast' } } } });
    expect(caso.undo).toEqual({ kind: 'update', entity: 'qualification', id: 'q_1', patch: { caso: { culture: { note: 'Pragmatic' } } } });
    expect(content(caso.undone)).toEqual(content(caso.before));
    const topic = roundTripPartner({ kind: 'update', entity: 'call', id: 'k_1', patch: { topics: { costDrivers: 'Travel' } } });
    expect(topic.undo).toEqual({ kind: 'update', entity: 'call', id: 'k_1', patch: { topics: { costDrivers: 'Consultants' } } });
    expect(content(topic.undone)).toEqual(content(topic.before));
  });

  it('undoing one sub-field leaves a sibling changed since alone', () => {
    const before = book();
    const change: PartnerChange = { kind: 'update', entity: 'partner', id: 'p_1', patch: { desk: { credibility: 0 } } };
    const done = applyPartnerChange(before, change, stamp());
    if (!done.ok) throw new Error(done.message);
    const sibling = applyPartnerChange(done.value, { kind: 'update', entity: 'partner', id: 'p_1', patch: { desk: { capability: 3 } } }, stamp());
    if (!sibling.ok) throw new Error(sibling.message);
    const inverse = partnerInverse(change, before);
    if (!inverse || Array.isArray(inverse)) throw new Error('no inverse');
    const undone = applyPartnerChange(sibling.value, inverse, stamp({ now: LATER }));
    if (!undone.ok) throw new Error(undone.message);
    expect(undone.value.partners[0]!.desk).toEqual({ customerBase: 3, credibility: 2, capability: 3, commitment: null });
  });

  it('setStep, back to the step before', () => {
    const { undo, undone, before } = roundTripPartner({ kind: 'setStep', partnerId: 'p_1', to: 'qualification' });
    expect(undo).toEqual({ kind: 'setStep', partnerId: 'p_1', to: 'discovery_call' });
    expect(content(undone)).toEqual(content(before));
  });

  it('setStage, back to the stage before', () => {
    const { undo, undone, before } = roundTripPartner({ kind: 'setStage', partnerId: 'p_5', to: 'expansion' });
    expect(undo).toEqual({ kind: 'setStage', partnerId: 'p_5', to: 'growth' });
    expect(content(undone)).toEqual(content(before));
  });

  it('close, by reopening; closing again, by the previous close', () => {
    expect(content(roundTripPartner({ kind: 'close', partnerId: 'p_1', as: 'not_now', reason: 'Busy' }).undone)).toEqual(content(book()));
    const reclosed = roundTripPartner({ kind: 'close', partnerId: 'p_3', as: 'not_now', reason: 'Later' });
    expect(reclosed.undo).toEqual({ kind: 'close', partnerId: 'p_3', as: 'no', reason: 'Competes with us' });
    expect(content(reclosed.undone)).toEqual(content(book()));
  });

  it('reopen, by closing again with the same reason', () => {
    const { before, undone, undo } = roundTripPartner({ kind: 'reopen', partnerId: 'p_3' });
    expect(undo).toEqual({ kind: 'close', partnerId: 'p_3', as: 'no', reason: 'Competes with us' });
    expect(content(undone)).toEqual(content(before));
  });

  it('delete of an account, a section or a person, by adding that row back under its id', () => {
    const before = book();
    const account = partnerInverse({ kind: 'delete', entity: 'account', id: 'a_1' }, before);
    const section = partnerInverse({ kind: 'delete', entity: 'partner', id: 'p_1' }, before);
    const contact = partnerInverse({ kind: 'delete', entity: 'person', id: 'e_1' }, before);
    expect(account).toEqual({
      kind: 'add', entity: 'account',
      values: {
        id: 'a_1', company: 'Acme GmbH', website: 'https://acme.example', country: 'Austria', vertical: 'Managed IT',
        subVertical: '', targetCustomerType: 'smb', comments: 'Founder-led',
      },
    });
    expect(contact).toEqual({
      kind: 'add', entity: 'person',
      values: { id: 'e_1', accountId: 'a_1', name: 'Lea', title: 'Founder', email: null, role: 'sponsor', activeSeller: false },
    });
    expect(section).toEqual([
      {
        kind: 'add', entity: 'partner',
        values: {
          id: 'p_1', accountId: 'a_1', partnerType: 'reseller', source: 'research', sourceDetail: '', whyItFits: 'Local reach',
          desk: DESK, confirmed: NONE, mapFilled: false, mapLink: '', programId: null, level: null,
        },
      },
      { kind: 'setStep', partnerId: 'p_1', to: 'discovery_call' },
    ]);
    // The same parser and applier a command uses: no minted id, so values.id is the row's id.
    const roundTripDelete = (start: PartnerBook, change: PartnerChange) => {
      const done = applyPartnerChange(start, change, stamp());
      if (!done.ok) throw new Error(done.message);
      const undo = partnerInverse(change, start);
      const list = Array.isArray(undo) ? undo : undo ? [undo] : null;
      if (!list) throw new Error('no inverse');
      let current = done.value;
      for (const step of list) {
        const parsed = parsePartnerChange(step);
        if (!parsed.ok) throw new Error('parser rejected inverse');
        const undone = applyPartnerChange(current, parsed.change, { now: LATER, actor: 'Ruth' });
        if (!undone.ok) throw new Error(`inverse refused: ${undone.message}`);
        current = undone.value;
      }
      // An add puts the row at the end, so the list order changes. The row itself matches.
      const ordered = (book: PartnerBook) => content({
        ...book,
        accounts: [...book.accounts].sort((x, y) => x.id.localeCompare(y.id)),
        partners: [...book.partners].sort((x, y) => x.id.localeCompare(y.id)),
        people: [...book.people].sort((x, y) => x.id.localeCompare(y.id)),
      });
      expect(ordered(current)).toEqual(ordered(start));
    };
    roundTripDelete(before, { kind: 'delete', entity: 'person', id: 'e_1' });
    const plain = book();
    plain.partners[0] = aPartner({ id: 'p_1', accountId: 'a_1', whyItFits: 'Local reach', desk: DESK });
    roundTripDelete(plain, { kind: 'delete', entity: 'partner', id: 'p_1' });
    const alone = book();
    alone.partners = [];
    alone.people = [];
    roundTripDelete(alone, { kind: 'delete', entity: 'account', id: 'a_1' });
  });

  it('brings a closed section back closed, and an exited one back exited, through the real parser', () => {
    const restore = (start: PartnerBook, id: string) => {
      const done = applyPartnerChange(start, { kind: 'delete', entity: 'partner', id }, stamp());
      if (!done.ok) throw new Error(done.message);
      const undo = partnerInverse({ kind: 'delete', entity: 'partner', id }, start);
      if (!Array.isArray(undo)) throw new Error('expected a list');
      let current = done.value;
      const applied: PartnerChange[] = [];
      for (const step of undo) {
        const parsed = parsePartnerChange(step);
        if (!parsed.ok) throw new Error('parser rejected inverse');
        const out = applyPartnerChange(current, parsed.change, { now: LATER, actor: 'Ruth' });
        if (!out.ok) throw new Error(out.message);
        current = out.value;
        applied.push(parsed.change);
      }
      return { current, applied };
    };
    const closed = restore(book(), 'p_3');
    expect(closed.applied.map((c) => c.kind)).toEqual(['add', 'close']);
    expect(closed.current.partners.find((p) => p.id === 'p_3')).toMatchObject({
      id: 'p_3', closed: 'no', closedReason: 'Competes with us', stage: 'recruitment', step: 'researched', signedDate: null,
    });
    const later = book();
    later.partners[1] = { ...later.partners[1]!, step: 'qualification' };
    const moved = restore(later, 'p_3');
    expect(moved.applied.map((c) => c.kind)).toEqual(['add', 'setStep', 'setStep', 'close']);
    expect(moved.current.partners.find((p) => p.id === 'p_3')).toMatchObject({ step: 'qualification', closed: 'no', closedReason: 'Competes with us' });
    const exited = restore(book(), 'p_7');
    expect(exited.applied.map((c) => c.kind)).toEqual(['add', 'markSigned', 'markExited']);
    expect(exited.current.partners.find((p) => p.id === 'p_7')).toMatchObject({
      id: 'p_7', stage: 'exit', signedDate: '2026-09-01', exitedDate: '2026-10-21', exitReason: 'They left the market.',
    });
    const signed = restore(book(), 'p_5');
    expect(signed.applied.map((c) => c.kind)).toEqual(['add', 'markSigned', 'setStage']);
    expect(signed.current.partners.find((p) => p.id === 'p_5')).toMatchObject({
      id: 'p_5', stage: 'growth', step: null, signedDate: '2026-09-01', exitedDate: null,
    });
  });

  it('undoSigned, by signing again with the date the section had, then walking the stages back to where it was', () => {
    const before = book();
    const change: PartnerChange = { kind: 'undoSigned', partnerId: 'p_5' };
    const done = applyPartnerChange(before, change, stamp());
    if (!done.ok) throw new Error(done.message);
    const undo = partnerInverse(change, before);
    expect(undo).toEqual([
      { kind: 'markSigned', partnerId: 'p_5', signedDate: '2026-09-01' },
      { kind: 'setStage', partnerId: 'p_5', to: 'growth' },
    ]);
    let current = done.value;
    for (const step of undo as PartnerChange[]) {
      const out = applyPartnerChange(current, step, stamp({ now: LATER }));
      if (!out.ok) throw new Error(out.message);
      current = out.value;
    }
    expect(current.partners.find((p) => p.id === 'p_5')).toMatchObject({ stage: 'growth', step: null, signedDate: '2026-09-01' });
  });

  it('undoSigned in Onboarding, by signing again only', () => {
    const before = book();
    before.partners = before.partners.map((p) => (p.id === 'p_5' ? { ...p, stage: 'onboarding' } : p));
    expect(partnerInverse({ kind: 'undoSigned', partnerId: 'p_5' }, before)).toEqual({ kind: 'markSigned', partnerId: 'p_5', signedDate: '2026-09-01' });
  });

  it('markSigned, by taking the signature back', () => {
    const { undo } = roundTripPartner({ kind: 'markSigned', partnerId: 'p_1', signedDate: '2026-10-28' });
    expect(undo).toEqual({ kind: 'undoSigned', partnerId: 'p_1' });
  });

  it('correctExit, by putting the previous date and reason back', () => {
    const { before, undone, undo } = roundTripPartner({
      kind: 'correctExit', partnerId: 'p_7', exitedDate: '2026-11-02', reason: 'Chose another vendor',
    });
    expect(undo).toEqual({ kind: 'correctExit', partnerId: 'p_7', exitedDate: '2026-10-21', reason: 'They left the market.' });
    expect(content(undone)).toEqual(content(before));
  });

  it('none for a delete of a call, a qualification or a link, or for an exit', () => {
    const b = book();
    expect(partnerInverse({ kind: 'delete', entity: 'call', id: 'k_1' }, b)).toBeNull();
    expect(partnerInverse({ kind: 'delete', entity: 'qualification', id: 'q_1' }, b)).toBeNull();
    expect(partnerInverse({ kind: 'delete', entity: 'marketLink', id: 'l_1' }, b)).toBeNull();
    expect(partnerInverse({ kind: 'markExited', partnerId: 'p_5', exitedDate: '2026-10-28', reason: 'Done' }, b)).toBeNull();
    expect(partnerInverse({ kind: 'delete', entity: 'person', id: 'e_gone' }, b)).toBeNull();
    expect(partnerInverse({ kind: 'undoSigned', partnerId: 'p_1' }, b)).toBeNull();
    expect(partnerInverse({ kind: 'correctExit', partnerId: 'p_5', exitedDate: '2026-11-01', reason: 'x' }, b)).toBeNull();
  });

  it('none for a row that is not there, or an add whose id is unknown', () => {
    const b = book();
    expect(partnerInverse({ kind: 'update', entity: 'partner', id: 'p_gone', patch: { company: 'X' } }, b)).toBeNull();
    expect(partnerInverse({ kind: 'setStage', partnerId: 'p_gone', to: 'growth' }, b)).toBeNull();
    expect(partnerInverse({ kind: 'add', entity: 'person', values: {} }, b, null)).toBeNull();
    expect(partnerInverse({ kind: 'reopen', partnerId: 'p_1' }, b)).toBeNull();
  });

  it('never carries managed fields', () => {
    const undo = partnerInverse({ kind: 'update', entity: 'account', id: 'a_1', patch: { company: 'X', updatedAt: NOW, updatedBy: 'Y', id: 'a_9' } }, book());
    expect(undo).toEqual({ kind: 'update', entity: 'account', id: 'a_1', patch: { company: 'Acme GmbH' } });
  });
});

describe('marketInverse: each change kind restores the market', () => {
  it('updateInfo, including the check-again flags the edit cleared', () => {
    const { before, after, undone, undo } = roundTripMarket({ kind: 'updateInfo', patch: { statement: 'New statement' } });
    expect(after.info.checkAgain).toEqual(['mustHaves']);
    expect(undo).toEqual({ kind: 'updateInfo', patch: { statement: before.info.statement, checkAgain: ['mustHaves', 'statement'] } });
    expect(content(undone)).toEqual(content(before));
  });

  it('updateInfo of a field without a flag leaves the flags alone', () => {
    const { before, undone, undo } = roundTripMarket({ kind: 'updateInfo', patch: { marketName: 'Vienna' } });
    expect(undo).toEqual({ kind: 'updateInfo', patch: { marketName: 'Austria' } });
    expect(content(undone)).toEqual(content(before));
  });

  it('add, by deleting what it created', () => {
    const { before, undone, undo } = roundTripMarket({ kind: 'add', entity: 'exclusion', values: { company: 'Zeta AG' } });
    expect(undo).toEqual({ kind: 'delete', entity: 'exclusion', id: 'exclusion_new' });
    expect(content(undone)).toEqual(content(before));
  });

  it('update of a flagged hypothesis, including its check-again flag', () => {
    const { before, after, undone } = roundTripMarket({ kind: 'update', entity: 'hypothesis', id: 'h_1', patch: { name: 'ERP resellers' } });
    expect(after.hypotheses[0]!.checkAgain).toBe(false);
    expect(content(undone)).toEqual(content(before));
  });

  it('clearCheckAgain, by setting the flag again', () => {
    expect(content(roundTripMarket({ kind: 'clearCheckAgain', target: { entity: 'market', field: 'statement' } }).undone)).toEqual(content(sampleMarket()));
    expect(content(roundTripMarket({ kind: 'clearCheckAgain', target: { entity: 'valuePoint', id: 'v_2' } }).undone)).toEqual(content(sampleMarket()));
    expect(content(roundTripMarket({ kind: 'clearCheckAgain', target: { entity: 'hypothesis', id: 'h_1' } }).undone)).toEqual(content(sampleMarket()));
  });

  it('none for a delete, a row that is not there, or an add whose id is unknown', () => {
    const m = sampleMarket();
    expect(marketInverse({ kind: 'delete', entity: 'exclusion', id: 'x_1' }, m, null)).toBeNull();
    expect(marketInverse({ kind: 'update', entity: 'exclusion', id: 'x_gone', patch: { company: 'X' } }, m, null)).toBeNull();
    expect(marketInverse({ kind: 'add', entity: 'exclusion', values: {} }, m, null)).toBeNull();
  });
});
