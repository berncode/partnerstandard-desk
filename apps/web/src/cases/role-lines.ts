import { leadShare, type Roles } from '@partner-desk/core';

/**
 * Who does what (spec §4), in short lines without a full stop, as the prototype's `roleLines`: "Northwind introduces the
 * customer", "Acme closes the deal and invoices the customer", "Northwind provides level 1 support". `who` is the partner's
 * name, or "You" on a page the partner sees; `vendor` is the vendor's name. A type that closes owns the sale; the lead
 * share counts only for a type that delivers services and does not close.
 */
export function roleLines(roles: Roles, who: string, vendor: string): string[] {
  const s = who === 'You' ? '' : 's';
  /** The vendor's verbs: "Acme closes", but "You close" while the vendor has no name yet. */
  const v = vendor === 'You' ? '' : 's';
  const lead = Math.round(leadShare(roles) * 100);
  const you = who === 'You';
  const brings = lead >= 100
    ? `${who} introduce${s} the customer`
    : lead > 0
      ? `${who} find${s} ${lead}% of the customers ${you ? 'you' : 'it'} serve${s} ${you ? 'yourself' : 'itself'}`
      : `${vendor} find${v} the customers`;
  return [
    ...(roles.closes
      ? [`${who} find${s} the customer, close${s} the deal and send${s} the invoice`]
      : [brings, `${vendor} close${v} the deal and invoice${v} the customer`]),
    roles.support === 'none'
      ? `${vendor} provide${v} customer support`
      : `${who} provide${s} ${roles.support === 'level12' ? 'level 1 and 2' : 'level 1'} support`,
    ...(roles.services ? [`${who} deliver${s} implementation and services`] : []),
  ];
}

/** "Reseller partner", but "Service partner" stays as it is. */
export const partnerKind = (typeName: string) => (/\bpartner$/i.test(typeName.trim()) ? typeName.trim() : `${typeName.trim()} partner`);
