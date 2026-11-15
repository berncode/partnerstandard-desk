import { describe, expect, it } from 'vitest';
import { COPY } from '@partner-desk/copy';
import { aPartner, anAccount, call, EARLIER, marketLink, NOW, person, proposalItem, sampleBook, stamp } from '../test-builders';
import { applyPartnerChanges } from './batch';
import { applyPartnerChange, MOVES_STAGE, type PartnerChange } from './changes';
import { danglingRefs, activeSellerCount, levelOf } from './derived';
import type { Partner, PartnerBook } from './types';

function ok(book: PartnerBook, change: Parameters<typeof applyPartnerChange>[1]) {
  const out = applyPartnerChange(book, change, stamp());
  if (!out.ok) throw new Error(out.message);
  return out.value;
}

describe('applyPartnerChange', () => {
  it('adds a partner in recruitment at the researched step, stamped with the actor', () => {
    const out = applyPartnerChange(sampleBook(), { kind: 'add', entity: 'partner', values: { accountId: 'a_abc123', partnerType: 'referral' } }, stamp());
    if (!out.ok) throw new Error(out.message);
    const added = out.value.partners.at(-1)!;
    expect(added).toMatchObject({
      id: 'partner_new', companyId: 'co_abcdefghij', stage: 'recruitment', step: 'researched', closed: null, signedDate: null,
      exitedDate: null, exitReason: '', updatedAt: NOW, updatedBy: 'Ruth',
    });
    expect(out.entityId).toBe('partner_new');
  });

  it('keeps an add\'s own id when the stamp does not mint one, and refuses an id the book already has', () => {
    const bare = { now: NOW, actor: 'Ruth' };
    const kept = applyPartnerChange(sampleBook(), {
      kind: 'add', entity: 'account', values: { id: 'a_kept', company: 'Kept', updatedAt: '1999-01-01T00:00:00.000Z', updatedBy: 'Eve' },
    }, bare);
    expect(kept.ok && kept.entityId).toBe('a_kept');
    expect(kept.ok && kept.value.accounts.at(-1)).toMatchObject({ id: 'a_kept', company: 'Kept', updatedAt: NOW, updatedBy: 'Ruth' });
    const taken = applyPartnerChange(sampleBook(), {
      kind: 'add', entity: 'person', values: { id: 'a_abc123', accountId: 'a_abc123', name: 'Max' },
    }, bare);
    expect(taken).toMatchObject({ ok: false, error: 'invalid', message: COPY.ID_TAKEN, fieldErrors: { id: COPY.ID_TAKEN } });
    const minted = applyPartnerChange(sampleBook(), {
      kind: 'add', entity: 'account', values: { id: 'a_kept', company: 'Kept' },
    }, stamp());
    expect(minted.ok && minted.entityId).toBe('account_new');
  });

  it('needs a partner type to add a partner', () => {
    expect(applyPartnerChange(sampleBook(), { kind: 'add', entity: 'partner', values: { accountId: 'a_abc123' } }, stamp()))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { partnerType: expect.any(String) } });
  });

  it('refuses lifecycle fields in add values', () => {
    const book = sampleBook();
    for (const values of [{ stage: 'growth' }, { step: null }, { closed: 'no' }, { signedDate: '2026-01-01' }, { exitReason: 'x' }]) {
      expect(applyPartnerChange(book, { kind: 'add', entity: 'partner', values: { accountId: 'a_abc123', partnerType: 'referral', ...values } }, stamp()))
        .toMatchObject({ ok: false, error: 'invalid', message: COPY.USE_OWN_CHANGES });
    }
    const signed = ok(book, { kind: 'markSigned', partnerId: 'p_abc123', signedDate: '2026-10-20' });
    expect(signed.partners[0]!).toMatchObject({ stage: 'onboarding', step: null, signedDate: '2026-10-20' });
  });

  it('refuses lifecycle fields in a patch', () => {
    const book = sampleBook();
    for (const patch of [{ stage: 'growth' }, { step: 'map' }, { closed: 'no' }, { closedReason: 'x' }, { signedDate: '2026-01-01' }, { exitedDate: '2026-02-01' }, { exitReason: 'x' }]) {
      expect(applyPartnerChange(book, { kind: 'update', entity: 'partner', id: 'p_abc123', patch }, stamp()))
        .toMatchObject({ ok: false, error: 'invalid', message: COPY.USE_OWN_CHANGES });
    }
  });

  it('stamps an update and leaves the other rows alone', () => {
    const book = sampleBook({ partners: [aPartner(), aPartner({ id: 'p_other1', partnerType: 'referral' })] });
    const next = ok(book, { kind: 'update', entity: 'partner', id: 'p_abc123', patch: { whyItFits: 'Called' } });
    expect(next.partners[0]!).toMatchObject({ whyItFits: 'Called', updatedAt: NOW, updatedBy: 'Ruth' });
    expect(next.partners[1]).toEqual(book.partners[1]);
  });

  it('refuses a stale update', () => {
    const book = sampleBook({ partners: [aPartner({ updatedAt: NOW })] });
    const out = applyPartnerChange(book, { kind: 'update', entity: 'partner', id: 'p_abc123', patch: { whyItFits: 'x' }, expectedUpdatedAt: EARLIER }, stamp());
    expect(out).toEqual({ ok: false, error: 'conflict', message: COPY.CONFLICT });
    expect(book.partners[0]!.whyItFits).toBe('');
  });

  it('says not found for a missing row', () => {
    expect(applyPartnerChange(sampleBook(), { kind: 'update', entity: 'person', id: 'e_nope', patch: { name: 'X' } }, stamp()))
      .toEqual({ ok: false, error: 'not_found', message: COPY.GONE });
    expect(applyPartnerChange(sampleBook(), { kind: 'close', partnerId: 'p_nope', as: 'no', reason: 'x' }, stamp()))
      .toMatchObject({ ok: false, error: 'not_found' });
  });

  it('merges sub-fields of scores', () => {
    const next = ok(sampleBook(), { kind: 'update', entity: 'partner', id: 'p_abc123', patch: { desk: { credibility: 2 } } });
    expect(next.partners[0]!.desk).toEqual({ customerBase: null, credibility: 2, capability: 3, commitment: null });
  });

  it('moves a step forward and back one at a time', () => {
    const forward = ok(sampleBook(), { kind: 'setStep', partnerId: 'p_abc123', to: 'discovery_call' });
    expect(forward.partners[0]!).toMatchObject({ step: 'discovery_call', updatedAt: NOW, updatedBy: 'Ruth' });
    expect(applyPartnerChange(sampleBook(), { kind: 'setStep', partnerId: 'p_abc123', to: 'map' }, stamp()))
      .toMatchObject({ ok: false, error: 'invalid', message: COPY.ONE_STEP });
  });

  it('signs, moves stage and exits through their own changes', () => {
    const signed = ok(sampleBook(), { kind: 'markSigned', partnerId: 'p_abc123', signedDate: '2026-10-20' });
    expect(signed.partners[0]!).toMatchObject({ stage: 'onboarding', step: null, signedDate: '2026-10-20', updatedAt: NOW, updatedBy: 'Ruth' });
    const grown = ok(signed, { kind: 'setStage', partnerId: 'p_abc123', to: 'growth' });
    expect(grown.partners[0]!.stage).toBe('growth');
    const exited = ok(grown, { kind: 'markExited', partnerId: 'p_abc123', exitedDate: '2026-12-01', reason: 'Went direct' });
    expect(exited.partners[0]!).toMatchObject({ stage: 'exit', exitedDate: '2026-12-01', exitReason: 'Went direct' });
  });

  it('refuses an exit date before the signing date', () => {
    const signed = ok(sampleBook(), { kind: 'markSigned', partnerId: 'p_abc123', signedDate: '2026-10-20' });
    expect(applyPartnerChange(signed, { kind: 'markExited', partnerId: 'p_abc123', exitedDate: '2026-10-01', reason: 'x' }, stamp()))
      .toMatchObject({ ok: false, error: 'invalid', message: COPY.EXIT_DATE_BEFORE_SIGNING });
  });

  it('passes rule messages through', () => {
    const signed = ok(sampleBook(), { kind: 'markSigned', partnerId: 'p_abc123', signedDate: '2026-10-20' });
    expect(applyPartnerChange(signed, { kind: 'close', partnerId: 'p_abc123', as: 'no', reason: 'x' }, stamp()))
      .toMatchObject({ ok: false, error: 'invalid', message: COPY.CLOSE_AFTER_SIGNING });
    expect(applyPartnerChange(signed, { kind: 'markSigned', partnerId: 'p_abc123', signedDate: '2026-10-21' }, stamp()))
      .toMatchObject({ ok: false, message: COPY.ALREADY_SIGNED });
    expect(applyPartnerChange(sampleBook(), { kind: 'setStage', partnerId: 'p_abc123', to: 'growth' }, stamp()))
      .toMatchObject({ ok: false, message: COPY.SIGN_BEFORE_STAGE });
    expect(applyPartnerChange(sampleBook(), { kind: 'markExited', partnerId: 'p_abc123', exitedDate: '2026-12-01', reason: 'x' }, stamp()))
      .toMatchObject({ ok: false, message: COPY.EXIT_BEFORE_SIGNING });
    expect(applyPartnerChange(sampleBook(), { kind: 'close', partnerId: 'p_abc123', as: 'no', reason: '  ' }, stamp()))
      .toMatchObject({ ok: false, message: COPY.REASON_NEEDED, fieldErrors: { reason: COPY.REASON_NEEDED } });
  });

  it('names the reason field for an empty reason on exit, and only for that', () => {
    const grown = ok(ok(sampleBook(), { kind: 'markSigned', partnerId: 'p_abc123', signedDate: '2026-10-20' }), { kind: 'setStage', partnerId: 'p_abc123', to: 'growth' });
    expect(applyPartnerChange(grown, { kind: 'markExited', partnerId: 'p_abc123', exitedDate: '2026-12-01', reason: ' ' }, stamp()))
      .toMatchObject({ ok: false, message: COPY.REASON_NEEDED, fieldErrors: { reason: COPY.REASON_NEEDED } });
    // Another refusal with an empty reason carries no reason field error.
    const out = applyPartnerChange(sampleBook(), { kind: 'markExited', partnerId: 'p_abc123', exitedDate: '2026-12-01', reason: '' }, stamp());
    expect(out).toMatchObject({ ok: false });
    if (!out.ok && out.message !== COPY.REASON_NEEDED) expect(out.fieldErrors).toBeUndefined();
    const signed = ok(sampleBook(), { kind: 'markSigned', partnerId: 'p_abc123', signedDate: '2026-10-20' });
    const refused = applyPartnerChange(signed, { kind: 'close', partnerId: 'p_abc123', as: 'no', reason: '' }, stamp());
    expect(refused).toMatchObject({ ok: false, message: COPY.CLOSE_AFTER_SIGNING });
    expect(refused.ok ? null : refused.fieldErrors).toBeUndefined();
  });

  it('closes with a trimmed reason, blocks steps while closed, and reopens', () => {
    const closed = ok(sampleBook(), { kind: 'close', partnerId: 'p_abc123', as: 'not_now', reason: ' Busy until spring ' });
    expect(closed.partners[0]!).toMatchObject({ closed: 'not_now', closedReason: 'Busy until spring', updatedAt: NOW });
    expect(applyPartnerChange(closed, { kind: 'setStep', partnerId: 'p_abc123', to: 'discovery_call' }, stamp()))
      .toMatchObject({ ok: false, message: COPY.REOPEN_BEFORE_STEP });
    const reopened = ok(closed, { kind: 'reopen', partnerId: 'p_abc123' });
    expect(reopened.partners[0]!).toMatchObject({ closed: null, closedReason: '', updatedBy: 'Ruth' });
  });

  it('adds a person with defaults and the actor', () => {
    const next = ok(sampleBook(), { kind: 'add', entity: 'person', values: { accountId: 'a_abc123', name: 'Max' } });
    expect(next.people.at(-1)).toMatchObject({ id: 'person_new', name: 'Max', role: 'contact', activeSeller: false, updatedBy: 'Ruth' });
  });

  it('allows one qualification per partner', () => {
    expect(applyPartnerChange(sampleBook(), { kind: 'add', entity: 'qualification', values: { partnerId: 'p_abc123' } }, stamp()))
      .toMatchObject({ ok: false, error: 'invalid' });
  });

  it('links a partner to a market once', () => {
    const book = sampleBook({ marketLinks: [] });
    const linked = ok(book, { kind: 'add', entity: 'marketLink', values: { partnerId: 'p_abc123', marketId: 'm_abcdefghij' } });
    expect(linked.marketLinks).toHaveLength(1);
    expect(applyPartnerChange(linked, { kind: 'add', entity: 'marketLink', values: { partnerId: 'p_abc123', marketId: 'm_abcdefghij' } }, stamp()))
      .toMatchObject({ ok: false, error: 'invalid', message: COPY.ALREADY_LINKED });
    expect(applyPartnerChange(linked, { kind: 'add', entity: 'marketLink', values: { partnerId: 'p_abc123', marketId: 'm_other00000' } }, stamp()))
      .toMatchObject({ ok: true });
  });

  it('refuses to go back to recruitment after signing', () => {
    const signed = ok(sampleBook(), { kind: 'markSigned', partnerId: 'p_abc123', signedDate: '2026-10-20' });
    expect(applyPartnerChange(signed, { kind: 'setStage', partnerId: 'p_abc123', to: 'recruitment' }, stamp()))
      .toMatchObject({ ok: false, error: 'invalid', message: COPY.NO_BACK_TO_RECRUITMENT });
  });

  it('says a partner already has a qualification with plain copy', () => {
    expect(applyPartnerChange(sampleBook(), { kind: 'add', entity: 'qualification', values: { partnerId: 'p_abc123' } }, stamp()))
      .toMatchObject({ ok: false, message: COPY.FIX_FIELDS, fieldErrors: { partnerId: COPY.ALREADY_QUALIFIED } });
  });

  it('keeps rows of a deleted partner as dangling', () => {
    const book = sampleBook({ people: [person()], calls: [call()], marketLinks: [marketLink()], qualifications: [] });
    const next = ok(book, { kind: 'delete', entity: 'partner', id: 'p_abc123' });
    expect(next.partners).toEqual([]);
    expect(next.people).toHaveLength(1);
    expect(next.calls).toHaveLength(1);
    expect(next.marketLinks).toHaveLength(1);
    expect(danglingRefs(next)).toEqual([
      { entity: 'call', id: 'k_abc123', field: 'partnerId' },
      { entity: 'marketLink', id: 'l_abc123', field: 'partnerId' },
    ]);
    expect(danglingRefs(book)).toEqual([]);
  });

  it('reports sections and people whose account is gone', () => {
    const book = sampleBook({ accounts: [], qualifications: [] });
    expect(danglingRefs(book)).toEqual([
      { entity: 'partner', id: 'p_abc123', field: 'accountId' },
      { entity: 'person', id: 'e_abc123', field: 'accountId' },
    ]);
  });

  it('counts the active sellers of one account', () => {
    const book = sampleBook({
      people: [person(), person({ id: 'e_2', activeSeller: false }), person({ id: 'e_3', accountId: 'a_other1' })],
    });
    expect(activeSellerCount(book, 'a_abc123')).toBe(1);
  });
});

