import { describe, expect, it } from 'vitest';
import { PARTNER_TYPE_LABELS } from '@partner-desk/method';
import * as words from './index';
import { COPY, SOURCE_LABELS } from './index';

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      strings(v, out);
    }
  }
  return out;
}

describe('the app’s words', () => {
  it('has no em dash in any text', () => {
    for (const s of strings(words)) expect(s.includes('—'), s).toBe(false);
  });

  it('words the MAP emails’ due lines as the MAP app did', () => {
    expect(COPY.MAP_NUDGE_DUE(1, '21 Oct')).toBe('Due tomorrow (21 Oct)');
    expect(COPY.MAP_NUDGE_DUE(3, '24 Oct')).toBe('Due in 3 days (24 Oct)');
    expect(COPY.MAP_NUDGE_OVERDUE(1, '17 Oct')).toBe('1 day overdue (was due 17 Oct)');
    expect(COPY.MAP_NUDGE_OVERDUE(2, '17 Oct')).toBe('2 days overdue (was due 17 Oct)');
    expect(COPY.MAP_DIGEST_DUE('Kickoff', '21 Oct')).toBe('Kickoff (due 21 Oct)');
    expect(COPY.MAP_DIGEST_OVERDUE('Kickoff', 3)).toBe('Kickoff (3 days overdue)');
    expect(COPY.MAP_ALERT_SOMEONE).toBe('Someone with a link');
  });

  it('names the source for a company you worked with before', () => {
    expect(SOURCE_LABELS.existing_partner).toBe('Existing partner');
  });

  it('says which type a company already has, with the right article', () => {
    expect(COPY.ALREADY_THIS_TYPE('Acme', 'Reseller')).toBe('Acme is already a reseller.');
    expect(COPY.ALREADY_THIS_TYPE('Acme', 'OEM Partner')).toBe('Acme is already an OEM partner.');
    expect(COPY.ALREADY_THIS_TYPE('Acme', 'Integration/IPaaS Partner')).toBe('Acme is already an integration/IPaaS partner.');
    expect(COPY.ALREADY_THIS_TYPE('Acme', 'Co-Seller')).toBe('Acme is already a co-seller.');
  });

  it('puts a or an before a partner type in every sentence, and never says "an other"', () => {
    expect(COPY.ALREADY_THIS_TYPE('Acme', 'Other')).not.toContain('an other');
    expect(COPY.ALREADY_THIS_TYPE('Acme', 'Other')).toBe('Acme is already a partner.');
    expect(COPY.ROW_OTHER_TYPE('Acme', 'Reseller', 'OEM Partner')).toMatch(/as an OEM partner\.$/);
    expect(COPY.ALREADY_YOUR_TYPE('Acme', 'Reseller', 'Affiliate Partner')).toBe('Acme is already your reseller. This adds Acme as an affiliate partner.');
    expect(COPY.ALREADY_YOUR_TYPE('Acme', 'Other', 'Reseller')).toBe('Acme is already your partner. This adds Acme as a reseller.');
    expect(COPY.ALREADY_YOUR_TYPE('Acme', 'Reseller', 'Other')).toBe('Acme is already your reseller. This adds Acme as a partner.');
    expect(COPY.ROW_CLOSED('Acme', 'OEM Partner', 'Not now')).toBe('You closed Acme as an OEM partner (Not now).');
    expect(COPY.ROW_CLOSED('Acme', 'Other', 'No')).toBe('You closed Acme as a partner (No).');
    expect(COPY.ROW_CLOSED('Acme', 'Affiliate Partner', 'No')).toBe('You closed Acme as an affiliate partner (No).');
    for (const label of Object.values(PARTNER_TYPE_LABELS)) {
      for (const text of [COPY.ALREADY_THIS_TYPE('Acme', label), COPY.ROW_OTHER_TYPE('Acme', label, label), COPY.ROW_CLOSED('Acme', label, 'No'), COPY.ALREADY_YOUR_TYPE('Acme', label, label)]) {
        expect(text).not.toMatch(/\ba [aeiouAEIOU]/);
        expect(text).not.toMatch(/\ban [^aeiouAEIOU]/);
      }
    }
  });

  it('says a signed company typed as a first partner won’t be added', () => {
    expect(COPY.FIRST_PARTNER_ALREADY_SIGNED('Reseller')).toBe('Already a signed reseller. It won’t be added here.');
  });

  it('says the partner hypotheses grow before, during and after the calls (owner, 2026-11-01)', () => {
    expect(COPY.HYPOTHESES_TEXT).toBe('Who to look for, and why the partnership works for both sides. It grows before, during and after your calls, and is the profile for finding more companies like them.');
  });
});
