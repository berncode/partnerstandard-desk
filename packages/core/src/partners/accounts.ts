// Partner accounts and their sections: one account per company, one section (a Partner row) per partner type.
import type { PartnerChange } from './changes';
import { ACCOUNT_FIELDS, type AccountFields, type Partner, type PartnerAccount, type PartnerBook } from './types';

/** The account a section belongs to; undefined when it is missing (a dangling section). */
export function accountOf(book: PartnerBook, partner: Partner): PartnerAccount | undefined {
  return book.accounts.find((a) => a.id === partner.accountId);
}

/** The account's sections, in book order. */
export function sectionsOf(book: PartnerBook, accountId: string): Partner[] {
  return book.partners.filter((p) => p.accountId === accountId);
}

/** An unknown target customer type counts as empty, like a blank text. */
const isEmpty = (key: keyof AccountFields, value: string) => value.trim() === '' || (key === 'targetCustomerType' && value === 'unknown');

/**
 * The fields of `values` that fill a gap on the account: empty there, filled in `values`. What a person already
 * entered on the account is never overwritten, e.g. when an import finds a company that is already a partner.
 */
export function fillEmpty(account: PartnerAccount, values: Partial<AccountFields>): Partial<AccountFields> {
  const out: Partial<AccountFields> = {};
  for (const key of ACCOUNT_FIELDS) {
    const value = values[key];
    if (value !== undefined && isEmpty(key, account[key]) && !isEmpty(key, value)) Object.assign(out, { [key]: value });
  }
  return out;
}

/**
 * Deleting a section: the section, then, when it was the account's last one, the account's people and the account, so
 * no company is left in Partners without a type and no contact is left without a company. Each step is valid against
 * the book as the steps before it left it; apply them as one batch.
 */
export function deleteSectionChanges(book: PartnerBook, partnerId: string): PartnerChange[] {
  const changes: PartnerChange[] = [{ kind: 'delete', entity: 'partner', id: partnerId }];
  const section = book.partners.find((p) => p.id === partnerId);
  if (!section) return changes;
  const lastOne = sectionsOf(book, section.accountId).length === 1;
  if (!lastOne || !accountOf(book, section)) return changes;
  for (const person of book.people) {
    if (person.accountId === section.accountId) changes.push({ kind: 'delete', entity: 'person', id: person.id });
  }
  changes.push({ kind: 'delete', entity: 'account', id: section.accountId });
  return changes;
}
