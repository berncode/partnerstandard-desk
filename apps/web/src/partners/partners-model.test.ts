import { accountOf, applyPartnerChanges, type Partner } from '@partner-desk/core';
import { anAccount, marketLink, partner, sampleBook, stamp } from '@partner-desk/core/test-builders';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  columnsFor, duplicateOf, formatDate, newPartnerChanges, otherTypeMessage, sameTypeMessage, today, marketNamesOf, marketPartnerType, marketsForType, parseQuery, partnersFor, placementChanges,
  programText, queryString, stageText, stageValueOf, switchView, viewCounts, hasFilters, mapHealthOf, showsMapHealth, withoutFilters, HEALTH_CHOICES,
  type MarketOption, type PartnerQuery,
} from './partners-model';

function named(id: string, company: string, website: string, over: Partial<Partner> = {}) {
  return {
    account: anAccount({ id: `a_${id}`, company, website }),
    partner: partner({ id, accountId: `a_${id}`, ...over }),
  };
}
const rows = [
  named('p_r1', 'Researched One', 'one.example', { updatedAt: '2026-10-02T00:00:00.000Z' }),
  named('p_c1', 'Called One', 'called.example', { step: 'discovery_call', partnerType: 'managed' }),
  named('p_on', 'Onboarding One', 'on.example', { stage: 'onboarding', step: null, signedDate: '2026-09-01' }),
  named('p_gr', 'Growth One', 'gr.example', { stage: 'growth', step: null, signedDate: '2026-08-01' }),
  named('p_nn', 'Not Now One', 'nn.example', { closed: 'not_now', closedReason: 'later' }),
  named('p_ex', 'Exited One', 'ex.example', { stage: 'exit', step: null, signedDate: '2026-01-05', exitedDate: '2026-10-21' }),
];
const book = sampleBook({
  accounts: rows.map((row) => row.account),
  partners: rows.map((row) => row.partner),
  people: [], calls: [], qualifications: [],
  marketLinks: [
    marketLink({ id: 'l_1', partnerId: 'p_r1', marketId: 'm_a' }),
    marketLink({ id: 'l_2', partnerId: 'p_r1', marketId: 'm_b' }),
    marketLink({ id: 'l_3', partnerId: 'p_on', marketId: 'm_a' }),
  ],
});
const markets: MarketOption[] = [
  { marketId: 'm_a', displayName: 'Austria · Reseller', archived: false },
  { marketId: 'm_b', displayName: 'Germany · Reseller', archived: false },
  { marketId: 'm_c', displayName: 'Italy · Managed Service Provider', archived: false },
  { marketId: 'm_d', displayName: 'Spain · Reseller', archived: true },
];
const query = (over: Partial<PartnerQuery> = {}): PartnerQuery => ({
  view: 'potential', type: null, market: null, program: null, stage: null, health: null, sort: 'recent', layout: 'list', ...over,
});
const names = (q: PartnerQuery) => partnersFor(book, q).map((p) => accountOf(book, p)?.company ?? '');

describe('parseQuery and queryString', () => {
  it('opens on Active when a partner is active, and on Potential when none is', () => {
    expect(parseQuery(new URLSearchParams(''), book.partners).view).toBe('active');
    expect(parseQuery(new URLSearchParams(''), [partner()]).view).toBe('potential');
  });

  it('reads view, type, market, stage and layout, and drops what it does not know', () => {
    expect(parseQuery(new URLSearchParams('view=active&type=reseller&market=m_a&stage=growth&layout=board'), book.partners))
      .toEqual(query({ view: 'active', type: 'reseller', market: 'm_a', stage: 'growth', layout: 'board' }));
    expect(parseQuery(new URLSearchParams('view=nope&type=nope&stage=growth&layout=wide&health=great&sort=name'), [partner()]))
      .toEqual(query());
  });

  it('has no board for Closed', () => {
    expect(parseQuery(new URLSearchParams('view=closed&layout=board'), book.partners).layout).toBe('list');
  });

  it('round-trips through the address', () => {
    const q = query({ view: 'active', type: 'reseller', market: 'm_a', stage: 'growth', layout: 'board' });
    expect(parseQuery(new URLSearchParams(queryString(q)), book.partners)).toEqual(q);
    const byHealth = query({ view: 'active', health: 'none', sort: 'health' });
    expect(queryString(byHealth)).toBe('?view=active&health=none&sort=health');
    expect(parseQuery(new URLSearchParams(queryString(byHealth)), book.partners)).toEqual(byHealth);
    expect(queryString(query())).toBe('?view=potential');
  });

  it('switching view keeps type, market and layout and clears the stage', () => {
    const q = query({ view: 'potential', type: 'reseller', market: 'm_a', stage: 'researched', layout: 'board' });
    expect(switchView(q, 'active')).toEqual(query({ view: 'active', type: 'reseller', market: 'm_a', layout: 'board' }));
    expect(switchView(q, 'closed').layout).toBe('list');
  });
});

