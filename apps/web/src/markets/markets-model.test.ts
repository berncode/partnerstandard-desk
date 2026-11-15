import { anAccount, marketLink, partner, sampleBook } from '@partner-desk/core/test-builders';
import { newMarket } from '@partner-desk/core';
import { describe, expect, it } from 'vitest';
import { countsFor, firstPartnerChanges, firstPartnerNote, listRefusal, stepFromAddress } from './markets-model';

const people = [
  ['p_1', 'Researched Co', { step: 'researched' as const }],
  ['p_2', 'Calls Co', { step: 'discovery_call' as const }],
  ['p_3', 'Map Co', { step: 'map' as const }],
  ['p_4', 'Signed Co', { stage: 'growth' as const, step: null, signedDate: '2026-09-01' }],
  ['p_5', 'Said No', { closed: 'no' as const }],
  ['p_6', 'Gone Co', { stage: 'exit' as const, step: null, signedDate: '2026-01-01', exitedDate: '2026-10-01' }],
  ['p_7', 'Elsewhere', { step: 'researched' as const }],
] as const;
const book = sampleBook({
  accounts: people.map(([id, company]) => anAccount({ id: `a_${id}`, company, website: '' })),
  partners: people.map(([id, , over]) => partner({ id, accountId: `a_${id}`, ...over })),
  people: [], calls: [], qualifications: [],
  marketLinks: [
    ...['p_1', 'p_2', 'p_3', 'p_4', 'p_5', 'p_6'].map((partnerId, i) => marketLink({ id: `l_${i}`, partnerId, marketId: 'm_a' })),
    marketLink({ id: 'l_x', partnerId: 'p_7', marketId: 'm_b' }),
  ],
});
const market = newMarket({ companyId: 'co_aaaaaaaaaa', updatedBy: 'Anna', marketName: 'Austria', partnerType: 'reseller' }, 'm_a');

describe('countsFor', () => {
  it('counts a market’s partners per step, the signed ones, and a closed or exited one only as closed', () => {
    expect(countsFor(book, 'm_a')).toEqual({ steps: { researched: 1, discovery_call: 1, qualification: 0, map: 1 }, signed: 1, closed: 2 });
  });

  it('counts a partner once, and only in the market it is linked to', () => {
    const twice = { ...book, marketLinks: [...book.marketLinks, marketLink({ id: 'l_dup', partnerId: 'p_1', marketId: 'm_a' })] };
    expect(countsFor(twice, 'm_a').steps.researched).toBe(1);
    expect(countsFor(book, 'm_b')).toEqual({ steps: { researched: 1, discovery_call: 0, qualification: 0, map: 0 }, signed: 0, closed: 0 });
    expect(countsFor(book, 'm_none')).toEqual({ steps: { researched: 0, discovery_call: 0, qualification: 0, map: 0 }, signed: 0, closed: 0 });
  });
});

describe('stepFromAddress', () => {
  it('reads 1 to 4 as an index and nothing else', () => {
    expect(stepFromAddress('1', 4)).toBe(0);
    expect(stepFromAddress('4', 4)).toBe(3);
    for (const bad of ['0', '5', 'x', '', '2.5', '-1', null, undefined]) expect(stepFromAddress(bad, 4)).toBeNull();
  });
});

describe('listRefusal', () => {
  const list = [{ id: 'a', company: 'Acme GmbH', website: 'acme.example' }];
  it('refuses the same company again, even typed differently, and a twenty-first', () => {
    expect(listRefusal(list, { company: 'ACME gmbh', website: '' })).toBe('again');
    expect(listRefusal(list, { company: 'Globex', website: '' })).toBeNull();
    const full = Array.from({ length: 20 }, (_, i) => ({ id: String(i), company: `Co ${i}`, website: '' }));
    expect(listRefusal(full, { company: 'New', website: '' })).toBe('full');
  });
});

describe('firstPartnerChanges', () => {
  it('adds a new company with a link, as Research and with no source detail', () => {
    const { changes, notAdded } = firstPartnerChanges(book, market, [{ company: 'Brand New AG', website: 'brandnew.example' }], '2026-10-29');
    expect(notAdded).toBe(0);
    expect(changes.map((c) => (c.kind === 'add' ? c.entity : c.kind))).toEqual(['account', 'partner', 'marketLink']);
    expect(changes[0]).toMatchObject({ kind: 'add', entity: 'account', values: { company: 'Brand New AG' } });
    expect(changes[1]).toMatchObject({ values: { source: 'research', sourceDetail: '' } });
  });

  it('links a known partner of this type that is not in the market, and leaves out one that already is', () => {
    const { changes, notAdded } = firstPartnerChanges(
      book, market, [{ company: 'Elsewhere', website: '' }, { company: 'Researched Co', website: '' }], '2026-10-29',
    );
    expect(notAdded).toBe(1);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'add', entity: 'marketLink', values: { partnerId: 'p_7', marketId: 'm_a' } });
  });

  it('counts a company that repeats in the list as not added', () => {
    const { changes, notAdded } = firstPartnerChanges(book, market, [{ company: 'Twice AG', website: '' }, { company: 'twice ag', website: '' }], '2026-10-29');
    expect(notAdded).toBe(1);
    expect(changes).toHaveLength(3);
  });

  it('uses the import notes: a signed partner, and a company that is already another type', () => {
    expect(firstPartnerNote(book, 'reseller', { company: 'Signed Co', website: '' })).toBe('Already a signed reseller. It won’t be added here.');
    expect(firstPartnerNote(book, 'reseller', { company: 'Said No', website: '' })).toBe('You closed Said No as a reseller (No).');
    expect(firstPartnerNote(book, 'managed', { company: 'Elsewhere', website: '' }))
      .toBe('Elsewhere is already your reseller. This adds Elsewhere as a managed service provider.');
    expect(firstPartnerNote(book, 'reseller', { company: 'Brand New AG', website: '' })).toBeNull();
  });

  it('does not add a signed company typed as a first partner, and counts it as not added', () => {
    const other = newMarket({ companyId: 'co_aaaaaaaaaa', updatedBy: 'Anna', marketName: 'Spain', partnerType: 'reseller' }, 'm_c');
    const { changes, notAdded } = firstPartnerChanges(book, other, [{ company: 'Signed Co', website: '' }], '2026-10-29');
    expect(notAdded).toBe(1);
    expect(changes).toEqual([]);
  });
});
