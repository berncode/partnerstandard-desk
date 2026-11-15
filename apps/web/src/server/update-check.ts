// The update notice on a company server (plan 17, task 5; spec 2026-11-07 §10.5): at most once a day the server reads
// the public list of releases on GitHub, and Settings tells admins when a newer one is out. The request carries
// nothing about the company: no address, no version, no id. `UPDATE_CHECK=off` turns it off; hosted never asks.
import type { Log } from './log';

export interface Release {
  version: string;
  /** The release's page on GitHub: what changed. */
  url: string;
}

/** What Settings shows: the version this server runs, and a newer release when there is one. */
export interface UpdateStatus {
  current: string;
  update: Release | null;
  /** Where the releases and the guide live, like `berncode/partnerstandard-desk`. */
  repo: string;
}

type Semver = [number, number, number];

/** `1.4.2` or `v1.4.2`; null for anything else, a pre-release (`1.5.0-rc.1`) among them. */
export function parseVersion(value: string): Semver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

const compare = (a: Semver, b: Semver): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

interface GitHubRelease { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown }

/** The newest published release in GitHub's list, or null when it has none. Anything it can't read is skipped. */
export function newestRelease(list: unknown): Release | null {
  if (!Array.isArray(list)) return null;
  let best: { semver: Semver; release: Release } | null = null;
  for (const item of list as GitHubRelease[]) {
    if (!item || item.draft === true || item.prerelease === true || typeof item.tag_name !== 'string' || typeof item.html_url !== 'string') continue;
    // A link admins click: only ever to a page on GitHub.
    if (!item.html_url.startsWith('https://github.com/')) continue;
    const semver = parseVersion(item.tag_name);
    if (!semver) continue;
    if (!best || compare(semver, best.semver) > 0) best = { semver, release: { version: semver.join('.'), url: item.html_url } };
  }
  return best?.release ?? null;
}

export interface UpdateCheckDeps {
  /** This server's version, baked into the image when it was released (APP_VERSION); null for any other build. */
  current: string | null;
  /** The repository its releases come from, like `berncode/partnerstandard-desk`. */
  repo: string;
  fetcher?: typeof fetch;
  now?: () => number;
  log: Log;
}

/** A day between two reads of the list; an hour after one that failed. */
export const CHECK_EVERY_MS = 24 * 60 * 60_000;
export const RETRY_AFTER_MS = 60 * 60_000;

/** The check, with its answer kept for a day. Null when this server has no release version to compare. */
export function createUpdateCheck(deps: UpdateCheckDeps): { status: () => Promise<UpdateStatus | null> } | null {
  const current = deps.current ? parseVersion(deps.current) : null;
  if (!current) return null;
  const now = deps.now ?? Date.now;
  const fetcher = deps.fetcher ?? fetch;
  const version = current.join('.');
  let kept: { until: number; newest: Release | null } | null = null;
  let asking: Promise<Release | null> | null = null;

  const ask = async (): Promise<Release | null> => {
    try {
      const res = await fetcher(`https://api.github.com/repos/${deps.repo}/releases?per_page=30`, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'partner-desk-update-check' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`status_${res.status}`);
      const newest = newestRelease(await res.json());
      kept = { until: now() + CHECK_EVERY_MS, newest };
      return newest;
    } catch (error) {
      deps.log('update_check_failed', { reason: error instanceof Error ? error.message.slice(0, 100) : 'unknown' });
      kept = { until: now() + RETRY_AFTER_MS, newest: kept?.newest ?? null };
      return kept.newest;
    }
  };

  return {
    status: async () => {
      let newest: Release | null;
      if (kept && now() < kept.until) newest = kept.newest;
      else {
        // One request for everyone who opens Settings at the same moment.
        asking ??= ask().finally(() => { asking = null; });
        newest = await asking;
      }
      const update = newest && compare(parseVersion(newest.version)!, current) > 0 ? newest : null;
      return { current: version, update, repo: deps.repo };
    },
  };
}

/** Whether this server asks at all: a company server only, never on Vercel, and not with UPDATE_CHECK=off. */
export function updateCheckOn(input: { edition: 'hosted' | 'self-hosted'; setting: 'on' | 'off'; onVercel: boolean }): boolean {
  return input.edition === 'self-hosted' && !input.onVercel && input.setting === 'on';
}

/** Where releases come from when the image doesn't say (APP_REPO): this repository. */
export const DEFAULT_RELEASE_REPO = 'berncode/partnerstandard-desk';
