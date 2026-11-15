// The hosted build's legal pages (scripts/legal-pages-lib.mjs, plan 19, task 3).
import { describe, expect, it, vi } from 'vitest';
import { prepareLegalPages } from '../scripts/legal-pages-lib.mjs';

const page = (title: string) => ({ title, effective: '2026-11-10', sections: [{ heading: '1. One', blocks: ['Text.'] }] });
const hosted = { VERCEL_ENV: 'production', LEGAL_PAGES_REPO: 'acme/desk-legal', LEGAL_PAGES_TOKEN: 'token-for-the-test' };
const answering = (pages: Record<string, unknown>) => vi.fn(async (url: string) => {
  const name = /contents\/(\w+)\.json/.exec(url)?.[1] ?? '';
  return name in pages ? new Response(JSON.stringify(pages[name])) : new Response('Not Found', { status: 404 });
});

describe('prepareLegalPages', () => {
  it('off Vercel: leaves the stand-ins, fetches nothing', async () => {
    const fetcher = vi.fn();
    const write = vi.fn();
    expect(await prepareLegalPages({ env: { LEGAL_PAGES_REPO: 'acme/x', LEGAL_PAGES_TOKEN: 't' }, fetcher, write })).toBe('stand-ins');
    expect(fetcher).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('on Vercel: fetches the three pages from the private repository with the key, and writes each one checked', async () => {
    const fetcher = answering({ privacy: page('Privacy Policy'), terms: page('Terms of Service'), imprint: page('Imprint') });
    const written: Record<string, string> = {};
    expect(await prepareLegalPages({ env: hosted, fetcher: fetcher as unknown as typeof fetch, write: (name, json) => { written[name] = json; } })).toBe('fetched');
    expect(Object.keys(written)).toEqual(['privacy', 'terms', 'imprint']);
    expect(JSON.parse(written.imprint!)).toMatchObject({ title: 'Imprint' });
    expect(fetcher).toHaveBeenCalledWith('https://api.github.com/repos/acme/desk-legal/contents/privacy.json', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer token-for-the-test' }),
    }));
  });

  it('on Vercel with its system variables turned off (only VERCEL set): still needs the pages', async () => {
    await expect(prepareLegalPages({ env: { VERCEL: '1' }, write: vi.fn() }))
      .rejects.toThrow('Hosted needs its legal pages: set LEGAL_PAGES_REPO and LEGAL_PAGES_TOKEN in Vercel');
  });

  it('on Vercel without its settings: stops the build and says which', async () => {
    await expect(prepareLegalPages({ env: { VERCEL_ENV: 'preview', LEGAL_PAGES_REPO: 'acme/desk-legal' }, write: vi.fn() }))
      .rejects.toThrow('Hosted needs its legal pages: set LEGAL_PAGES_TOKEN in Vercel');
  });

  it('on Vercel: a page that can’t be fetched, isn’t JSON or isn’t a legal page stops the build, before anything is written for it', async () => {
    const write = vi.fn();
    await expect(prepareLegalPages({ env: hosted, fetcher: answering({ privacy: page('P') }) as unknown as typeof fetch, write })).rejects.toThrow('terms.json couldn\'t be fetched from acme/desk-legal (404)');
    const notJson = vi.fn(async () => new Response('<html>'));
    await expect(prepareLegalPages({ env: hosted, fetcher: notJson as unknown as typeof fetch, write: vi.fn() })).rejects.toThrow('privacy.json in acme/desk-legal is not JSON');
    const wrong = answering({ privacy: { title: 'P' } });
    await expect(prepareLegalPages({ env: hosted, fetcher: wrong as unknown as typeof fetch, write: vi.fn() })).rejects.toThrow('privacy: no effective date');
  });

  it('refuses a stand-in fetched in place of the operator’s own page', async () => {
    const fetcher = answering({ privacy: { ...page('Privacy Policy'), standIn: true } });
    await expect(prepareLegalPages({ env: hosted, fetcher: fetcher as unknown as typeof fetch, write: vi.fn() })).rejects.toThrow('privacy.json in acme/desk-legal is a stand-in');
  });

  it('refuses a repository setting that is not owner/name', async () => {
    await expect(prepareLegalPages({ env: { ...hosted, LEGAL_PAGES_REPO: 'https://evil.example/x' }, write: vi.fn() })).rejects.toThrow('LEGAL_PAGES_REPO must be owner/name');
  });
});