describe('MAP health (spec 5.7)', () => {
  const healthBook = sampleBook({
    accounts: [anAccount({ id: 'a_1', company: 'Alpha' }), anAccount({ id: 'a_2', company: 'Beta' }),
      anAccount({ id: 'a_3', company: 'Gamma' }), anAccount({ id: 'a_4', company: 'Delta' })],
    partners: [
      partner({ id: 'p_1', accountId: 'a_1', mapHealth: 'on_track', mapNextMilestone: '2026-11-20', updatedAt: '2026-10-30T10:00:00.000Z' }),
      partner({ id: 'p_2', accountId: 'a_2', mapHealth: null, updatedAt: '2026-10-31T10:00:00.000Z' }),
      partner({ id: 'p_3', accountId: 'a_3', mapHealth: 'off_track', mapNextMilestone: null, updatedAt: '2026-10-01T10:00:00.000Z' }),
      partner({ id: 'p_4', accountId: 'a_4', mapHealth: 'on_track', mapNextMilestone: '2026-11-10', updatedAt: '2026-10-02T10:00:00.000Z' }),
    ],
    people: [], calls: [], qualifications: [], marketLinks: [],
  });
  const named = (q: PartnerQuery) => partnersFor(healthBook, q).map((p) => accountOf(healthBook, p)?.company ?? '');

  it('sorts what needs attention first, then the nearest next milestone, and no MAP last', () => {
    expect(named(query())).toEqual(['Beta', 'Alpha', 'Delta', 'Gamma']);
    expect(named(query({ sort: 'health' }))).toEqual(['Gamma', 'Delta', 'Alpha', 'Beta']);
  });

  it('filters by a health, or the partner types without a MAP, and counts each view under the filter', () => {
    expect(named(query({ health: 'on_track' }))).toEqual(['Alpha', 'Delta']);
    expect(named(query({ health: 'none' }))).toEqual(['Beta']);
    expect(viewCounts(healthBook, query({ health: 'off_track' })).potential).toBe(1);
    expect(hasFilters(query({ health: 'none' }))).toBe(true);
    expect(withoutFilters(query({ health: 'none', sort: 'health', type: 'reseller' }))).toEqual(query({ sort: 'health' }));
  });

  describe('an empty MAP (owner, 2026-10-31): the row keeps no health, the directory says there is a MAP', () => {
    const withEmpty = {
      ...healthBook,
      accounts: [...healthBook.accounts, anAccount({ id: 'a_5', company: 'Epsilon' })],
      partners: [...healthBook.partners, partner({ id: 'p_5', accountId: 'a_5', mapHealth: null, updatedAt: '2026-10-03T10:00:00.000Z' })],
    };
    const maps = new Set(['p_1', 'p_3', 'p_4', 'p_5']);
    const names = (q: PartnerQuery) => partnersFor(withEmpty, q, maps).map((p) => accountOf(withEmpty, p)?.company ?? '');

    it('says "Nothing planned yet" for a MAP with no health, and "No MAP" without one', () => {
      expect(mapHealthOf(partner({ mapHealth: null }), true)).toBe('empty');
      expect(mapHealthOf(partner({ mapHealth: null }), false)).toBe('none');
      expect(mapHealthOf(partner({ mapHealth: 'at_risk' }), true)).toBe('at_risk');
      expect(mapHealthOf(partner({ closed: 'no', signedDate: null, mapHealth: null }), true)).toBe('not_signed');
    });

    it('sorts an empty MAP after on track and before no MAP', () => {
      expect(names(query({ sort: 'health' }))).toEqual(['Gamma', 'Delta', 'Alpha', 'Epsilon', 'Beta']);
    });

    it('filters by it, apart from the partner types without a MAP', () => {
      expect(HEALTH_CHOICES).toEqual(['off_track', 'at_risk', 'on_track', 'empty', 'none']);
      expect(names(query({ health: 'empty' }))).toEqual(['Epsilon']);
      expect(names(query({ health: 'none' }))).toEqual(['Beta']);
      expect(viewCounts(withEmpty, query({ health: 'empty' }), maps).potential).toBe(1);
      expect(parseQuery(new URLSearchParams('health=empty'), [partner()]).health).toBe('empty');
    });

    it('shows the column once the directory lists a MAP, even with no health on any row', () => {
      expect(showsMapHealth(book, query(), new Set(['p_r1']))).toBe(true);
      expect(showsMapHealth(book, query(), new Set())).toBe(false);
    });
  });

  it('says "Not signed" for a partner type closed before signing, whatever the row last kept, as its MAP does', () => {
    expect(mapHealthOf(partner({ closed: 'no', signedDate: null, mapHealth: 'at_risk' }))).toBe('not_signed');
    expect(mapHealthOf(partner({ closed: 'no', signedDate: null, mapHealth: null }))).toBe('not_signed');
    expect(mapHealthOf(partner({ mapHealth: 'at_risk' }))).toBe('at_risk');
    expect(mapHealthOf(partner({ mapHealth: null }))).toBe('none');
  });

  it('shows the column once a partner type has a MAP, or the address asks for it', () => {
    expect(showsMapHealth(healthBook, query())).toBe(true);
    expect(showsMapHealth(book, query())).toBe(false);
    expect(showsMapHealth(book, query({ sort: 'health' }))).toBe(true);
  });
});

