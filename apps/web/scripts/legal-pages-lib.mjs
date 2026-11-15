// The hosted build's legal pages (plan 19, task 3; owner, 2026-11-10). The public code holds neutral stand-ins in
// src/content/legal/pages. On Vercel, which is always hosted, this fetches the operator's own pages from their private
// repository and writes them over the stand-ins, in Vercel's copy only. It fetches data (JSON), never code, and checks
// each page's shape. Hosted never builds without them: a missing setting or a failed fetch stops the build.
import { checkLegalDoc, LEGAL_PAGES } from '../src/content/legal/check.mjs';

/** The settings it needs on Vercel, for Production and Preview. */
export const SETTINGS = ['LEGAL_PAGES_REPO', 'LEGAL_PAGES_TOKEN'];

/**
 * What the build should do: nothing off Vercel (the stand-ins stay); on Vercel, fetch the pages and hand each, checked,
 * to `write`. Throws with a plain message when a setting is missing or a page can't be fetched or read.
 */
export async function prepareLegalPages({ env, fetcher = fetch, write }) {
  // VERCEL_ENV is set when Vercel exposes its system variables; VERCEL on every Vercel build, in case that is turned off.
  if (!env.VERCEL_ENV && !env.VERCEL) return 'stand-ins';
  const missing = SETTINGS.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Hosted needs its legal pages: set ${missing.join(' and ')} in Vercel, for Production and Preview.`);
  }
  const repo = env.LEGAL_PAGES_REPO;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('LEGAL_PAGES_REPO must be owner/name, like acme/desk-legal.');
  for (const name of LEGAL_PAGES) {
    const url = `https://api.github.com/repos/${repo}/contents/${name}.json`;
    const res = await fetcher(url, {
      headers: { accept: 'application/vnd.github.raw+json', authorization: `Bearer ${env.LEGAL_PAGES_TOKEN}`, 'user-agent': 'partnerstandard-desk-build' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`The legal page ${name}.json couldn't be fetched from ${repo} (${res.status}).`);
    let data;
    try {
      data = JSON.parse(await res.text());
    } catch {
      throw new Error(`${name}.json in ${repo} is not JSON.`);
    }
    const page = checkLegalDoc(data, name);
    if (page.standIn) throw new Error(`${name}.json in ${repo} is a stand-in, not the operator's own page.`);
    await write(name, JSON.stringify(page, null, 2) + '\n');
  }
  return 'fetched';
}