describe('accounts and their sections', () => {
  const acme = () => sampleBook({ accounts: [anAccount({ company: 'Acme' })] });

  it('adds an account with defaults and the actor', () => {
    const next = ok(sampleBook(), { kind: 'add', entity: 'account', values: { company: 'Kappa AG' } });
    expect(next.accounts.at(-1)).toEqual({
      id: 'account_new', company: 'Kappa AG', website: '', country: '', vertical: '', subVertical: '', targetCustomerType: 'unknown',
      comments: '', updatedAt: NOW, updatedBy: 'Ruth',
    });
  });

  it('needs a company name for an account', () => {
    expect(applyPartnerChange(sampleBook(), { kind: 'add', entity: 'account', values: { company: ' ' } }, stamp()))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { company: expect.any(String) } });
  });

  it('refuses a partner whose account is unknown', () => {
    expect(applyPartnerChange(sampleBook(), { kind: 'add', entity: 'partner', values: { accountId: 'a_nope00', partnerType: 'referral' } }, stamp()))
      .toEqual({ ok: false, error: 'invalid', message: COPY.PARTNER_GONE, fieldErrors: { accountId: COPY.PARTNER_GONE } });
    expect(applyPartnerChange(sampleBook(), { kind: 'add', entity: 'partner', values: { partnerType: 'referral' } }, stamp()))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { accountId: COPY.PARTNER_GONE } });
  });

  it('refuses a second section of the same type on one account', () => {
    const message = 'Acme is already a reseller.';
    expect(applyPartnerChange(acme(), { kind: 'add', entity: 'partner', values: { accountId: 'a_abc123', partnerType: 'reseller' } }, stamp()))
      .toEqual({ ok: false, error: 'invalid', message, fieldErrors: { partnerType: message } });
    const next = ok(acme(), { kind: 'add', entity: 'partner', values: { accountId: 'a_abc123', partnerType: 'referral' } });
    expect(next.partners.map((p) => [p.accountId, p.partnerType])).toEqual([['a_abc123', 'reseller'], ['a_abc123', 'referral']]);
  });

  it('allows the same type on another account', () => {
    const book = sampleBook({ accounts: [anAccount(), anAccount({ id: 'a_beta01', company: 'Beta' })] });
    expect(applyPartnerChange(book, { kind: 'add', entity: 'partner', values: { accountId: 'a_beta01', partnerType: 'reseller' } }, stamp()))
      .toMatchObject({ ok: true });
  });

  it('refuses a partner type or account in an update', () => {
    expect(applyPartnerChange(acme(), { kind: 'update', entity: 'partner', id: 'p_abc123', patch: { partnerType: 'referral' } }, stamp()))
      .toEqual({ ok: false, error: 'invalid', message: COPY.TYPE_FIXED, fieldErrors: { partnerType: COPY.TYPE_FIXED } });
    const book = sampleBook({ accounts: [anAccount(), anAccount({ id: 'a_beta01', company: 'Beta' })] });
    expect(applyPartnerChange(book, { kind: 'update', entity: 'partner', id: 'p_abc123', patch: { accountId: 'a_beta01' } }, stamp()))
      .toEqual({ ok: false, error: 'invalid', message: COPY.COMPANY_FIXED, fieldErrors: { accountId: COPY.COMPANY_FIXED } });
  });

  it('updates the company facts on the account', () => {
    const next = ok(sampleBook(), { kind: 'update', entity: 'account', id: 'a_abc123', patch: { country: 'Germany', comments: 'Met at a fair' } });
    expect(next.accounts[0]).toMatchObject({ country: 'Germany', comments: 'Met at a fair', updatedAt: NOW, updatedBy: 'Ruth' });
  });

  it('refuses to delete an account that still has sections', () => {
    expect(applyPartnerChange(sampleBook(), { kind: 'delete', entity: 'account', id: 'a_abc123' }, stamp()))
      .toEqual({ ok: false, error: 'invalid', message: COPY.PARTNER_HAS_TYPES });
    const empty = ok(ok(sampleBook(), { kind: 'delete', entity: 'partner', id: 'p_abc123' }), { kind: 'delete', entity: 'person', id: 'e_abc123' });
    expect(ok(empty, { kind: 'delete', entity: 'account', id: 'a_abc123' }).accounts).toEqual([]);
  });

  it('refuses to delete an account while a person still names it, and allows it once the people are gone', () => {
    const noTypes = ok(sampleBook(), { kind: 'delete', entity: 'partner', id: 'p_abc123' });
    expect(noTypes.people.some((p) => p.accountId === 'a_abc123')).toBe(true);
    expect(applyPartnerChange(noTypes, { kind: 'delete', entity: 'account', id: 'a_abc123' }, stamp()))
      .toEqual({ ok: false, error: 'invalid', message: COPY.PARTNER_HAS_CONTACTS });
    const empty = ok(noTypes, { kind: 'delete', entity: 'person', id: 'e_abc123' });
    expect(ok(empty, { kind: 'delete', entity: 'account', id: 'a_abc123' }).accounts).toEqual([]);
  });

  it('needs a known account for a person', () => {
    expect(applyPartnerChange(sampleBook(), { kind: 'add', entity: 'person', values: { accountId: 'a_nope00', name: 'Max' } }, stamp()))
      .toEqual({ ok: false, error: 'invalid', message: COPY.PARTNER_GONE, fieldErrors: { accountId: COPY.PARTNER_GONE } });
    expect(applyPartnerChange(sampleBook(), { kind: 'add', entity: 'person', values: { name: 'Max' } }, stamp()))
      .toMatchObject({ ok: false, fieldErrors: { accountId: COPY.PARTNER_GONE } });
    expect(applyPartnerChange(sampleBook(), { kind: 'update', entity: 'person', id: 'e_abc123', patch: { accountId: 'a_nope00' } }, stamp()))
      .toMatchObject({ ok: false, fieldErrors: { accountId: COPY.PARTNER_GONE } });
  });

  describe('undoSigned and correctExit', () => {
    const signedBook = (stage: 'onboarding' | 'growth' | 'expansion') => {
      const b = ok(sampleBook(), { kind: 'markSigned', partnerId: 'p_abc123', signedDate: '2026-10-20' });
      return stage === 'onboarding' ? b : ok(stage === 'growth' ? b : ok(b, { kind: 'setStage', partnerId: 'p_abc123', to: 'growth' }),
        { kind: 'setStage', partnerId: 'p_abc123', to: stage });
    };
    it.each(['onboarding', 'growth', 'expansion'] as const)('undoes a signing in %s', (stage) => {
      const before = signedBook(stage);
      const after = ok(before, { kind: 'undoSigned', partnerId: 'p_abc123' });
      expect(after.partners[0]!).toMatchObject({ stage: 'recruitment', step: 'map', signedDate: null, updatedAt: NOW, updatedBy: 'Ruth' });
      expect(after.calls).toEqual(before.calls);
      expect(after.partners[0]!.mapLink).toBe(before.partners[0]!.mapLink);
    });
    it('refuses to undo a signing never made, and one already exited', () => {
      expect(applyPartnerChange(sampleBook(), { kind: 'undoSigned', partnerId: 'p_abc123' }, stamp()))
        .toMatchObject({ ok: false, error: 'invalid', message: COPY.UNDO_SIGNED_NOT_SIGNED });
      const exited = ok(signedBook('growth'), { kind: 'markExited', partnerId: 'p_abc123', exitedDate: '2026-12-01', reason: 'x' });
      expect(applyPartnerChange(exited, { kind: 'undoSigned', partnerId: 'p_abc123' }, stamp()))
        .toMatchObject({ ok: false, error: 'invalid', message: COPY.UNDO_SIGNED_EXITED });
    });
    it('says gone for an unknown partner', () => {
      expect(applyPartnerChange(sampleBook(), { kind: 'undoSigned', partnerId: 'nope' }, stamp())).toMatchObject({ ok: false, error: 'not_found' });
    });
    it('corrects an exit', () => {
      const exited = ok(signedBook('growth'), { kind: 'markExited', partnerId: 'p_abc123', exitedDate: '2026-12-01', reason: 'x' });
      const after = ok(exited, { kind: 'correctExit', partnerId: 'p_abc123', exitedDate: '2026-11-15', reason: ' Went direct ' });
      expect(after.partners[0]!).toMatchObject({ stage: 'exit', exitedDate: '2026-11-15', exitReason: 'Went direct' });
    });
    it('refuses a correction before signing, with no reason, or on a partner not exited', () => {
      const exited = ok(signedBook('growth'), { kind: 'markExited', partnerId: 'p_abc123', exitedDate: '2026-12-01', reason: 'x' });
      expect(applyPartnerChange(exited, { kind: 'correctExit', partnerId: 'p_abc123', exitedDate: '2026-10-01', reason: 'x' }, stamp()))
        .toMatchObject({ ok: false, message: COPY.EXIT_DATE_BEFORE_SIGNING, fieldErrors: { exitedDate: COPY.EXIT_DATE_BEFORE_SIGNING } });
      expect(applyPartnerChange(exited, { kind: 'correctExit', partnerId: 'p_abc123', exitedDate: '2026-12-02', reason: ' ' }, stamp()))
        .toMatchObject({ ok: false, message: COPY.REASON_NEEDED, fieldErrors: { reason: COPY.REASON_NEEDED } });
      expect(applyPartnerChange(signedBook('growth'), { kind: 'correctExit', partnerId: 'p_abc123', exitedDate: '2026-12-02', reason: 'x' }, stamp()))
        .toMatchObject({ ok: false, message: COPY.CORRECT_EXIT_NOT_EXITED });
    });
    it('still refuses these fields in plain updates', () => {
      expect(applyPartnerChange(sampleBook(), { kind: 'update', entity: 'partner', id: 'p_abc123', patch: { exitedDate: '2026-01-01' } }, stamp()))
        .toMatchObject({ ok: false, message: COPY.USE_OWN_CHANGES });
    });
  });
});

