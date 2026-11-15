// The checks of scripts/release/public-check.mjs (plan 18, task 5). Every fake secret here is put together at run time,
// so neither that check nor gitleaks finds one in this file.
import { describe, expect, it } from 'vitest';
import { findingsIn, isPrivateFile, isSafeAddress, parsePatterns } from '../../../scripts/release/public-check-lib.mjs';

const at = (local: string, domain: string) => `${local}@${domain}`;

describe('public check', () => {
  it('lets only whole example and test domains pass as safe', () => {
    for (const ok of [at('anna', 'example.com'), at('a', 'halden.example'), at('x', 'desk.test'), at('git', 'github.com'), at('noreply', 'anthropic.com')]) {
      expect(isSafeAddress(ok), ok).toBe(true);
    }
    for (const real of [at('jane', 'test-company.com'), at('jane', 'example-corp.de'), at('jane', 'test.realco.de'), at('jane', 'invalid-gmbh.at'), at('jane', 'localhost.evilco.com')]) {
      expect(isSafeAddress(real), real).toBe(false);
    }
  });

  it('finds real addresses, keys and tokens, and not a package version', () => {
    const lines = [
      `owner: ${at('jane', 'realco.de')}`,
      `"better-auth@1.7.15"`,
      `key: ${'AI'}${'za'}${'x'.repeat(35)}`,
      `token: ${'gh'}p_${'a'.repeat(36)}`,
      `jwt: ${'ey'}J${'a'.repeat(12)}.${'ey'}J${'b'.repeat(12)}.${'c'.repeat(12)}`,
    ].join('\n');
    const found = findingsIn('src/x.ts', lines);
    expect(found.map((f) => f.split(': ')[1])).toEqual(['an email address', 'a Google API key', 'a GitHub token', 'a signed token']);
  });

  it('finds your own patterns in lines and file names, and lets the allow file name a line', () => {
    const privatePatterns = parsePatterns('# my name\nKeller\n', 'private');
    const text = 'Copyright (C) 2026 Anna Keller (PartnerStandard).\nBy Anna Keller.';
    expect(findingsIn('README.md', text, { privatePatterns })).toHaveLength(2);
    const allowed = parsePatterns('^README\\.md:1: ', 'allow');
    expect(findingsIn('README.md', text, { privatePatterns, allowed })).toEqual(['README.md:2: a private pattern: Keller']);
    expect(findingsIn('docs/keller-notes.md', '', { privatePatterns })).toEqual(['docs/keller-notes.md:0: a private pattern in the file name: keller']);
  });

  it('knows the old list of owner steps from the short public one at the same path', () => {
    expect(isPrivateFile('docs/open-items.md', '# Open items\n\n## Copy review\n')).toBe(true);
    expect(isPrivateFile('docs/open-items.md', '# Open items\n\n- Something to do.\n')).toBe(false);
    expect(findingsIn('docs/open-items.md', '## Copy review\n')).toEqual(['docs/open-items.md: stays in the private archive']);
  });

  it('says which line of a patterns file is not a regular expression', () => {
    expect(() => parsePatterns('ok\n(broken', 'private.txt')).toThrow('private.txt: not a regular expression: (broken');
  });
});
