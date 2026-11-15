import { describe, expect, it, test } from 'vitest';
import { companyKey, domainOf, safeHref, sameCompany } from './website';

describe('website matching', () => {
  test('domainOf normalizes', () => {
    expect(domainOf('https://www.Acme.at/de')).toBe('acme.at');
    expect(domainOf('acme.at')).toBe('acme.at');
    expect(domainOf('http://acme.at/')).toBe('acme.at');
    expect(domainOf('  ')).toBeNull();
    expect(domainOf('not a site')).toBeNull();
  });
  test('companyKey drops legal forms, case and spaces', () => {
    expect(companyKey('Acme Security GmbH')).toBe(companyKey('acme  security'));
    expect(companyKey('Beta AG')).toBe('beta');
  });
  test('companyKey strips legal forms written with dots', () => {
    expect(companyKey('Acme S.r.l.')).toBe(companyKey('Acme'));
    expect(companyKey('Acme S.A.')).toBe('acme');
    expect(companyKey('Acme G.m.b.H.')).toBe('acme');
    expect(companyKey('Acme Inc.')).toBe('acme');
  });
  test('sameCompany prefers domain, falls back to name', () => {
    expect(sameCompany({ website: 'acme.at', company: 'X' }, { website: 'https://www.acme.at', company: 'Y' })).toBe(true);
    expect(sameCompany({ website: '', company: 'Acme GmbH' }, { website: '', company: 'ACME' })).toBe(true);
    expect(sameCompany({ website: 'acme.at', company: 'Acme' }, { website: 'acme.de', company: 'Acme' })).toBe(false);
  });
  it('treats www, scheme and trailing slash as one company', () => {
    expect(sameCompany({ website: 'https://www.acme.com/', company: 'x' }, { website: 'acme.com', company: 'y' })).toBe(true);
  });
  test('safeHref only allows http(s)', () => {
    expect(safeHref(' https://acme.at ')).toBe('https://acme.at');
    expect(safeHref('acme.at')).toBeNull();
    expect(safeHref('javascript:alert(1)')).toBeNull();
  });
});