describe('a partner type’s program and level', () => {
  it('starts a new partner type in no program', () => {
    const book = ok(sampleBook(), { kind: 'add', entity: 'partner', values: { accountId: 'a_abc123', partnerType: 'referral' } });
    expect(book.partners.at(-1)).toMatchObject({ programId: null, level: null });
  });

  it('sets, moves and clears the program and level as plain fields', () => {
    let book = ok(sampleBook(), { kind: 'update', entity: 'partner', id: 'p_abc123', patch: { programId: 'pg_dach0001', level: 'reg' } });
    expect(book.partners[0]).toMatchObject({ programId: 'pg_dach0001', level: 'reg', updatedAt: NOW, updatedBy: 'Ruth' });
    book = ok(book, { kind: 'update', entity: 'partner', id: 'p_abc123', patch: { level: 'pref' } });
    expect(book.partners[0]).toMatchObject({ programId: 'pg_dach0001', level: 'pref' });
    book = ok(book, { kind: 'update', entity: 'partner', id: 'p_abc123', patch: { programId: null, level: null } });
    expect(book.partners[0]).toMatchObject({ programId: null, level: null });
  });

  it('refuses a level without a program, naming the level, and changes nothing', () => {
    const book = sampleBook();
    expect(applyPartnerChange(book, { kind: 'update', entity: 'partner', id: 'p_abc123', patch: { level: 'reg' } }, stamp()))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { level: COPY.LEVEL_NEEDS_PROGRAM } });
    const placed = ok(book, { kind: 'update', entity: 'partner', id: 'p_abc123', patch: { programId: 'pg_dach0001', level: 'pref' } });
    expect(applyPartnerChange(placed, { kind: 'update', entity: 'partner', id: 'p_abc123', patch: { programId: null } }, stamp()))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { level: COPY.LEVEL_NEEDS_PROGRAM } });
  });

  it('reads a program without a level as Registered, and no program as no level', () => {
    expect(levelOf(aPartner({ programId: 'pg_dach0001', level: null }))).toBe('reg');
    expect(levelOf(aPartner({ programId: 'pg_dach0001', level: 'pref' }))).toBe('pref');
    expect(levelOf(aPartner())).toBeNull();
  });
});

