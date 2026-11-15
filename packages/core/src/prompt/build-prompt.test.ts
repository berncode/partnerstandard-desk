import { describe, expect, it } from 'vitest';
import { aPartner, anAccount, marketLink, sampleBook, sampleMarket } from '../test-builders';
import type { Partner, PartnerBook } from '../partners/types';
import { buildSearchPrompt, OUTPUT_COLUMNS } from './build-prompt';

/** A company with one reseller section: section `p_<key>` on account `a_<key>`. */
function company(key: string, name: string, website: string, over: Partial<Partner> = {}) {
  return { account: anAccount({ id: `a_${key}`, company: name, website }), partner: aPartner({ id: `p_${key}`, accountId: `a_${key}`, ...over }) };
}
type Company = ReturnType<typeof company>;
const withCompanies = (companies: Company[]) => ({ accounts: companies.map((c) => c.account), partners: companies.map((c) => c.partner) });

/** Resellers: Acme (researched), Delta (discovery call) and Gamma (closed "no"), all linked to the sample market; Zeta is only in another market. */
function book(): PartnerBook {
  return sampleBook({
    ...withCompanies([
      company('acme', 'Acme GmbH', 'https://acme.example'),
      company('delta', 'Delta Inc', 'https://delta.example', { step: 'discovery_call' }),
      company('gamma', 'Gamma Ltd', '', { closed: 'no', closedReason: 'Competes with us' }),
      company('zeta', 'Zeta AG', 'https://zeta.example'),
    ]),
    marketLinks: [
      marketLink({ id: 'l_1', partnerId: 'p_acme' }),
      marketLink({ id: 'l_2', partnerId: 'p_delta', hypothesisId: 'h_1' }),
      marketLink({ id: 'l_3', partnerId: 'p_gamma' }),
      marketLink({ id: 'l_4', partnerId: 'p_zeta', marketId: 'm_other00000' }),
    ],
    people: [], calls: [], qualifications: [],
  });
}

const base = () => ({ market: sampleMarket(), book: book(), companyName: 'Invoicely' });

