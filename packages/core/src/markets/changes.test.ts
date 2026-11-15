import { describe, expect, it } from 'vitest';
import { COPY } from '@partner-desk/copy';
import { EARLIER, NOW, sampleMarket, stamp } from '../test-builders';
import { applyMarketChange, type MarketChange } from './changes';
import { itemsToCheck, marketDanglingRefs } from './derived';
import { MARKET_ENTITY_SCHEMAS, marketInfoSchema } from './schemas';
import type { Market } from './types';

function ok(m: Market, change: MarketChange) {
  const out = applyMarketChange(m, change, stamp());
  if (!out.ok) throw new Error(`${out.error}: ${out.message}`);
  return out;
}

describe('applyMarketChange', () => {
  it('has a valid sample market with no dangling references', () => {
    const m = sampleMarket();
    expect(marketInfoSchema.safeParse(m.info).success).toBe(true);
    expect(m.valuePoints.every((r) => MARKET_ENTITY_SCHEMAS.valuePoint.safeParse(r).success)).toBe(true);
    expect(m.hypotheses.every((r) => MARKET_ENTITY_SCHEMAS.hypothesis.safeParse(r).success)).toBe(true);
    expect(m.exclusions.every((r) => MARKET_ENTITY_SCHEMAS.exclusion.safeParse(r).success)).toBe(true);
    expect(m.changes.every((r) => MARKET_ENTITY_SCHEMAS.change.safeParse(r).success)).toBe(true);
    expect(marketDanglingRefs(m)).toEqual([]);
  });

  it('adds with defaults and stamps updatedAt and updatedBy', () => {
    const out = ok(sampleMarket(), { kind: 'add', entity: 'valuePoint', values: { text: 'Fees', id: 'v_hack', updatedAt: EARLIER, updatedBy: 'Evil' } });
    expect(out.entityId).toBe('valuePoint_new');
    expect(out.value.valuePoints.at(-1)).toEqual({
      id: 'valuePoint_new', kind: 'margin_or_fees', text: 'Fees', state: 'assumption', evidence: '', checkAgain: false,
      updatedAt: NOW, updatedBy: 'Ruth',
    });
  });

  it('refuses invalid values on add', () => {
    expect(applyMarketChange(sampleMarket(), { kind: 'add', entity: 'exclusion', values: { company: ' ' } }, stamp()))
      .toMatchObject({ ok: false, error: 'invalid', message: COPY.FIX_FIELDS, fieldErrors: { company: COPY.REQUIRED('Company') } });
  });

  it('stamps updatedBy on every changed row', () => {
    const m = sampleMarket();
    const changes: MarketChange[] = [
      { kind: 'updateInfo', patch: { statement: 'New' } },
      { kind: 'add', entity: 'exclusion', values: { company: 'Beta AG' } },
      { kind: 'add', entity: 'change', values: { what: 'Moved' } },
      { kind: 'update', entity: 'hypothesis', id: 'h_1', patch: { name: 'New name' } },
      { kind: 'update', entity: 'valuePoint', id: 'v_1', patch: { text: 'New' } },
      { kind: 'clearCheckAgain', target: { entity: 'market', field: 'statement' } },
      { kind: 'clearCheckAgain', target: { entity: 'valuePoint', id: 'v_2' } },
    ];
    for (const change of changes) {
      const out = applyMarketChange(m, change, stamp({ actor: 'Claude for Ruth' }));
      if (!out.ok) throw new Error(out.message);
      const rows = [out.value.info, ...out.value.valuePoints, ...out.value.hypotheses, ...out.value.exclusions, ...out.value.changes];
      const stamped = rows.filter((r) => r.updatedAt === NOW);
      expect(stamped.length).toBe(1);
      expect(stamped[0]!.updatedBy).toBe('Claude for Ruth');
    }
  });

  it('updates one row, leaves the others alone and ignores managed fields', () => {
    const m = sampleMarket();
    const out = ok(m, { kind: 'update', entity: 'exclusion', id: 'x_1', patch: { reason: 'Competitor', id: 'x_hack', updatedBy: 'Evil' } });
    expect(out.value.exclusions[0]).toMatchObject({ id: 'x_1', reason: 'Competitor', updatedAt: NOW, updatedBy: 'Ruth' });
    expect(out.value.valuePoints).toEqual(m.valuePoints);
    expect(out.entityId).toBe('x_1');
  });

  it('says not_found for a missing row', () => {
    expect(applyMarketChange(sampleMarket(), { kind: 'update', entity: 'exclusion', id: 'x_nope', patch: {} }, stamp()))
      .toMatchObject({ ok: false, error: 'not_found', message: COPY.GONE });
    expect(applyMarketChange(sampleMarket(), { kind: 'delete', entity: 'exclusion', id: 'x_nope' }, stamp()))
      .toMatchObject({ ok: false, error: 'not_found' });
  });

  it('conflicts on a stale expectedUpdatedAt', () => {
    const m = sampleMarket();
    const stale = '2026-10-01T09:00:00.000Z';
    expect(applyMarketChange(m, { kind: 'update', entity: 'hypothesis', id: 'h_1', patch: { name: 'x' }, expectedUpdatedAt: stale }, stamp()))
      .toMatchObject({ ok: false, error: 'conflict', message: COPY.CONFLICT });
    expect(applyMarketChange(m, { kind: 'updateInfo', patch: { statement: 'x' }, expectedUpdatedAt: stale }, stamp()))
      .toMatchObject({ ok: false, error: 'conflict' });
    expect(ok(m, { kind: 'update', entity: 'hypothesis', id: 'h_1', patch: { name: 'x' }, expectedUpdatedAt: m.hypotheses[0]!.updatedAt }).value.hypotheses[0]!.name).toBe('x');
  });

  it('refuses text over the cell limit', () => {
    expect(applyMarketChange(sampleMarket(), { kind: 'update', entity: 'hypothesis', id: 'h_1', patch: { theirSide: 'x'.repeat(45_001) } }, stamp()))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { theirSide: COPY.TOO_LONG } });
  });

  it('editing a flagged item clears its flag; updateInfo clears the flags of the fields it names', () => {
    const m = sampleMarket();
    const hyp = ok(m, { kind: 'update', entity: 'hypothesis', id: 'h_1', patch: { name: 'IT firms' } }).value;
    expect(hyp.hypotheses[0]).toMatchObject({ name: 'IT firms', checkAgain: false, updatedAt: NOW });
    const info = ok(m, { kind: 'updateInfo', patch: { statement: 'New statement' } }).value.info;
    expect(info).toMatchObject({ statement: 'New statement', checkAgain: ['mustHaves'], updatedAt: NOW, updatedBy: 'Ruth' });
  });

  it('lets an updateInfo patch set the flags (undo), and refuses a made-up field name', () => {
    const m = sampleMarket();
    const edited = ok(m, { kind: 'updateInfo', patch: { statement: 'New statement' } }).value;
    const undone = ok(edited, { kind: 'updateInfo', patch: { statement: m.info.statement, checkAgain: ['mustHaves', 'statement'] } }).value;
    expect(undone.info).toMatchObject({ statement: m.info.statement, checkAgain: ['mustHaves', 'statement'] });
    expect(applyMarketChange(m, { kind: 'updateInfo', patch: { checkAgain: ['nope' as never] } }, stamp())).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('never lets updateInfo change who the market is or who changed it', () => {
    const out = ok(sampleMarket(), {
      kind: 'updateInfo', patch: { marketId: 'm_other', companyId: 'co_other', updatedBy: 'Evil', statement: 'x' } as never,
    });
    expect(out.value.info).toMatchObject({ marketId: 'm_abcdefghij', companyId: 'co_abcdefghij', updatedBy: 'Ruth' });
  });

  it("refuses to change the market's partner type, even to the same one", () => {
    const m = sampleMarket();
    const refusal = { ok: false, error: 'invalid', message: COPY.MARKET_TYPE_FIXED, fieldErrors: { partnerType: COPY.MARKET_TYPE_FIXED } };
    for (const partnerType of ['referral', 'reseller']) {
      expect(applyMarketChange(m, { kind: 'updateInfo', patch: { partnerType, statement: 'x' } as never }, stamp())).toEqual(refusal);
    }
  });

  it('clearCheckAgain ticks an item as checked', () => {
    const m = sampleMarket();
    expect(itemsToCheck(m)).toBe(4);
    let next = ok(m, { kind: 'clearCheckAgain', target: { entity: 'market', field: 'statement' } }).value;
    next = ok(next, { kind: 'clearCheckAgain', target: { entity: 'valuePoint', id: 'v_2' } }).value;
    expect(next.info.checkAgain).toEqual(['mustHaves']);
    expect(next.valuePoints[1]).toMatchObject({ checkAgain: false, text: m.valuePoints[1]!.text, updatedAt: NOW, updatedBy: 'Ruth' });
    expect(itemsToCheck(next)).toBe(2);
    expect(applyMarketChange(m, { kind: 'clearCheckAgain', target: { entity: 'hypothesis', id: 'h_nope' } }, stamp()))
      .toMatchObject({ ok: false, error: 'not_found' });
  });

  it('deleting a value point leaves hypotheses pointing at it, reported by marketDanglingRefs', () => {
    const out = ok(sampleMarket(), { kind: 'delete', entity: 'valuePoint', id: 'v_1' });
    expect(out.value.valuePoints.map((v) => v.id)).toEqual(['v_2']);
    expect(out.entityId).toBeNull();
    expect(marketDanglingRefs(out.value)).toEqual([{ entity: 'hypothesis', id: 'h_1', field: 'valuePointIds' }]);
  });

  it('does not check a change row\'s call id: that call lives in the Partner book', () => {
    expect(marketDanglingRefs(sampleMarket({ changes: [{ ...sampleMarket().changes[0]!, callId: 'k_elsewhere' }] }))).toEqual([]);
  });

  it('refuses a fifth value point on a hypothesis', () => {
    expect(applyMarketChange(sampleMarket(), { kind: 'update', entity: 'hypothesis', id: 'h_1', patch: { valuePointIds: ['a', 'b', 'c', 'd', 'e'] } }, stamp()))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { valuePointIds: COPY.MAX_VALUE_POINTS } });
  });
});
