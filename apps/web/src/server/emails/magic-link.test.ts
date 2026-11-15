import { describe, expect, it } from 'vitest';
import { magicLinkEmail } from './magic-link';

const input = { ownerName: 'Anna Keller', partnerName: 'Brightwave Systems', personName: 'Lena Ortiz', side: 'partner' as const, url: 'https://map.test/c/abc' };

describe('magicLinkEmail', () => {
  it('keeps its subject, names the owner and the plan, and carries the link in both bodies', async () => {
    const email = await magicLinkEmail(input);
    expect(email.html).toMatch(/^<!DOCTYPE html/);
    expect(email.subject).toBe('Anna Keller shared a mutual action plan with you: Brightwave Systems');
    expect(email.text).toContain('https://map.test/c/abc');
    expect(email.html).toContain('href="https://map.test/c/abc"');
    expect(email.text).toContain('Hi Lena Ortiz,');
    expect(email.text).toMatch(/update the activities and objectives on your side\. No account needed\./);
    expect(email.text).toContain('please don’t forward it');
  });

  it('escapes names in the HTML body', async () => {
    const email = await magicLinkEmail({ ...input, partnerName: '<script>x</script> & Co', ownerName: 'A "B"' });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; Co');
    expect(email.html).toContain('A &quot;B&quot;');
  });

  it('names the “us” side after the owner’s company when one is set', async () => {
    expect((await magicLinkEmail({ ...input, side: 'us', ourName: 'Acme Partners' })).text).toMatch(/on Acme Partners’ side\. No account needed\./);
    expect((await magicLinkEmail({ ...input, side: 'us', ourName: null })).text).toMatch(/Anna Keller’s side/);
    expect((await magicLinkEmail({ ...input, ourName: 'Acme Partners' })).text).toMatch(/on your side\. No account needed\./);
  });

  it('tells internal colleagues they can update the “us” side', async () => {
    expect((await magicLinkEmail({ ...input, side: 'us' })).text).toMatch(/Anna Keller’s side/);
  });

  it('writes the owner’s possessive the way their name needs', async () => {
    const text = (await magicLinkEmail({ ...input, ownerName: 'James Ellis', side: 'us' })).text;
    expect(text).toMatch(/James Ellis’ side/);
    expect(text).not.toMatch(/Ellis’s/);
  });

  it('says it comes from PartnerStandard Desk, and has no em dash', async () => {
    const email = await magicLinkEmail(input);
    expect(email.text).toContain('Sent by PartnerStandard Desk for Anna Keller.');
    expect(`${email.subject}${email.text}`).not.toContain('—');
  });

  it('is transactional: no unsubscribe link', async () => {
    expect((await magicLinkEmail(input)).text).not.toMatch(/unsubscribe/i);
  });

  it('renders the same text and HTML as last time', async () => {
    const email = await magicLinkEmail(input);
    expect(email.text).toMatchSnapshot();
    expect(email.html).toMatchSnapshot();
  });
});
