import { describe, expect, it } from 'vitest';
import { COPY } from '@partner-desk/copy';
import { parseMarketChange } from './change-schema';
import type { MarketChange } from './changes';

describe('parseMarketChange', () => {
  it('accepts every kind of change', () => {
    const changes: MarketChange[] = [
      { kind: 'updateInfo', patch: { marketName: 'Austria', expectedCandidates: 5 }, expectedUpdatedAt: null },
      { kind: 'updateInfo', patch: { statement: 'Back', checkAgain: ['mustHaves', 'statement'] } },
      { kind: 'add', entity: 'exclusion', values: { company: 'Acme', website: 'acme.at' } },
      { kind: 'add', entity: 'change', values: { what: 'Now holds', entity: 'hypothesis', entityId: 'h_1', callId: 'k_1' } },
      { kind: 'update', entity: 'valuePoint', id: 'v_1', patch: { state: 'confirmed' }, expectedUpdatedAt: '2026-10-21T10:00:00.000Z' },
      { kind: 'delete', entity: 'exclusion', id: 'x_1' },
      { kind: 'clearCheckAgain', target: { entity: 'market', field: 'statement' } },
      { kind: 'clearCheckAgain', target: { entity: 'hypothesis', id: 'h_1' } },
    ];
    for (const change of changes) expect(parseMarketChange(change)).toEqual({ ok: true, change });
  });

  it('rejects malformed input, partner entities and stage changes', () => {
    const bad: unknown[] = [
      null, 'delete everything', { kind: 'drop', entity: 'exclusion', id: 'x_1' },
      { kind: 'delete', entity: 'market', id: 'x_1' }, { kind: 'delete', entity: 'partner', id: 'p_1' },
      { kind: 'delete', entity: 'exclusion', id: '' }, { kind: 'delete', entity: 'exclusion', id: 'x'.repeat(65) },
      { kind: 'update', entity: 'exclusion', id: 'x_1', patch: { isAdmin: true } },
      { kind: 'updateInfo', patch: { marketName: 'X', extra: 1 } },
      { kind: 'updateInfo', patch: { updatedAt: '2026-10-21T10:00:00.000Z' } },
      { kind: 'updateInfo', patch: { updatedBy: 'Evil' } },
      { kind: 'updateInfo', patch: { marketId: 'm_other' } },
      { kind: 'updateInfo', patch: { companyId: 'co_other' } },
      { kind: 'setStage', partnerId: 'p_1', to: 'growth' },
      { kind: 'close', partnerId: 'p_1', as: 'no', reason: 'x' },
      { kind: 'clearCheckAgain', target: { entity: 'exclusion', id: 'x_1' } },
    ];
    for (const input of bad) expect(parseMarketChange(input)).toEqual({ ok: false });
  });

  it('refuses a partner type: the type is fixed once the market is made', () => {
    expect(parseMarketChange({ kind: 'updateInfo', patch: { partnerType: 'referral' } })).toEqual({ ok: false });
    expect(parseMarketChange({ kind: 'updateInfo', patch: { marketName: 'Austria', partnerType: 'reseller' } })).toEqual({ ok: false });
  });

  it('refuses a technology partner type', () => {
    expect(parseMarketChange({ kind: 'updateInfo', patch: { partnerType: 'technology' } })).toMatchObject({ ok: false });
  });

  it('rejects server-managed fields in add and update', () => {
    expect(parseMarketChange({ kind: 'add', entity: 'exclusion', values: { company: 'X', id: 'x_evil' } })).toEqual({ ok: false });
    expect(parseMarketChange({ kind: 'add', entity: 'exclusion', values: { company: 'X', updatedAt: 'x' } })).toEqual({ ok: false });
    expect(parseMarketChange({ kind: 'add', entity: 'exclusion', values: { company: 'X', updatedBy: 'x' } })).toEqual({ ok: false });
    expect(parseMarketChange({ kind: 'update', entity: 'exclusion', id: 'x_1', patch: { id: 'x_2' } })).toEqual({ ok: false });
  });

  it('names the fields whose values are wrong', () => {
    expect(parseMarketChange({ kind: 'update', entity: 'hypothesis', id: 'h_1', patch: { theirSide: 'x'.repeat(45_001) } }))
      .toEqual({ ok: false, fieldErrors: { theirSide: COPY.TOO_LONG } });
    expect(parseMarketChange({ kind: 'updateInfo', patch: { statement: 'x'.repeat(45_001) } }))
      .toEqual({ ok: false, fieldErrors: { statement: COPY.TOO_LONG } });
    expect(parseMarketChange({ kind: 'updateInfo', patch: { checkAgain: ['statement', 'nope'] } }))
      .toEqual({ ok: false, fieldErrors: { 'checkAgain.1': expect.any(String) } });
  });
});

describe('parseMarketChange: the program a market feeds', () => {
  it('lets the market details set or clear the program it feeds', () => {
    const changes: MarketChange[] = [
      { kind: 'updateInfo', patch: { feedsProgramId: 'pg_dach0001' } },
      { kind: 'updateInfo', patch: { feedsProgramId: null } },
    ];
    for (const change of changes) expect(parseMarketChange(change)).toEqual({ ok: true, change });
    expect(parseMarketChange({ kind: 'updateInfo', patch: { feedsProgramId: '' } })).toMatchObject({ ok: false });
  });
});
