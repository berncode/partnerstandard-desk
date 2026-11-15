import { describe, expect, it } from 'vitest';
import { COPY } from '@partner-desk/copy';
import { NOW, sampleBook, stamp } from '../test-builders';
import { applyPartnerChanges, MAX_BATCH, parsePartnerChanges, remapPartnerChange } from './batch';
import type { PartnerChange } from './changes';

const importOf = (company: string, provisional: string, evidence = 'Their site'): PartnerChange[] => [
  { kind: 'add', entity: 'account', values: { id: `${provisional}_account`, company } },
  { kind: 'add', entity: 'partner', values: { id: provisional, accountId: `${provisional}_account`, partnerType: 'reseller', source: 'ai_search' } },
  { kind: 'add', entity: 'qualification', values: { partnerId: provisional, deskNotes: { customerBase: evidence } } },
];

/** A stamp whose new ids count up per call: `partner_1`, `qualification_2`, ... */
function counting() {
  let n = 0;
  return stamp({ newId: (kind) => `${kind}_${++n}` });
}

describe('applyPartnerChanges', () => {
  it('applies the changes in order and gives each add a real id that later changes follow', () => {
    const out = applyPartnerChanges(sampleBook(), [...importOf('Kappa GmbH', 'tmp_a'), ...importOf('Lambda AG', 'tmp_b')], counting());
    if (!out.ok) throw new Error(out.message);
    expect(out.entityIds).toEqual(['account_1', 'partner_2', 'qualification_3', 'account_4', 'partner_5', 'qualification_6']);
    expect(out.value.accounts.slice(-2).map((a) => [a.id, a.company, a.updatedAt])).toEqual([
      ['account_1', 'Kappa GmbH', NOW], ['account_4', 'Lambda AG', NOW],
    ]);
    expect(out.value.partners.slice(-2).map((p) => [p.id, p.accountId, p.updatedAt])).toEqual([
      ['partner_2', 'account_1', NOW], ['partner_5', 'account_4', NOW],
    ]);
    expect(out.value.qualifications.slice(-2).map((q) => [q.id, q.partnerId, q.deskNotes.customerBase])).toEqual([
      ['qualification_3', 'partner_2', 'Their site'], ['qualification_6', 'partner_5', 'Their site'],
    ]);
  });

  it('adds a partner and its market link in one batch using the provisional id', () => {
    const out = applyPartnerChanges(sampleBook({ marketLinks: [] }), [
      { kind: 'add', entity: 'partner', values: { id: 'tmp_a', accountId: 'a_abc123', partnerType: 'referral' } },
      { kind: 'add', entity: 'marketLink', values: { partnerId: 'tmp_a', marketId: 'm_abcdefghij' } },
    ], counting());
    if (!out.ok) throw new Error(out.message);
    expect(out.value.marketLinks).toEqual([
      { id: 'marketLink_2', partnerId: 'partner_1', marketId: 'm_abcdefghij', hypothesisId: null, updatedAt: NOW, updatedBy: 'Ruth' },
    ]);
  });

  it('does not re-point a market link when a provisional partner id equals the market id', () => {
    const out = applyPartnerChanges(sampleBook({ marketLinks: [] }), [
      { kind: 'add', entity: 'partner', values: { id: 'm_abcdefghij', accountId: 'a_abc123', partnerType: 'referral' } },
      { kind: 'add', entity: 'marketLink', values: { partnerId: 'm_abcdefghij', marketId: 'm_abcdefghij' } },
    ], counting());
    if (!out.ok) throw new Error(out.message);
    expect(out.value.marketLinks[0]).toMatchObject({ partnerId: 'partner_1', marketId: 'm_abcdefghij' });
  });

  it('can keep the provisional ids as the rows ids (the editor optimistic view)', () => {
    const out = applyPartnerChanges(sampleBook(), importOf('Kappa GmbH', 'p_local1'), stamp(), (_kind, provisional) => provisional);
    if (!out.ok) throw new Error(out.message);
    expect(out.entityIds).toEqual(['p_local1_account', 'p_local1', 'qualification_new']);
    expect(out.value.qualifications.at(-1)?.partnerId).toBe('p_local1');
  });

  it('is all or nothing, and says how many changes came before the one refused', () => {
    const before = sampleBook();
    const changes: PartnerChange[] = [
      ...importOf('Kappa GmbH', 'tmp_a'),
      { kind: 'add', entity: 'account', values: { company: ' ' } },
      ...importOf('Lambda AG', 'tmp_b'),
    ];
    expect(applyPartnerChanges(before, changes, counting())).toEqual({
      ok: false, error: 'invalid', message: COPY.FIX_FIELDS, fieldErrors: { company: 'Company is required' }, valid: 3,
    });
    expect(before).toEqual(sampleBook());
  });

  it('refuses a provisional id used twice or already taken by a row', () => {
    expect(applyPartnerChanges(sampleBook(), [...importOf('Kappa GmbH', 'tmp_a'), ...importOf('Lambda AG', 'tmp_a')], counting()))
      .toMatchObject({ ok: false, error: 'invalid', valid: 3 });
    expect(applyPartnerChanges(sampleBook(), importOf('Kappa GmbH', 'p_abc123'), counting())).toMatchObject({ ok: false, error: 'invalid', valid: 1 });
    expect(applyPartnerChanges(sampleBook(), [{ kind: 'add', entity: 'account', values: { id: 'a_abc123', company: 'X' } }], counting()))
      .toMatchObject({ ok: false, error: 'invalid', valid: 0 });
  });

  it('follows a provisional id in lifecycle changes', () => {
    const out = applyPartnerChanges(sampleBook(), [
      { kind: 'add', entity: 'partner', values: { id: 'tmp_a', accountId: 'a_abc123', partnerType: 'referral' } },
      { kind: 'setStep', partnerId: 'tmp_a', to: 'discovery_call' },
    ], counting());
    if (!out.ok) throw new Error(out.message);
    expect(out.value.partners.at(-1)).toMatchObject({ id: 'partner_1', step: 'discovery_call' });
  });
});