describe('setMapSummary: the MAP health and next milestone, written by the MAP commands', () => {
  it('sets only the two MAP fields and leaves Updated and Updated by as they were', () => {
    const before = sampleBook().partners[0]!;
    const book = ok(sampleBook(), { kind: 'setMapSummary', partnerId: 'p_abc123', health: 'at_risk', nextMilestone: '2026-11-20' });
    expect(book.partners[0]).toEqual({ ...before, mapHealth: 'at_risk', mapNextMilestone: '2026-11-20' });
    const cleared = ok(book, { kind: 'setMapSummary', partnerId: 'p_abc123', health: null, nextMilestone: null });
    expect(cleared.partners[0]).toEqual({ ...before, mapHealth: null, mapNextMilestone: null });
  });

  it('refuses a partner type that is gone, a stale row and a value it can’t store, and changes nothing', () => {
    const book = sampleBook();
    expect(applyPartnerChange(book, { kind: 'setMapSummary', partnerId: 'p_gone', health: 'on_track', nextMilestone: null }, stamp()))
      .toMatchObject({ ok: false, error: 'not_found' });
    expect(applyPartnerChange(book, {
      kind: 'setMapSummary', partnerId: 'p_abc123', health: 'on_track', nextMilestone: null, expectedUpdatedAt: '1999-01-01T00:00:00.000Z',
    }, stamp())).toMatchObject({ ok: false, error: 'conflict' });
    expect(applyPartnerChange(book, {
      kind: 'setMapSummary', partnerId: 'p_abc123', health: 'great' as never, nextMilestone: null,
    }, stamp())).toMatchObject({ ok: false, error: 'invalid' });
    expect(book).toEqual(sampleBook());
  });
});

