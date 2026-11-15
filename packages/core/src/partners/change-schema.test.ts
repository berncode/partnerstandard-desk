import { describe, expect, it } from 'vitest';
import { COPY } from '@partner-desk/copy';
import { parsePartnerChange } from './change-schema';
import type { PartnerChange } from './changes';
import { TOO_LONG } from '../shared/schemas';

describe('parsePartnerChange', () => {
  it('accepts every kind of change', () => {
    const changes: PartnerChange[] = [
      { kind: 'add', entity: 'account', values: { company: 'Acme', website: 'acme.at' } },
      { kind: 'add', entity: 'partner', values: { accountId: 'a_1', partnerType: 'reseller', source: 'existing_partner' } },
      { kind: 'update', entity: 'account', id: 'a_1', patch: { country: 'Austria' } },
      { kind: 'delete', entity: 'account', id: 'a_1' },
      { kind: 'add', entity: 'marketLink', values: { partnerId: 'p_1', marketId: 'm_1' } },
      { kind: 'update', entity: 'person', id: 'e_1', patch: { activeSeller: true }, expectedUpdatedAt: '2026-10-21T10:00:00.000Z' },
      { kind: 'delete', entity: 'call', id: 'k_1' },
      { kind: 'setStep', partnerId: 'p_1', to: 'qualification' },
      { kind: 'markSigned', partnerId: 'p_1', signedDate: '2026-10-20' },
      { kind: 'setStage', partnerId: 'p_1', to: 'growth' },
      { kind: 'close', partnerId: 'p_1', as: 'not_now', reason: 'Busy until spring' },
      { kind: 'reopen', partnerId: 'p_1' },
      { kind: 'markExited', partnerId: 'p_1', exitedDate: '2026-12-01', reason: 'Went direct' },
      { kind: 'undoSigned', partnerId: 'p_1' },
      { kind: 'correctExit', partnerId: 'p_1', exitedDate: '2026-12-01', reason: 'Went direct' },
    ];
    for (const change of changes) expect(parsePartnerChange(change)).toEqual({ ok: true, change });
  });

  it('rejects malformed or unexpected input', () => {
    const bad: unknown[] = [
      null, 'delete everything', { kind: 'drop', entity: 'partner', id: 'p_1' },
      { kind: 'delete', entity: 'valuePoint', id: 'p_1' }, { kind: 'delete', entity: 'partner', id: '' },
      { kind: 'delete', entity: 'partner', id: 'p'.repeat(65) },
      { kind: 'update', entity: 'partner', id: 'p_1', patch: { isAdmin: true } },
      { kind: 'setStep', partnerId: 'p_1', to: 'won' },
      { kind: 'setStage', partnerId: 'p_1', to: 'signed' },
      { kind: 'markSigned', partnerId: 'p_1' },
      { kind: 'reopen', partnerId: 'p_1', stage: 'signed' },
    ];
    for (const input of bad) expect(parsePartnerChange(input)).toEqual({ ok: false });
  });

  it('accepts partial object fields: only the changed sub-fields travel', () => {
    const changes: PartnerChange[] = [
      { kind: 'update', entity: 'partner', id: 'p_1', patch: { desk: { credibility: 2 } } },
      { kind: 'update', entity: 'partner', id: 'p_1', patch: { confirmed: { commitment: null } } },
      { kind: 'update', entity: 'call', id: 'k_1', patch: { topics: { costDrivers: 'Travel' } } },
      { kind: 'update', entity: 'qualification', id: 'q_1', patch: { caso: { culture: { note: 'Fast' } } } },
    ];
    for (const change of changes) expect(parsePartnerChange(change)).toEqual({ ok: true, change });
  });

  it('refuses unknown sub-fields, and names a wrong sub-field value', () => {
    expect(parsePartnerChange({ kind: 'update', entity: 'partner', id: 'p_1', patch: { desk: { isAdmin: 1 } } })).toEqual({ ok: false });
    expect(parsePartnerChange({ kind: 'update', entity: 'partner', id: 'p_1', patch: { desk: { credibility: 5 } } }))
      .toEqual({ ok: false, fieldErrors: { 'desk.credibility': COPY.INVALID_SCORE } });
  });

  it('keeps an add\'s own id, and still rejects the other server-managed fields', () => {
    expect(parsePartnerChange({ kind: 'add', entity: 'partner', values: { accountId: 'a_1', partnerType: 'reseller', id: 'p_kept' } }))
      .toEqual({ ok: true, change: { kind: 'add', entity: 'partner', values: { id: 'p_kept', accountId: 'a_1', partnerType: 'reseller' } } });
    expect(parsePartnerChange({ kind: 'add', entity: 'partner', values: { accountId: 'a_1', id: '' } })).toEqual({ ok: false });
    expect(parsePartnerChange({ kind: 'add', entity: 'partner', values: { accountId: 'a_1', id: 'p'.repeat(65) } })).toEqual({ ok: false });
    expect(parsePartnerChange({ kind: 'add', entity: 'partner', values: { accountId: 'a_1', updatedAt: 'x' } })).toEqual({ ok: false });
    expect(parsePartnerChange({ kind: 'add', entity: 'account', values: { company: 'X', updatedBy: 'x' } })).toEqual({ ok: false });
    expect(parsePartnerChange({ kind: 'add', entity: 'partner', values: { accountId: 'a_1', companyId: 'co_other' } })).toEqual({ ok: false });
    expect(parsePartnerChange({ kind: 'update', entity: 'partner', id: 'p_1', patch: { id: 'p_2' } })).toEqual({ ok: false });
  });

  it('names the fields whose values are wrong', () => {
    expect(parsePartnerChange({ kind: 'update', entity: 'call', id: 'k_1', patch: { notes: 'x'.repeat(45_001) } }))
      .toEqual({ ok: false, fieldErrors: { notes: TOO_LONG } });
    expect(parsePartnerChange({ kind: 'add', entity: 'person', values: { name: 'Eva', email: 'nope' } }))
      .toEqual({ ok: false, fieldErrors: { email: COPY.INVALID_EMAIL } });
    expect(parsePartnerChange({ kind: 'close', partnerId: 'p_1', as: 'no', reason: 'x'.repeat(45_001) }))
      .toEqual({ ok: false, fieldErrors: { reason: TOO_LONG } });
    expect(parsePartnerChange({ kind: 'markExited', partnerId: 'p_1', exitedDate: '2026-13-40', reason: 'x' }))
      .toEqual({ ok: false, fieldErrors: { exitedDate: COPY.INVALID_DATE } });
  });

  it('does not let an update change who a qualification or market link belongs to', () => {
    expect(parsePartnerChange({ kind: 'update', entity: 'marketLink', id: 'l_1', patch: { marketId: 'm_2' } })).toEqual({ ok: false });
    expect(parsePartnerChange({ kind: 'update', entity: 'marketLink', id: 'l_1', patch: { partnerId: 'p_2' } })).toEqual({ ok: false });
    expect(parsePartnerChange({ kind: 'update', entity: 'qualification', id: 'q_1', patch: { partnerId: 'p_2' } })).toEqual({ ok: false });
    expect(parsePartnerChange({ kind: 'update', entity: 'marketLink', id: 'l_1', patch: { hypothesisId: 'h_1' } })).toMatchObject({ ok: true });
    expect(parsePartnerChange({ kind: 'add', entity: 'marketLink', values: { partnerId: 'p_1', marketId: 'm_1' } })).toMatchObject({ ok: true });
  });

  it('does not let an update change a partner type or the company it belongs to', () => {
    expect(parsePartnerChange({ kind: 'update', entity: 'partner', id: 'p_1', patch: { partnerType: 'referral' } })).toEqual({ ok: false });
    expect(parsePartnerChange({ kind: 'update', entity: 'partner', id: 'p_1', patch: { accountId: 'a_2' } })).toEqual({ ok: false });
    expect(parsePartnerChange({ kind: 'add', entity: 'partner', values: { accountId: 'a_1', partnerType: 'referral' } })).toMatchObject({ ok: true });
  });

  it('keeps company facts on the account, not on a partner type', () => {
    expect(parsePartnerChange({ kind: 'add', entity: 'partner', values: { accountId: 'a_1', company: 'Acme' } })).toEqual({ ok: false });
    expect(parsePartnerChange({ kind: 'update', entity: 'partner', id: 'p_1', patch: { comments: 'x' } })).toEqual({ ok: false });
    expect(parsePartnerChange({ kind: 'add', entity: 'person', values: { accountId: 'a_1', name: 'Eva' } })).toMatchObject({ ok: true });
  });

  it('lets setStage to recruitment through, for the rule to refuse', () => {
    expect(parsePartnerChange({ kind: 'setStage', partnerId: 'p_1', to: 'recruitment' })).toMatchObject({ ok: true });
  });
});

