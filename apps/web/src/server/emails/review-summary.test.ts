// The summary email (reviews spec 5.6): sent to partner contacts on the owner's behalf, with the link to the summary.
import { COPY } from '@partner-desk/copy';
import { describe, expect, it } from 'vitest';
import { reviewSummaryEmail } from './review-summary';

const input = {
  ownerName: 'Anna Keller', ourName: 'Halden', personName: 'Lena Ortiz', heldOn: '2026-10-28', url: 'https://desk.test/r/abc',
};

describe('reviewSummaryEmail', () => {
  it('keeps its subject: who sent it and when the review was held', async () => {
    const email = await reviewSummaryEmail(input);
    expect(email.subject).toBe('Anna Keller sent you the summary of your review on 28 Oct 2026');
    expect(email.subject).toBe(COPY.REVIEW_SUMMARY_MAIL_SUBJECT('Anna Keller', '28 Oct 2026'));
  });

  it('carries the link in both bodies, says who sent it and when the review was held', async () => {
    const email = await reviewSummaryEmail(input);
    expect(email.html).toMatch(/^<!DOCTYPE html/);
    expect(email.text).toContain('https://desk.test/r/abc');
    expect(email.html).toContain('href="https://desk.test/r/abc"');
    expect(email.text).toContain('Hi Lena Ortiz,');
    expect(email.text).toContain('Anna Keller from Halden sent you the summary of the review held on 28 Oct 2026');
    expect(email.text).toContain(COPY.REVIEW_SUMMARY_MAIL_NOTE('Anna Keller'));
    expect(email.text).toContain(COPY.REVIEW_SUMMARY_MAIL_PRIVATE);
  });

  it('names the owner alone when the company has no name yet, and escapes names in the HTML', async () => {
    expect((await reviewSummaryEmail({ ...input, ourName: null })).text).toContain('Anna Keller sent you the summary of the review held on');
    const email = await reviewSummaryEmail({ ...input, personName: '<script>x</script> & Co', ownerName: 'A "B"' });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; Co');
  });

  it('has no em dash and no unsubscribe link (transactional)', async () => {
    const email = await reviewSummaryEmail(input);
    expect(`${email.subject}${email.text}`).not.toContain('—');
    expect(email.text).not.toMatch(/unsubscribe/i);
  });

  it('renders the same text and HTML as last time', async () => {
    const email = await reviewSummaryEmail(input);
    expect(email.text).toMatchSnapshot();
    expect(email.html).toMatchSnapshot();
  });
});