describe('the Program filter and column', () => {
  const inPrograms = {
    ...book,
    partners: book.partners.map((p) => (p.id === 'p_r1' ? { ...p, programId: 'pg_a' } : p.id === 'p_on' ? { ...p, programId: 'pg_b', level: 'pref' as const } : p)),
  };
  const programs = [
    { programId: 'pg_a', label: 'Reseller', partnerType: 'reseller' as const, title: 'Reseller' },
    { programId: 'pg_b', label: 'Reseller · DACH', partnerType: 'reseller' as const, title: 'Reseller · DACH' },
  ];
  const named = (q: PartnerQuery) => partnersFor(inPrograms, q).map((p) => accountOf(inPrograms, p)?.company ?? '');

  it('reads a program, or none, from the address and writes it back', () => {
    expect(parseQuery(new URLSearchParams('view=active&program=pg_b'), book.partners).program).toBe('pg_b');
    expect(parseQuery(new URLSearchParams('view=active&program=none'), book.partners).program).toBe('none');
    const q = query({ program: 'pg_b' });
    expect(queryString(q)).toBe('?view=potential&program=pg_b');
    expect(parseQuery(new URLSearchParams(queryString(q)), book.partners)).toEqual(q);
    expect(switchView(q, 'active').program).toBe('pg_b');
  });

  it('keeps the partners in a program, or in none, in every view’s count', () => {
    expect(named(query({ program: 'pg_a' }))).toEqual(['Researched One']);
    expect(named(query({ program: 'none' }))).toEqual(['Called One']);
    expect(viewCounts(inPrograms, query({ program: 'pg_b' }))).toEqual({ potential: 0, active: 1, closed: 0 });
  });

  it('names the program by its title, one that is gone as gone, and none as nothing', () => {
    expect(programText(inPrograms.partners.find((p) => p.id === 'p_on')!, programs)).toBe('Reseller · DACH');
    expect(programText({ ...inPrograms.partners[0]!, programId: 'pg_gone' }, programs)).toBe('A deleted program');
    expect(programText(inPrograms.partners[1]!, programs)).toBe('');
    // A list that couldn't be read: the stored id, never "deleted".
    expect(programText({ ...inPrograms.partners[0]!, programId: 'pg_a' }, [], false)).toBe('pg_a');
  });
});