describe('buildSearchPrompt', () => {
  it('market prompt matches snapshot', () => {
    expect(buildSearchPrompt({ ...base(), hypothesisId: null })).toMatchSnapshot();
  });

  it('hypothesis prompt matches snapshot', () => {
    expect(buildSearchPrompt({ ...base(), hypothesisId: 'h_1' })).toMatchSnapshot();
  });

  it('leaves out linked partners and exclusions in the prompt', () => {
    const text = buildSearchPrompt({ ...base(), hypothesisId: null });
    const section = text.slice(text.indexOf('## Leave out'), text.indexOf('## Desk check help'));
    expect(section).toContain('- Acme GmbH (acme.example)');
    expect(section).toContain('- Delta Inc (delta.example)\n');
    expect(section).toContain('- Omega GmbH (omega.example): Existing partner');
    expect(section).toContain('- Gamma Ltd: Competes with us');
  });

  it("leaves out every partner of the market's type, from any market or none, and no other type", () => {
    const b = book();
    const more = [
      company('eta', 'Eta SRL', 'https://eta.example'), // a reseller in no market
      company('theta', 'Theta BV', 'theta.example', { partnerType: 'referral' }), // another type, in another market
      company('iota', 'Iota KG', '', { partnerType: 'referral' }), // another type, in no market
    ];
    b.accounts.push(...more.map((c) => c.account));
    b.partners.push(...more.map((c) => c.partner));
    b.marketLinks.push(marketLink({ id: 'l_5', partnerId: 'p_theta', marketId: 'm_other00000' }));
    const text = buildSearchPrompt({ market: sampleMarket(), book: b, companyName: 'Invoicely', hypothesisId: null });
    const section = text.slice(text.indexOf('## Leave out'), text.indexOf('## Desk check help'));
    expect(section).toContain('- Zeta AG (zeta.example)\n'); // a reseller only in another market
    expect(section).toContain('- Eta SRL (eta.example)\n');
    expect(section).not.toContain('Theta');
    expect(section).not.toContain('Iota');
  });

  it('lists a company once when it has two sections, and keeps the reason of the one closed "no"', () => {
    const b = book();
    // Gamma is also a referral partner, open, and (by a hand edit) linked to this market too.
    b.partners.push(aPartner({ id: 'p_gamma2', accountId: 'a_gamma', partnerType: 'referral' }));
    b.marketLinks.push(marketLink({ id: 'l_5', partnerId: 'p_gamma2' }));
    const text = buildSearchPrompt({ market: sampleMarket(), book: b, companyName: 'Invoicely', hypothesisId: null });
    expect(text.match(/Gamma/g)).toHaveLength(1);
    expect(text).toContain('- Gamma Ltd: Competes with us');
  });

  it('lists a company once when it is both a partner and an exclusion', () => {
    const market = sampleMarket();
    market.exclusions = [{ id: 'x_1', company: 'ACME', website: 'acme.example', reason: 'Bad fit', updatedAt: null, updatedBy: 'Someone' }];
    const text = buildSearchPrompt({ market, book: book(), companyName: 'Invoicely', hypothesisId: null });
    expect(text.match(/Acme|ACME/g)).toHaveLength(1);
    expect(text).toContain(': Bad fit');
  });

  it('examples are capped at 5 and only from the discovery call on', () => {
    const extra = (n: number, over: Partial<Partner> = {}, website = `example${n}.at`) =>
      company(`ex${n}`, `Example${n}`, website, { step: 'discovery_call', ...over });
    const companies = [
      extra(0, { step: 'researched' }),
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => extra(n)),
      extra(8, { stage: 'onboarding', step: null }, ''),
      extra(9, { stage: 'growth', step: null }),
    ];
    const b = sampleBook({
      ...withCompanies(companies), people: [], calls: [], qualifications: [],
      marketLinks: companies.map((c, i) => marketLink({ id: `l_${i}`, partnerId: c.partner.id, hypothesisId: 'h_1' })),
    });
    const text = buildSearchPrompt({ market: sampleMarket(), book: b, companyName: 'Invoicely', hypothesisId: 'h_1' });
    const part = text.slice(text.indexOf('Examples of companies'), text.indexOf('## Leave out'));
    expect(part.match(/^ {2}- Example/gm)).toHaveLength(5);
    expect(part).toContain('Example1 (example1.at)');
    expect(part).not.toContain('Example0');
    expect(part).not.toContain('Example6');
    expect(part).not.toContain('Example8');
  });

  it("examples skip partners closed 'no' but keep 'not now'; the 'no' one stays in Leave out", () => {
    const companies = [
      company('no', 'NoCo', 'noco.at', { step: 'qualification', closed: 'no', closedReason: 'Competes' }),
      company('later', 'LaterCo', 'laterco.at', { step: 'qualification', closed: 'not_now', closedReason: 'Busy' }),
    ];
    const b = sampleBook({
      ...withCompanies(companies), people: [], calls: [], qualifications: [],
      marketLinks: companies.map((c, i) => marketLink({ id: `l_${i}`, partnerId: c.partner.id, hypothesisId: 'h_1' })),
    });
    const text = buildSearchPrompt({ market: sampleMarket(), book: b, companyName: 'Invoicely', hypothesisId: 'h_1' });
    const examplesPart = text.slice(text.indexOf('Examples of companies'), text.indexOf('## Leave out'));
    expect(examplesPart).not.toContain('NoCo');
    expect(examplesPart).toContain('LaterCo (laterco.at)');
    expect(text.slice(text.indexOf('## Leave out'))).toContain('- NoCo (noco.at): Competes');
  });

  it('empty optional fields leave no dangling labels', () => {
    const market = sampleMarket();
    market.info = { ...market.info, statement: '', mustHaves: [], howMarketBuys: 'unknown', howMarketBuysNote: '' };
    market.hypotheses[0] = { ...market.hypotheses[0]!, lookalike: '', theirSide: '' };
    market.exclusions = [];
    const empty = sampleBook({ accounts: [], partners: [], marketLinks: [], people: [], calls: [], qualifications: [] });
    for (const hypothesisId of [null, 'h_1']) {
      const text = buildSearchPrompt({ market, book: empty, companyName: 'Invoicely', hypothesisId });
      expect(text).not.toContain('Statement:');
      expect(text).not.toContain('Must-haves');
      expect(text).not.toContain('How the market buys');
      expect(text).not.toContain('Examples of companies');
      expect(text).not.toContain('Companies like this one');
      expect(text).not.toContain('Their side');
      expect(text).not.toContain('## Leave out');
      expect(text).not.toContain('{{');
    }
  });

  it('renders the output table header exactly', () => {
    const text = buildSearchPrompt({ ...base(), hypothesisId: null });
    expect(text).toContain(`| ${OUTPUT_COLUMNS.join(' | ')} |\n|${OUTPUT_COLUMNS.map(() => '---').join('|')}|`);
  });

  it('throws on an unknown hypothesis', () => {
    expect(() => buildSearchPrompt({ ...base(), hypothesisId: 'h_nope' })).toThrow(/unknown hypothesis "h_nope"/);
  });
});
