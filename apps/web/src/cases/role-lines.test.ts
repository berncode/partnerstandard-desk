import { describe, expect, it } from 'vitest';
import { DEFAULT_TYPES } from '@partner-desk/core';
import { roleLines } from './role-lines';

const roles = (id: string) => DEFAULT_TYPES.find((t) => t.id === id)!.roles;

describe('roleLines', () => {
  it('names the partner and the vendor for each starting type', () => {
    expect(roleLines(roles('type_referral'), 'Northwind', 'Acme')).toEqual([
      'Northwind introduces the customer', 'Acme closes the deal and invoices the customer', 'Acme provides customer support',
    ]);
    expect(roleLines(roles('type_reseller'), 'Northwind', 'Acme')).toEqual([
      'Northwind finds the customer, closes the deal and sends the invoice', 'Northwind provides level 1 support',
    ]);
    expect(roleLines(roles('type_service'), 'Northwind', 'Acme')).toEqual([
      'Northwind finds 30% of the customers it serves itself', 'Acme closes the deal and invoices the customer', 'Acme provides customer support',
      'Northwind delivers implementation and services',
    ]);
    expect(roleLines(roles('type_var'), 'Northwind', 'Acme')).toEqual([
      'Northwind finds the customer, closes the deal and sends the invoice', 'Northwind provides level 1 and 2 support',
      'Northwind delivers implementation and services',
    ]);
  });

  it('speaks to the partner as “you” on its own page', () => {
    expect(roleLines(roles('type_var'), 'You', 'Acme')).toEqual([
      'You find the customer, close the deal and send the invoice', 'You provide level 1 and 2 support', 'You deliver implementation and services',
    ]);
  });

  it('speaks of the vendor as “you” while it has no name yet', () => {
    expect(roleLines(roles('type_referral'), 'Northwind', 'You')).toEqual([
      'Northwind introduces the customer', 'You close the deal and invoice the customer', 'You provide customer support',
    ]);
    expect(roleLines({ ...roles('type_service'), lead: 0 }, 'Northwind', 'You')[0]).toBe('You find the customers');
  });

  it('says the vendor finds the customers when a service partner brings no leads', () => {
    expect(roleLines({ ...roles('type_service'), lead: 0 }, 'Northwind', 'Acme')[0]).toBe('Acme finds the customers');
  });

  it('says the same on the partner’s page for every type', () => {
    expect(roleLines(roles('type_referral'), 'You', 'Acme')[0]).toBe('You introduce the customer');
    expect(roleLines(roles('type_service'), 'You', 'Acme')[0]).toBe('You find 30% of the customers you serve yourself');
    expect(roleLines(roles('type_reseller'), 'You', 'Acme')[0]).toBe('You find the customer, close the deal and send the invoice');
    expect(roleLines(roles('type_var'), 'You', 'Acme')[0]).toBe('You find the customer, close the deal and send the invoice');
  });
});