describe('MOVES_STAGE: the changes that move a partner type\'s stage (they send partner.stage_changed)', () => {
  const signed = aPartner({ stage: 'onboarding', step: null, signedDate: '2026-10-01' });
  const exited = aPartner({ stage: 'exit', step: null, signedDate: '2026-10-01', exitedDate: '2026-10-20', exitReason: 'Ended' });
  // One change of every kind that applies to the partner type: a new kind fails the typecheck here until it has one.
  const examples: Record<PartnerChange['kind'], { partner: Partner; change: PartnerChange }> = {
    add: { partner: aPartner(), change: { kind: 'add', entity: 'call', values: { partnerId: 'p_abc123' } } },
    update: { partner: aPartner(), change: { kind: 'update', entity: 'partner', id: 'p_abc123', patch: { whyItFits: 'Fits' } } },
    delete: { partner: aPartner(), change: { kind: 'delete', entity: 'call', id: 'k_abc123' } },
    setStep: { partner: aPartner(), change: { kind: 'setStep', partnerId: 'p_abc123', to: 'discovery_call' } },
    markSigned: { partner: aPartner(), change: { kind: 'markSigned', partnerId: 'p_abc123', signedDate: '2026-10-01' } },
    setStage: { partner: signed, change: { kind: 'setStage', partnerId: 'p_abc123', to: 'growth' } },
    close: { partner: aPartner(), change: { kind: 'close', partnerId: 'p_abc123', as: 'no', reason: 'Too small' } },
    reopen: { partner: aPartner({ closed: 'no', closedReason: 'Too small' }), change: { kind: 'reopen', partnerId: 'p_abc123' } },
    markExited: { partner: signed, change: { kind: 'markExited', partnerId: 'p_abc123', exitedDate: '2026-10-20', reason: 'Ended' } },
    undoSigned: { partner: signed, change: { kind: 'undoSigned', partnerId: 'p_abc123' } },
    correctExit: { partner: exited, change: { kind: 'correctExit', partnerId: 'p_abc123', exitedDate: '2026-10-21', reason: 'Later' } },
    setMapSummary: { partner: aPartner(), change: { kind: 'setMapSummary', partnerId: 'p_abc123', health: 'on_track', nextMilestone: null } },
  };

  it.each(Object.keys(examples) as Array<PartnerChange['kind']>)('%s: says whether the stage moves, as applying it does', (kind) => {
    const { partner, change } = examples[kind];
    const after = ok(sampleBook({ partners: [partner] }), change).partners.find((p) => p.id === 'p_abc123')!;
    expect(after.stage !== partner.stage).toBe(MOVES_STAGE[kind]);
  });
});

