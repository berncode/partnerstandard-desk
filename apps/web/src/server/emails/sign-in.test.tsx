import { describe, expect, it } from 'vitest';
import { signInConfirmUrl, signInEmail } from './sign-in';

describe('the sign-in email (plan 14, task 3)', () => {
  it('links to the confirm page with the token, never to Better Auth’s own link', async () => {
    const url = signInConfirmUrl('https://desk.acme.example', 'AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf', '/this-week');
    expect(url).toBe('https://desk.acme.example/sign-in/confirm?token=AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf');
    const mail = await signInEmail({ url });
    expect(mail.subject).toBe('Sign in to PartnerStandard Desk');
    expect(mail.text).toContain(url);
    expect(mail.html).toContain(url.replace(/&/g, '&amp;'));
    expect(mail.text + mail.html).not.toContain('/api/auth/magic-link');
    expect(mail.text).toContain('This link works once, for 15 minutes.');
    expect(mail.text + mail.html).not.toMatch(/—/);
  });

  it('carries where the person was going', () => {
    expect(signInConfirmUrl('https://desk.acme.example', 'tok', '/oauth/allow?client_id=a&sig=b'))
      .toBe('https://desk.acme.example/sign-in/confirm?token=tok&next=%2Foauth%2Fallow%3Fclient_id%3Da%26sig%3Db');
  });
});