describe('what each view holds', () => {
  it('puts a closed or exited partner in Closed, a recruitment one in Potential, the rest in Active', () => {
    expect(names(query({ view: 'potential' }))).toEqual(['Researched One', 'Called One']);
    expect(names(query({ view: 'active' }))).toEqual(['Growth One', 'Onboarding One']);
    expect(names(query({ view: 'closed' })).sort()).toEqual(['Exited One', 'Not Now One']);
  });

  it('counts per view under the type and market filters', () => {
    expect(viewCounts(book, query())).toEqual({ potential: 2, active: 2, closed: 2 });
    expect(viewCounts(book, query({ type: 'managed' }))).toEqual({ potential: 1, active: 0, closed: 0 });
    expect(viewCounts(book, query({ market: 'm_a' }))).toEqual({ potential: 1, active: 1, closed: 0 });
  });

  it('filters by type, market and stage, and shows a partner in two markets once', () => {
    expect(names(query({ type: 'managed' }))).toEqual(['Called One']);
    expect(names(query({ market: 'm_a' }))).toEqual(['Researched One']);
    expect(names(query({ market: 'm_b' }))).toEqual(['Researched One']);
    expect(names(query({ stage: 'discovery_call' }))).toEqual(['Called One']);
    expect(names(query({ view: 'closed', stage: 'exited' }))).toEqual(['Exited One']);
    expect(names(query({ view: 'closed', stage: 'not_now' }))).toEqual(['Not Now One']);
  });

  it('builds the board: a column per step for Potential and per stage for Active, empty ones too', () => {
    const potential = columnsFor(partnersFor(book, query()), 'potential');
    expect(potential.map((c) => [c.title, c.partners.length])).toEqual([['Researched', 1], ['Discovery call', 1], ['Qualification', 0], ['MAP', 0]]);
    const active = columnsFor(partnersFor(book, query({ view: 'active' })), 'active');
    expect(active.map((c) => [c.title, c.partners.length])).toEqual([['Onboarding', 1], ['Growth', 1], ['Expansion', 0], ['Exit', 0]]);
  });

  it('reads a missing step as Researched', () => {
    expect(stageValueOf(partner({ step: null }))).toBe('researched');
  });
});

describe('words', () => {
  it('writes the stage column', () => {
    expect(stageText(partner({ step: 'map' }))).toBe('Recruitment · MAP');
    expect(stageText(partner({ stage: 'growth', step: null, signedDate: '2026-01-01' }))).toBe('Growth');
    expect(stageText(partner({ closed: 'no' }))).toBe('No');
    expect(stageText(partner({ stage: 'exit', step: null, signedDate: '2026-01-01', exitedDate: '2026-10-21' }))).toBe('Exited on 21 Oct 2026');
  });

  it('writes dates as 21 Oct 2026', () => {
    expect(formatDate('2026-10-05T09:00:00.000Z')).toBe('5 Oct 2026');
    expect(formatDate('2026-12-21')).toBe('21 Dec 2026');
    expect(formatDate(null)).toBe('');
  });

  it('lists the market names once, and skips markets it cannot name', () => {
    expect(marketNamesOf(book, markets, 'p_r1')).toEqual(['Austria · Reseller', 'Germany · Reseller']);
    expect(marketNamesOf(book, markets, 'p_gr')).toEqual([]);
    expect(marketNamesOf(book, [], 'p_r1')).toEqual([]);
  });
});

describe('markets for a partner type', () => {
  it('reads the type from the listed name and offers only open markets of that type', () => {
    expect(marketPartnerType('Austria · Reseller')).toBe('reseller');
    expect(marketPartnerType('Italy · Managed Service Provider')).toBe('managed');
    expect(marketPartnerType('Today · Value Added Distributor')).toBe('vad');
    expect(marketPartnerType('Reseller')).toBeNull();
    expect(marketsForType(markets, 'reseller').map((m) => m.marketId)).toEqual(['m_a', 'm_b']);
    expect(marketsForType(markets, 'managed').map((m) => m.marketId)).toEqual(['m_c']);
  });
});

