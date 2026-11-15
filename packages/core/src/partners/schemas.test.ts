import { describe, expect, it } from 'vitest';
import { COPY } from '@partner-desk/copy';
import { TEXT_MAX } from '../shared/schemas';
import { accountSchema, partnerSchema, personSchema } from './schemas';
import type { Partner, PartnerAccount } from './types';

const NONE = { customerBase: null, credibility: null, capability: null, commitment: null };
function partner(over: Partial<Partner> = {}): Partner {
  return {
    id: 'p_abc123', companyId: 'co_abcdefghij', accountId: 'a_abc123', partnerType: 'reseller', stage: 'recruitment',
    step: 'researched', closed: null, closedReason: '', signedDate: null, exitedDate: null, exitReason: '',
    source: 'research', sourceDetail: '', whyItFits: '', desk: NONE, confirmed: NONE, mapFilled: false, mapLink: '',
    programId: null, level: null, mapHealth: null, mapNextMilestone: null, updatedAt: null, updatedBy: 'Claude for Ruth', ...over,
  };
}

describe('partnerSchema', () => {
  it('accepts a partner in recruitment with a step', () => {
    expect(partnerSchema.safeParse(partner()).success).toBe(true);
  });
  it('refuses a step outside recruitment', () => {
    const r = partnerSchema.safeParse(partner({ stage: 'growth', step: 'map', signedDate: '2026-01-01' }));
    expect(r.success).toBe(false);
  });
  it('refuses closed after signing', () => {
    const r = partnerSchema.safeParse(partner({ stage: 'onboarding', step: null, signedDate: '2026-01-01', closed: 'no' }));
    expect(r.success).toBe(false);
  });
  it('refuses an exit date before signing', () => {
    const r = partnerSchema.safeParse(
      partner({ stage: 'exit', step: null, signedDate: '2026-03-01', exitedDate: '2026-02-01' }),
    );
    expect(r.success).toBe(false);
  });
  it('refuses an exit date without a signing date', () => {
    expect(partnerSchema.safeParse(partner({ exitedDate: '2026-02-01' })).success).toBe(false);
  });
  it('accepts an exit after signing', () => {
    const r = partnerSchema.safeParse(
      partner({ stage: 'exit', step: null, signedDate: '2026-01-01', exitedDate: '2026-02-01' }),
    );
    expect(r.success).toBe(true);
  });
  it('limits text to TEXT_MAX', () => {
    expect(partnerSchema.safeParse(partner({ whyItFits: 'a'.repeat(TEXT_MAX) })).success).toBe(true);
    expect(partnerSchema.safeParse(partner({ whyItFits: 'a'.repeat(TEXT_MAX + 1) })).success).toBe(false);
  });
  it('needs an account', () => {
    expect(partnerSchema.safeParse(partner({ accountId: '' })).success).toBe(false);
  });
  it('accepts an existing partner as the source', () => {
    expect(partnerSchema.safeParse(partner({ source: 'existing_partner' })).success).toBe(true);
  });
});

function account(over: Partial<PartnerAccount> = {}): PartnerAccount {
  return {
    id: 'a_abc123', company: 'Acme GmbH', website: 'https://acme.example', country: 'Austria', vertical: 'Managed IT',
    subVertical: '', targetCustomerType: 'smb', comments: '', updatedAt: null, updatedBy: 'Claude for Ruth', ...over,
  };
}

describe('accountSchema', () => {
  it('accepts an account', () => {
    expect(accountSchema.safeParse(account()).success).toBe(true);
  });
  it('needs a company name', () => {
    expect(accountSchema.safeParse(account({ company: '  ' })).success).toBe(false);
  });
  it('limits text to TEXT_MAX', () => {
    expect(accountSchema.safeParse(account({ comments: 'a'.repeat(TEXT_MAX + 1) })).success).toBe(false);
  });
});

describe('personSchema', () => {
  it('belongs to an account', () => {
    const person = {
      id: 'e_abc123', accountId: 'a_abc123', name: 'Eva', title: '', email: null, role: 'contact', activeSeller: false,
      updatedAt: null, updatedBy: 'Ruth',
    };
    expect(personSchema.safeParse(person).success).toBe(true);
    expect(personSchema.safeParse({ ...person, accountId: '' }).success).toBe(false);
  });
});

describe('partnerSchema: program and level', () => {
  it('accepts a partner with a program and a level, or a program alone', () => {
    expect(partnerSchema.safeParse({ ...partner(), programId: 'pg_dach0001', level: 'pref' }).success).toBe(true);
    expect(partnerSchema.safeParse({ ...partner(), programId: 'pg_dach0001', level: null }).success).toBe(true);
    expect(partnerSchema.safeParse({ ...partner(), programId: null, level: null }).success).toBe(true);
  });
  it('refuses a level without a program, naming the level', () => {
    const r = partnerSchema.safeParse({ ...partner(), programId: null, level: 'reg' });
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues.map((i) => [i.path.join('.'), i.message])).toEqual([['level', COPY.LEVEL_NEEDS_PROGRAM]]);
  });
  it('refuses a level that is not Registered or Preferred', () => {
    expect(partnerSchema.safeParse({ ...partner(), programId: 'pg_dach0001', level: 'gold' }).success).toBe(false);
  });
});
