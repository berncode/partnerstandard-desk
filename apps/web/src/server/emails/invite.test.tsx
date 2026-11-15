import { describe, expect, it } from 'vitest';
import { inviteEmail } from './invite';
import { signInConfirmUrl } from './sign-in';

describe('the invite email (plan 15, task 6)', () => {
  it('names who invited, and its one button opens the confirm page, never Better Auth’s own link', async () => {
    const url = signInConfirmUrl('https://desk.acme.example', 'AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf', '/this-week');
    const mail = await inviteEmail({ inviterName: 'Anna Keller', url });
    expect(mail.subject).toBe('Anna Keller invited you to PartnerStandard Desk');
    expect(mail.text).toContain(url);
    expect(mail.text).toContain('Sign in to PartnerStandard Desk');
    expect(mail.text + mail.html).not.toContain('/api/auth/magic-link');
    expect(mail.text).toContain('This button works once, for 15 minutes.');
    expect(mail.text + mail.html).not.toMatch(/—/);
  });

  it('still reads when the inviter’s account is gone', async () => {
    expect((await inviteEmail({ inviterName: '', url: 'https://desk.acme.example/sign-in/confirm?token=t' })).subject).toBe('You’re invited to PartnerStandard Desk');
  });
});