describe('market order', () => {
  it('is by name, whatever order the directory listed them in', () => {
    const listed = [
      { marketId: 'm_g', displayName: 'Germany · Reseller', archived: false },
      { marketId: 'm_a', displayName: 'Austria · Reseller', archived: false },
    ];
    expect(marketsForType(listed, 'reseller').map((m) => m.marketId)).toEqual(['m_a', 'm_g']);
    expect(marketsForType([...listed].reverse(), 'reseller').map((m) => m.marketId)).toEqual(['m_a', 'm_g']);
  });
});

describe('placementChanges', () => {
  it('needs no move for Researched', () => {
    expect(placementChanges('p', 'researched', '2026-09-30')).toEqual([]);
  });

  it('moves a step at a time to the chosen step', () => {
    expect(placementChanges('p', 'map', '2026-09-30').map((c) => (c as { to: string }).to)).toEqual(['discovery_call', 'qualification', 'map']);
  });

  it('signs, then moves a stage at a time', () => {
    expect(placementChanges('p', 'onboarding', '2026-09-30')).toEqual([{ kind: 'markSigned', partnerId: 'p', signedDate: '2026-09-30' }]);
    expect(placementChanges('p', 'expansion', '2026-09-30').map((c) => (c as { to?: string }).to ?? c.kind))
      .toEqual(['markSigned', 'growth', 'expansion']);
  });

  it('every move passes the core rules', () => {
    for (const where of ['discovery_call', 'qualification', 'map', 'onboarding', 'growth', 'expansion'] as const) {
      let current = sampleBook({ partners: [partner({ id: 'p_new' })], people: [], calls: [], qualifications: [], marketLinks: [] });
      for (const change of placementChanges('p_new', where, '2026-09-30')) {
        const out = applyPartnerChanges(current, [change], stamp());
        expect(out.ok, `${where}: ${JSON.stringify(change)}`).toBe(true);
        if (out.ok) current = out.value;
      }
    }
  });
});

describe('newPartnerChanges', () => {
  const values = { company: 'Hidden Co', website: '', country: 'Austria' };

  it('adds a new company and its partner type when the company is not here', () => {
    const changes = newPartnerChanges(book, values, 'reseller', 'p_new', () => 'a_new');
    expect(changes).toEqual([
      { kind: 'add', entity: 'account', values: { id: 'a_new', company: 'Hidden Co', website: '', country: 'Austria' } },
      { kind: 'add', entity: 'partner', values: { id: 'p_new', accountId: 'a_new', partnerType: 'reseller' } },
    ]);
  });

  it('puts the type on a company that is here with no partner type, instead of making a second company', () => {
    const hidden = { ...book, accounts: [...book.accounts, anAccount({ id: 'a_hidden', company: 'Hidden Co', website: '', country: '' })] };
    expect(duplicateOf(hidden, { ...values, partnerType: 'reseller', marketId: null })).toBeNull();
    const changes = newPartnerChanges(hidden, values, 'reseller', 'p_new', () => 'a_new');
    expect(changes).toEqual([
      { kind: 'update', entity: 'account', id: 'a_hidden', patch: { country: 'Austria' }, expectedUpdatedAt: hidden.accounts.at(-1)!.updatedAt },
      { kind: 'add', entity: 'partner', values: { id: 'p_new', accountId: 'a_hidden', partnerType: 'reseller' } },
    ]);
    const saved = applyPartnerChanges(hidden, changes, stamp());
    expect(saved.ok && saved.value.accounts.filter((a) => a.company === 'Hidden Co')).toHaveLength(1);
  });

  it('puts another type on the company that has one, filling only its empty facts', () => {
    const changes = newPartnerChanges(book, { company: 'Onboarding One', website: '', country: '' }, 'managed', 'p_new', () => 'a_new');
    expect(changes).toEqual([{ kind: 'add', entity: 'partner', values: { id: 'p_new', accountId: 'a_p_on', partnerType: 'managed' } }]);
  });
});

