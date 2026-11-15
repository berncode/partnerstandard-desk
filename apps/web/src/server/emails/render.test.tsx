import { Html, Text } from 'react-email';
import { describe, expect, it } from 'vitest';
import { renderEmail } from './render';

describe('renderEmail', () => {
  it('renders one element as an HTML document and as plain text, with the subject', async () => {
    const email = await renderEmail(<Html lang="en"><Text>{'Hi <Lena> & Co'}</Text></Html>, 'Hello');
    expect(email.subject).toBe('Hello');
    expect(email.html).toMatch(/^<!DOCTYPE html/);
    expect(email.html).toContain('Hi &lt;Lena&gt; &amp; Co');
    expect(email.text.trim()).toBe('Hi <Lena> & Co');
  });

  it('bounds the subject at 200 characters and never splits an emoji at the cut', async () => {
    const email = await renderEmail(<Html lang="en"><Text>x</Text></Html>, `${'a'.repeat(198)}😀😀 tail`);
    expect(email.subject).toBe(`${'a'.repeat(198)}😀…`);
    expect(Array.from(email.subject)).toHaveLength(200);
    expect(email.subject.isWellFormed()).toBe(true);
  });
});
