import { describe, expect, it } from 'vitest';
import { aPartner, anAccount, person, sampleBook, stamp } from '../test-builders';
import { accountOf, deleteSectionChanges, fillEmpty, sectionsOf } from './accounts';
import { applyPartnerChanges } from './batch';

const twoSections = () => sampleBook({ partners: [aPartner(), aPartner({ id: 'p_tech01', partnerType: 'technology' })] });

describe('accountOf and sectionsOf', () => {
  it('finds the account of a section, and the sections of an account', () => {
    const book = twoSections();
    expect(accountOf(book, book.partners[1]!)).toEqual(anAccount());
    expect(accountOf(book, aPartner({ accountId: 'a_nope00' }))).toBeUndefined();
    expect(sectionsOf(book, 'a_abc123').map((p) => p.id)).toEqual(['p_abc123', 'p_tech01']);
    expect(sectionsOf(book, 'a_nope00')).toEqual([]);
  });
});

describe('fillEmpty', () => {
  it('gives only the fields that are empty on the account and filled in the values', () => {
    const account = anAccount({ website: '', country: 'Austria', vertical: '', subVertical: '', targetCustomerType: 'unknown' });
    expect(fillEmpty(account, {
      company: 'ACME', website: 'acme.com', country: 'Germany', vertical: ' ', subVertical: 'Retail', targetCustomerType: 'smb',
    })).toEqual({ website: 'acme.com', subVertical: 'Retail', targetCustomerType: 'smb' });
  });

  it('does not count an unknown target customer type as filled', () => {
    expect(fillEmpty(anAccount({ targetCustomerType: 'unknown' }), { targetCustomerType: 'unknown' })).toEqual({});
  });

  it('gives nothing when the account has every field', () => {
    expect(fillEmpty(anAccount({ subVertical: 'Retail', comments: 'Met at a fair' }), {
      website: 'other.com', comments: 'From the import',
    })).toEqual({});
  });
});

describe('deleteSectionChanges', () => {
  it('deletes the account and its people with its last section', () => {
    const book = sampleBook({ people: [person(), person({ id: 'e_second' }), person({ id: 'e_beta01', accountId: 'a_beta01' })] });
    const changes = deleteSectionChanges(book, 'p_abc123');
    expect(changes).toEqual([
      { kind: 'delete', entity: 'partner', id: 'p_abc123' },
      { kind: 'delete', entity: 'person', id: 'e_abc123' },
      { kind: 'delete', entity: 'person', id: 'e_second' },
      { kind: 'delete', entity: 'account', id: 'a_abc123' },
    ]);
    const out = applyPartnerChanges(book, changes, stamp());
    expect(out).toMatchObject({ ok: true, value: { accounts: [], partners: [] } });
    // Another account's person is not touched.
    if (out.ok) expect(out.value.people.map((p) => p.id)).toEqual(['e_beta01']);
  });

  it('keeps the account and its people while it has another section', () => {
    const book = twoSections();
    const changes = deleteSectionChanges(book, 'p_tech01');
    expect(changes).toEqual([{ kind: 'delete', entity: 'partner', id: 'p_tech01' }]);
    const out = applyPartnerChanges(book, changes, stamp());
    expect(out).toMatchObject({ ok: true, value: { accounts: [anAccount()], people: book.people } });
  });

  it('gives the delete alone for a section that is not in the book', () => {
    expect(deleteSectionChanges(sampleBook(), 'p_nope00')).toEqual([{ kind: 'delete', entity: 'partner', id: 'p_nope00' }]);
  });
});