describe('duplicateOf', () => {
  it('finds the same company and type, by name or by website', () => {
    const same = duplicateOf(book, { company: 'onboarding one', website: '', partnerType: 'reseller', marketId: null });
    expect(same).toMatchObject({ kind: 'same_type', linked: false, partner: { id: 'p_on' } });
    expect(duplicateOf(book, { company: 'Another name', website: 'https://www.on.example/about', partnerType: 'reseller', marketId: null }))
      .toMatchObject({ kind: 'same_type', partner: { id: 'p_on' } });
  });

  it('says when the partner is already in the chosen market', () => {
    expect(duplicateOf(book, { company: 'Onboarding One', website: '', partnerType: 'reseller', marketId: 'm_a' }))
      .toMatchObject({ kind: 'same_type', linked: true });
    expect(duplicateOf(book, { company: 'Onboarding One', website: '', partnerType: 'reseller', marketId: 'm_b' }))
      .toMatchObject({ kind: 'same_type', linked: false });
  });

  it('warns about the same company as another type, and about nothing for a new one', () => {
    expect(duplicateOf(book, { company: 'Onboarding One', website: '', partnerType: 'managed', marketId: null }))
      .toMatchObject({ kind: 'other_type', partner: { id: 'p_on' } });
    expect(duplicateOf(book, { company: 'Brand New', website: '', partnerType: 'reseller', marketId: null })).toBeNull();
    expect(duplicateOf(book, { company: '', website: '', partnerType: 'reseller', marketId: null })).toBeNull();
  });

  it('names a closed partner with Not now or No and no date, and keeps the open sentence for an exited one', () => {
    const closed = duplicateOf(book, { company: 'Not Now One', website: '', partnerType: 'reseller', marketId: null });
    const exited = duplicateOf(book, { company: 'Exited One', website: '', partnerType: 'reseller', marketId: null });
    expect(closed?.kind).toBe('same_type');
    expect(exited?.kind).toBe('same_type');
    if (closed?.kind === 'same_type') expect(sameTypeMessage(closed)).toBe('You closed Not Now One as a reseller (Not now).');
    if (exited?.kind === 'same_type') expect(sameTypeMessage(exited)).toBe('Exited One is already a partner as Reseller.');
  });

  it('says the company already has the other type', () => {
    const other = duplicateOf(book, { company: 'Onboarding One', website: '', partnerType: 'managed', marketId: null });
    expect(other?.kind).toBe('other_type');
    if (other?.kind === 'other_type') {
      expect(otherTypeMessage(other, 'managed')).toBe('Onboarding One is already your reseller. This adds Onboarding One as a managed service provider.');
    }
  });

  it('fills only the empty company facts when the company is already another type', () => {
    const account = anAccount({ id: 'a_gap', company: 'Gap Co', website: '', country: '' });
    const gap = sampleBook({
      accounts: [account], partners: [partner({ id: 'p_gap', accountId: 'a_gap', partnerType: 'technology' })],
      people: [], calls: [], qualifications: [], marketLinks: [],
    });
    expect(duplicateOf(gap, { company: 'GAP', website: 'gap.example', country: 'Austria', partnerType: 'reseller', marketId: null }))
      .toMatchObject({ kind: 'other_type', fill: { website: 'gap.example', country: 'Austria' } });
  });

  it('names an exclusion only when the company is not already a partner', () => {
    const exclusions = [{ company: 'Omega GmbH', website: '' }, { company: 'Onboarding One', website: '' }];
    expect(duplicateOf(book, { company: 'omega', website: '', partnerType: 'reseller', marketId: null }, exclusions))
      .toEqual({ kind: 'exclusion', company: 'Omega GmbH' });
    expect(duplicateOf(book, { company: 'Onboarding One', website: '', partnerType: 'managed', marketId: null }, exclusions))
      .toMatchObject({ kind: 'other_type' });
  });
});

describe('today', () => {
  const zone = process.env.TZ;
  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = zone;
  });

  it('is the person’s own date, not the date in UTC', () => {
    vi.useFakeTimers();
    process.env.TZ = 'Europe/Vienna';
    vi.setSystemTime(new Date('2026-10-28T23:30:00Z')); // 00:30 on 29 Oct in Vienna
    expect(today()).toBe('2026-10-29');
    process.env.TZ = 'America/New_York';
    vi.setSystemTime(new Date('2026-10-29T03:30:00Z')); // 23:30 on 28 Oct in New York
    expect(today()).toBe('2026-10-28');
  });
});
