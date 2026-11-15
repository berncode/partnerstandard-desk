// The partner book's danglingRefs and activeSellerCount.
import type { Level } from '../programs/types';
import type { Partner, PartnerBook, PartnerEntity } from './types';

export interface DanglingRef {
  entity: PartnerEntity;
  id: string;
  field: string;
}

/** Named sellers on the partner's side who actively sell (recruitment question 3). People belong to the account. */
export function activeSellerCount(book: PartnerBook, accountId: string): number {
  return book.people.filter((p) => p.accountId === accountId && p.role === 'seller' && p.activeSeller).length;
}

/**
 * Rows that belong to an account or a section that no longer exists. They show as "needs attention" and are never
 * removed automatically. A market link's `marketId` lives in another file and is not checked here.
 */
export function danglingRefs(book: PartnerBook): DanglingRef[] {
  const accounts = new Set(book.accounts.map((a) => a.id));
  const partners = new Set(book.partners.map((p) => p.id));
  const out: DanglingRef[] = [];
  const ofAccount = [
    ['partner', book.partners], ['person', book.people],
  ] as const satisfies readonly (readonly [PartnerEntity, readonly { id: string; accountId: string }[]])[];
  for (const [entity, rows] of ofAccount) {
    for (const row of rows) if (!accounts.has(row.accountId)) out.push({ entity, id: row.id, field: 'accountId' });
  }
  const ofPartner = [
    ['call', book.calls], ['qualification', book.qualifications], ['marketLink', book.marketLinks],
  ] as const satisfies readonly (readonly [PartnerEntity, readonly { id: string; partnerId: string }[]])[];
  for (const [entity, rows] of ofPartner) {
    for (const row of rows) if (!partners.has(row.partnerId)) out.push({ entity, id: row.id, field: 'partnerId' });
  }
  return out;
}

/** A partner type's level in its program: a program without a level is the starting level, Registered. */
export function levelOf(partner: Pick<Partner, 'programId' | 'level'>): Level | null {
  return partner.programId === null ? null : partner.level ?? 'reg';
}
