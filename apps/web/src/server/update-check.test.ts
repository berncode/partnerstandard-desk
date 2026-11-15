import { describe, expect, it, vi } from 'vitest';
import { CHECK_EVERY_MS, createUpdateCheck, newestRelease, parseVersion, RETRY_AFTER_MS, updateCheckOn } from './update-check';

const release = (tag: string, extra: Record<string, unknown> = {}) => ({ tag_name: tag, html_url: `https://github.com/o/r/releases/tag/${tag}`, draft: false, prerelease: false, ...extra });
const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('parseVersion', () => {
  it('reads 1.4.2 and v1.4.2, and nothing else', () => {
    expect(parseVersion('1.4.2')).toEqual([1, 4, 2]);
    expect(parseVersion('v10.0.11')).toEqual([10, 0, 11]);
    for (const other of ['1.4', '1.5.0-rc.1', 'latest', '', 'local']) expect(parseVersion(other)).toBeNull();
  });
});

describe('newestRelease', () => {
  it('the highest published version, not the first in the list; drafts and pre-releases skipped', () => {
    expect(newestRelease([release('v1.9.0'), release('v1.10.0'), release('v2.0.0', { draft: true }), release('v2.0.0-rc.1', { prerelease: true }), release('v2.1.0', { prerelease: true })]))
      .toEqual({ version: '1.10.0', url: 'https://github.com/o/r/releases/tag/v1.10.0' });
  });
  it('a release whose page is not on GitHub is skipped', () => {
    expect(newestRelease([release('v1.4.0'), release('v1.5.0', { html_url: 'javascript:alert(1)' }), release('v1.6.0', { html_url: 'https://evil.example/x' })]))
      .toEqual({ version: '1.4.0', url: 'https://github.com/o/r/releases/tag/v1.4.0' });
  });

  it('nothing it can read: null', () => {
    expect(newestRelease({ message: 'Not Found' })).toBeNull();
    expect(newestRelease([{ tag_name: 3 }, null])).toBeNull();
  });
});

describe('createUpdateCheck', () => {
  it('a newer release: shown with its page', async () => {
    const check = createUpdateCheck({ current: '1.4.2', repo: 'o/r', fetcher: answer([release('v1.5.0')]) as unknown as typeof fetch, log: () => {} })!;
    expect(await check.status()).toEqual({ current: '1.4.2', update: { version: '1.5.0', url: 'https://github.com/o/r/releases/tag/v1.5.0' }, repo: 'o/r' });
  });

  it('the same or an older release: no update', async () => {
    const check = createUpdateCheck({ current: '1.4.2', repo: 'o/r', fetcher: answer([release('v1.4.2'), release('v1.3.9')]) as unknown as typeof fetch, log: () => {} })!;
    expect(await check.status()).toEqual({ current: '1.4.2', update: null, repo: 'o/r' });
  });

  it('asks only the public list, with nothing about the company', async () => {
    const fetcher = answer([]);
    await createUpdateCheck({ current: '1.4.2', repo: 'o/r', fetcher: fetcher as unknown as typeof fetch, log: () => {} })!.status();
    expect(fetcher).toHaveBeenCalledWith('https://api.github.com/repos/o/r/releases?per_page=30', expect.objectContaining({
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'partner-desk-update-check' },
    }));
  });

  it('asks once a day, and once for many at the same time', async () => {
    let clock = 0;
    const fetcher = answer([release('v1.5.0')]);
    const check = createUpdateCheck({ current: '1.4.2', repo: 'o/r', fetcher: fetcher as unknown as typeof fetch, now: () => clock, log: () => {} })!;
    await Promise.all([check.status(), check.status(), check.status()]);
    clock = CHECK_EVERY_MS - 1;
    await check.status();
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock = CHECK_EVERY_MS;
    await check.status();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('GitHub unreachable: no update shown, a log line, another try an hour later', async () => {
    let clock = 0;
    const fetcher = vi.fn(async () => { throw new Error('fetch failed'); });
    const logged: string[] = [];
    const check = createUpdateCheck({ current: '1.4.2', repo: 'o/r', fetcher: fetcher as unknown as typeof fetch, now: () => clock, log: (e) => { logged.push(e); } })!;
    expect(await check.status()).toEqual({ current: '1.4.2', update: null, repo: 'o/r' });
    expect(logged).toEqual(['update_check_failed']);
    await check.status();
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock = RETRY_AFTER_MS;
    await check.status();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('an error answer counts as unreachable', async () => {
    const check = createUpdateCheck({ current: '1.4.2', repo: 'o/r', fetcher: answer({ message: 'rate limited' }, 403) as unknown as typeof fetch, log: () => {} })!;
    expect(await check.status()).toEqual({ current: '1.4.2', update: null, repo: 'o/r' });
  });

  it('a build without a release version: no check at all', () => {
    for (const current of [null, '', 'local', '0.1.0-dev']) expect(createUpdateCheck({ current, repo: 'o/r', log: () => {} })).toBeNull();
  });
});

describe('updateCheckOn', () => {
  it('a company server asks unless UPDATE_CHECK=off; hosted never, on Vercel or anywhere else', () => {
    expect(updateCheckOn({ edition: 'self-hosted', setting: 'on', onVercel: false })).toBe(true);
    expect(updateCheckOn({ edition: 'self-hosted', setting: 'off', onVercel: false })).toBe(false);
    expect(updateCheckOn({ edition: 'hosted', setting: 'on', onVercel: false })).toBe(false);
    expect(updateCheckOn({ edition: 'hosted', setting: 'on', onVercel: true })).toBe(false);
  });
});
