import { describe, expect, it } from 'vitest';
import { COPY } from '@partner-desk/copy';
import { cleanCompanyName, COMPANY_NAME_MAX } from './company-name';

describe('cleanCompanyName', () => {
  it('trims the name', () => {
    expect(cleanCompanyName('  Halden GmbH ')).toEqual({ ok: true, value: 'Halden GmbH' });
  });

  it('takes empty, only spaces or nothing as no name', () => {
    expect(cleanCompanyName('')).toEqual({ ok: true, value: '' });
    expect(cleanCompanyName('   ')).toEqual({ ok: true, value: '' });
    expect(cleanCompanyName(null)).toEqual({ ok: true, value: '' });
    expect(cleanCompanyName(undefined)).toEqual({ ok: true, value: '' });
  });

  it('allows 80 characters, counted as people see them, and refuses more', () => {
    expect(COMPANY_NAME_MAX).toBe(80);
    expect(cleanCompanyName('a'.repeat(80))).toEqual({ ok: true, value: 'a'.repeat(80) });
    expect(cleanCompanyName('é'.repeat(80))).toMatchObject({ ok: true });
    expect(cleanCompanyName('😀'.repeat(80))).toMatchObject({ ok: true });
    expect(cleanCompanyName('a'.repeat(81))).toEqual({ ok: false, reason: 'too_long' });
  });

  it('refuses control characters and anything that is not text', () => {
    expect(cleanCompanyName('Halden\nGmbH')).toEqual({ ok: false, reason: 'invalid' });
    expect(cleanCompanyName('Halden\u0000')).toEqual({ ok: false, reason: 'invalid' });
    expect(cleanCompanyName(42)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('says the limit in the too-long message', () => {
    expect(COPY.COMPANY_NAME_TOO_LONG).toContain(String(COMPANY_NAME_MAX));
  });
});
