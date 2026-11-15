import { describe, expect, it } from 'vitest';
import { MARKET_FIELD_NAMES, marketInfoSchema } from './schemas';
import { sampleMarket } from '../test-builders';
import { copyMarket, marketDisplayName, marketTypeOfDisplayName, mergeExclusions, newMarket } from './copy';
import type { Exclusion, MarketEntity } from './types';

/** New ids `{kind}_n1`, `{kind}_n2`, ... in order of asking. */
function counter() {
  let n = 0;
  return (kind: MarketEntity) => `${kind}_n${++n}`;
}

const copied = () => copyMarket(sampleMarket(), { marketName: 'Switzerland', partnerType: 'distributor', updatedBy: 'Ruth' }, counter(), 'm_zzzzzzzzzz');

describe('newMarket', () => {
  it('starts open and empty, with the given fields and the id it is given', () => {
    const m = newMarket({ companyId: 'co_abcdefghij', marketName: 'Austria', partnerType: 'reseller', ourProduct: 'P', ourTargetCustomers: 'T', updatedBy: 'Ruth' }, 'm_1234567890');
    expect(marketInfoSchema.safeParse(m.info).success).toBe(true);
    expect(m.info).toMatchObject({
      marketId: 'm_1234567890', companyId: 'co_abcdefghij', marketName: 'Austria', status: 'open', copiedFrom: null, checkAgain: [], mustHaves: [],
    });
    expect(newMarket({ companyId: 'co_abcdefghij', statement: undefined, updatedBy: 'Ruth' }, 'm_1234567890').info.statement).toBe('');
    expect([m.valuePoints, m.hypotheses, m.exclusions, m.changes].flat()).toEqual([]);
  });
});

describe('copyMarket', () => {
  it('copies the info under the new name, partner type and market id, in the same company', () => {
    const { info } = copied();
    const source = sampleMarket().info;
    expect(info).toMatchObject({
      marketId: 'm_zzzzzzzzzz', companyId: source.companyId, marketName: 'Switzerland', partnerType: 'distributor',
      ourProduct: source.ourProduct, statement: source.statement, mustHaves: source.mustHaves, howMarketBuys: source.howMarketBuys,
      expectedCandidates: source.expectedCandidates, updatedAt: null,
    });
    expect(marketInfoSchema.safeParse(info).success).toBe(true);
  });

  it('copies value points, hypotheses and exclusions with new ids and points hypotheses at the new value points', () => {
    const m = copied();
    expect(m.valuePoints.map((v) => [v.id, v.text])).toEqual([['valuePoint_n1', '20% margin on licenses'], ['valuePoint_n2', 'Setup days']]);
    expect(m.hypotheses.map((h) => [h.id, h.valuePointIds])).toEqual([['hypothesis_n3', ['valuePoint_n1', 'valuePoint_n2']]]);
    expect(m.exclusions.map((x) => [x.id, x.company, x.reason])).toEqual([['exclusion_n4', 'Omega GmbH', 'Existing partner']]);
  });

  it('copies a market without its partners', () => {
    const m = copied();
    expect(Object.keys(m).sort()).toEqual(['changes', 'exclusions', 'hypotheses', 'info', 'valuePoints']);
    expect(m.changes).toEqual([]);
  });

  it('resets status, note, hypotheses and confirmed value points, and sets copiedFrom', () => {
    const m = copied();
    expect(m.info).toMatchObject({ status: 'open', statusNote: '', copiedFrom: 'Austria · Reseller' });
    expect(m.hypotheses.map((h) => h.status)).toEqual(['draft']);
    expect(m.valuePoints.map((v) => v.state)).toEqual(['assumption', 'assumption']);
  });

  it('flags every market field, value point and hypothesis to check again', () => {
    const m = copied();
    expect(m.info.checkAgain).toEqual(MARKET_FIELD_NAMES);
    expect(m.valuePoints.every((v) => v.checkAgain)).toBe(true);
    expect(m.hypotheses.every((h) => h.checkAgain)).toBe(true);
  });

  it('stamps every copied row with the person who copies, not the source authors, and clears their dates', () => {
    const m = copyMarket(sampleMarket(), { marketName: 'Swiss', partnerType: 'reseller', updatedBy: 'Ruth' }, counter(), 'm_zzzzzzzzzz');
    for (const row of [m.info, ...m.valuePoints, ...m.hypotheses, ...m.exclusions]) expect(row).toMatchObject({ updatedBy: 'Ruth', updatedAt: null });
  });

  it('leaves the source untouched', () => {
    const source = sampleMarket();
    copyMarket(source, { marketName: 'Switzerland', partnerType: 'distributor', updatedBy: 'Ruth' }, counter(), 'm_zzzzzzzzzz');
    expect(source).toEqual(sampleMarket());
  });
});

describe('marketDisplayName', () => {
  it('joins the market and the partner type label', () => {
    expect(marketDisplayName({ marketName: 'Austria', partnerType: 'system-integrator' })).toBe('Austria · System Integrator (SI)');
  });
});

describe('marketTypeOfDisplayName', () => {
  it('reads the partner type from the end, also when the market name has a dot', () => {
    expect(marketTypeOfDisplayName('Austria · System Integrator (SI)')).toBe('system-integrator');
    expect(marketTypeOfDisplayName('DACH · North · Reseller')).toBe('reseller');
    expect(marketTypeOfDisplayName('Austria')).toBeNull();
    expect(marketTypeOfDisplayName('Austria · Wizard')).toBeNull();
  });
});

describe('mergeExclusions', () => {
  const x = (company: string, website: string, reason = ''): Exclusion => ({ id: `x_${company}`, company, website, reason, updatedAt: null, updatedBy: 'Someone' });

  it('adds the source exclusions the target lacks, with their reasons', () => {
    const target = sampleMarket({ exclusions: [x('Acme GmbH', 'https://www.acme.at/de')] });
    const source = sampleMarket({ exclusions: [x('ACME', 'acme.at', 'Partner'), x('Beta AG', '', 'Competitor'), x('Gamma', 'gamma.io', 'Partner')] });
    expect(mergeExclusions(target, source, counter())).toEqual([
      { kind: 'add', entity: 'exclusion', values: { company: 'Beta AG', website: '', reason: 'Competitor' } },
      { kind: 'add', entity: 'exclusion', values: { company: 'Gamma', website: 'gamma.io', reason: 'Partner' } },
    ]);
  });

  it('skips a company by name when there is no website, and repeats within the source', () => {
    const target = sampleMarket({ exclusions: [x('Beta', '')] });
    const source = sampleMarket({ exclusions: [x('Beta AG', ''), x('Gamma', 'gamma.io'), x('Gamma GmbH', 'https://gamma.io/')] });
    expect(mergeExclusions(target, source, counter()).map((c) => c.kind === 'add' && c.values.company)).toEqual(['Gamma']);
  });
});

describe('the program a market feeds', () => {
  it('a new market feeds no program, and a copy never carries the source’s', () => {
    expect(newMarket({ companyId: 'co_abcdefghij', updatedBy: 'Ruth' }, 'm_1234567890').info.feedsProgramId).toBeNull();
    const source = sampleMarket();
    const feeding = { ...source, info: { ...source.info, feedsProgramId: 'pg_dach0001' } };
    const copy = copyMarket(feeding, { marketName: 'Switzerland', partnerType: 'reseller', updatedBy: 'Ruth' }, counter(), 'm_zzzzzzzzzz');
    expect(copy.info.feedsProgramId).toBeNull();
    expect(marketInfoSchema.safeParse(copy.info).success).toBe(true);
  });
});