describe('parsePartnerChange: program and level', () => {
  it('lets an update set a program and a level, or clear them', () => {
    const changes: PartnerChange[] = [
      { kind: 'update', entity: 'partner', id: 'p_1', patch: { programId: 'pg_dach0001', level: 'pref' } },
      { kind: 'update', entity: 'partner', id: 'p_1', patch: { programId: null, level: null } },
      { kind: 'add', entity: 'partner', values: { accountId: 'a_1', partnerType: 'reseller', programId: 'pg_dach0001', level: 'reg' } },
    ];
    for (const change of changes) expect(parsePartnerChange(change)).toEqual({ ok: true, change });
  });

  it('names a level that is not Registered or Preferred', () => {
    const parsed = parsePartnerChange({ kind: 'update', entity: 'partner', id: 'p_1', patch: { level: 'gold' } });
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && Object.keys(parsed.fieldErrors ?? {})).toEqual(['level']);
  });
});

describe('parsePartnerChange: MAP fields', () => {
  it('refuses a change that sets mapHealth or mapNextMilestone, on an update and on an add', () => {
    const changes = [
      { kind: 'update', entity: 'partner', id: 'p_1', patch: { mapHealth: 'on_track' } },
      { kind: 'update', entity: 'partner', id: 'p_1', patch: { mapNextMilestone: '2026-11-01' } },
      { kind: 'add', entity: 'partner', values: { accountId: 'a_1', partnerType: 'reseller', mapHealth: 'at_risk' } },
    ];
    for (const change of changes) expect(parsePartnerChange(change).ok).toBe(false);
  });
});

describe('parsePartnerChange: setMapSummary', () => {
  it('never parses the MAP commands’ own change from input', () => {
    expect(parsePartnerChange({ kind: 'setMapSummary', partnerId: 'p_1', health: 'on_track', nextMilestone: null }).ok).toBe(false);
  });
});

describe('parsePartnerChange: the Proposals rows', () => {
  it('parsePartnerChange refuses an add, update or delete of a proposalItem', () => {
    const changes = [
      { kind: 'add', entity: 'proposalItem', values: { proposalId: 'prp_1', kind: 'fourC', what: 'desk.credibility', proposed: '3' } },
      { kind: 'update', entity: 'proposalItem', id: 'r_1', patch: { status: 'accepted' } },
      { kind: 'delete', entity: 'proposalItem', id: 'r_1' },
    ];
    for (const change of changes) expect(parsePartnerChange(change)).toEqual({ ok: false });
  });
});