describe('parsePartnerChanges', () => {
  it('accepts up to MAX_BATCH changes, with provisional ids on adds', () => {
    const changes = importOf('Kappa GmbH', 'p_tmp001');
    expect(parsePartnerChanges(changes)).toEqual({ ok: true, changes });
    expect(parsePartnerChanges(Array.from({ length: MAX_BATCH }, () => changes[0]))).toMatchObject({ ok: true });
  });

  it('refuses an empty or oversized batch, or one that is not a list', () => {
    expect(parsePartnerChanges([])).toEqual({ ok: false });
    expect(parsePartnerChanges(Array.from({ length: MAX_BATCH + 1 }, () => importOf('Kappa GmbH', 'p_tmp001')[0]))).toEqual({ ok: false });
    expect(parsePartnerChanges({ kind: 'add' })).toEqual({ ok: false });
  });

  it('names the change and the fields that are wrong', () => {
    const changes = [...importOf('Kappa GmbH', 'p_tmp001').slice(0, 2), { kind: 'add', entity: 'account', values: { company: 'x'.repeat(45_001) } }];
    expect(parsePartnerChanges(changes)).toMatchObject({ ok: false, valid: 2, fieldErrors: { company: expect.any(String) } });
    expect(parsePartnerChanges([{ kind: 'add', entity: 'account', values: { id: '', company: 'X' } }])).toMatchObject({ ok: false, valid: 0 });
    expect(parsePartnerChanges([{ kind: 'update', entity: 'partner', id: 'p_1', patch: { id: 'p_2' } }])).toMatchObject({ ok: false, valid: 0 });
  });
});

describe('remapPartnerChange', () => {
  it('rewrites a change target and references', () => {
    const ids = { p_local: 'p_srv' };
    expect(remapPartnerChange({ kind: 'update', entity: 'person', id: 'e_1', patch: { partnerId: 'p_local' } }, ids))
      .toEqual({ kind: 'update', entity: 'person', id: 'e_1', patch: { partnerId: 'p_srv' } });
    expect(remapPartnerChange({ kind: 'add', entity: 'qualification', values: { partnerId: 'p_local' } }, ids))
      .toEqual({ kind: 'add', entity: 'qualification', values: { partnerId: 'p_srv' } });
    expect(remapPartnerChange({ kind: 'add', entity: 'partner', values: { accountId: 'a_local', partnerType: 'reseller' } }, { a_local: 'a_srv' }))
      .toEqual({ kind: 'add', entity: 'partner', values: { accountId: 'a_srv', partnerType: 'reseller' } });
    expect(remapPartnerChange({ kind: 'add', entity: 'person', values: { accountId: 'a_local', name: 'Eva' } }, { a_local: 'a_srv' }))
      .toEqual({ kind: 'add', entity: 'person', values: { accountId: 'a_srv', name: 'Eva' } });
    expect(remapPartnerChange({ kind: 'close', partnerId: 'p_local', as: 'no', reason: 'x' }, ids))
      .toEqual({ kind: 'close', partnerId: 'p_srv', as: 'no', reason: 'x' });
  });
});