describe('the Proposals rows: written by the proposals commands only', () => {
  it('a proposalItem adds and updates through applyPartnerChanges like any row', () => {
    // What the proposals commands send: every field but the ones the app sets.
    const values: Record<string, unknown> = { ...proposalItem() };
    for (const key of ['id', 'updatedAt', 'updatedBy']) delete values[key];
    let n = 0;
    const added = applyPartnerChanges(sampleBook(), [
      { kind: 'add', entity: 'proposalItem', values: { ...values, id: 'tmp_r1' } },
      { kind: 'add', entity: 'proposalItem', values: { proposalId: 'prp_abc123', kind: 'stage', what: 'step', proposed: 'Discovery call',
        proposedBy: 'Claude for Ruth', proposedOn: NOW, expiresOn: '2026-11-27T10:00:00.000Z' } },
    ], stamp({ newId: (kind) => `${kind}_${++n}` }));
    if (!added.ok) throw new Error(added.message);
    expect(added.entityIds).toEqual(['proposalItem_1', 'proposalItem_2']);
    const [first, second] = added.value.proposalItems;
    expect(first).toEqual({ ...proposalItem(), id: added.entityIds[0], updatedAt: NOW, updatedBy: 'Ruth' });
    // What a new row starts with: empty texts, no target, no answer, waiting.
    expect(second).toEqual({
      id: added.entityIds[1], proposalId: 'prp_abc123', kind: 'stage', accountId: null, partnerId: null, marketId: null, hypothesisId: null,
      about: '', what: 'step', proposed: 'Discovery call', details: '', evidence: '', proposedBy: 'Claude for Ruth', status: 'waiting',
      answerNote: '', proposedOn: NOW, answeredOn: null, expiresOn: '2026-11-27T10:00:00.000Z', targetUpdated: null, updatedAt: NOW,
      updatedBy: 'Ruth',
    });
    // The rest of the book is as it was.
    expect({ ...added.value, proposalItems: [] }).toEqual(sampleBook());

    const book = sampleBook({ proposalItems: [proposalItem()] });
    const answered = applyPartnerChanges(book, [{
      kind: 'update', entity: 'proposalItem', id: 'r_abc123', expectedUpdatedAt: EARLIER,
      patch: { status: 'rejected', answerNote: 'Not yet', answeredOn: NOW },
    }], stamp());
    if (!answered.ok) throw new Error(answered.message);
    expect(answered.value.proposalItems).toEqual([
      { ...proposalItem(), status: 'rejected', answerNote: 'Not yet', answeredOn: NOW, updatedAt: NOW, updatedBy: 'Ruth' },
    ]);
    expect(applyPartnerChanges(book, [{ kind: 'update', entity: 'proposalItem', id: 'r_abc123', patch: { status: 'later' } }], stamp()))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { status: expect.any(String) } });
    expect(applyPartnerChanges(book, [{ kind: 'update', entity: 'proposalItem', id: 'r_abc123', patch: { status: 'accepted' }, expectedUpdatedAt: NOW }], stamp()))
      .toMatchObject({ ok: false, error: 'conflict' });
  });
});
