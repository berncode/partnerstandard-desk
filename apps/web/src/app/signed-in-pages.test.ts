import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// The (signed-in) layout does not redirect a signed-out visit, so every page under it must call requireOwner(path) in its
// own code or in a loader it imports from its own folder. The call guide is public on purpose.
const ROOT = join(__dirname, '(signed-in)');
const PUBLIC_PAGES = ['call-guide/page.tsx', 'guide/page.tsx'];

function pagesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pagesUnder(path);
    return entry.name === 'page.tsx' ? [path] : [];
  });
}

/** The page file and the sibling files it imports with `./name`. */
function loaderFiles(page: string): string[] {
  const source = readFileSync(page, 'utf8');
  const dir = join(page, '..');
  const siblings = [...source.matchAll(/from '\.\/([^']+)'/g)].flatMap(([, name]) =>
    ['.tsx', '.ts'].map((ext) => join(dir, name + ext)).filter(existsSync));
  return [page, ...siblings];
}

const pages = pagesUnder(ROOT).map((page) => relative(ROOT, page)).filter((page) => !PUBLIC_PAGES.includes(page));

describe('signed-in pages', () => {
  it('finds the pages', () => {
    expect(pages.length).toBeGreaterThanOrEqual(7);
  });

  it.each(pages)('%s asks requireOwner', (page) => {
    const sources = loaderFiles(join(ROOT, page)).map((file) => readFileSync(file, 'utf8'));
    expect(sources.some((source) => /\brequireOwner\(/.test(source))).toBe(true);
  });

  it('keeps the partner’s pages behind a share link and a summary link outside the app frame, and reads no session there', () => {
    for (const segment of ['s', 'r']) {
      const shared = join(__dirname, segment, '[token]');
      expect(existsSync(join(shared, 'page.tsx'))).toBe(true);
      expect(existsSync(join(ROOT, segment))).toBe(false);
      const sources = readdirSync(shared).filter((name) => name.endsWith('.tsx') && !name.includes('.test.'))
        .map((name) => readFileSync(join(shared, name), 'utf8'));
      for (const source of sources) {
        expect(source).not.toMatch(/\b(requireOwner|currentOwner|depsFor|companyFor)\(/);
        expect(source).not.toMatch(/\(signed-in\)|AppFrame/);
      }
    }
  });

  it('keeps a link holder’s pages outside the app frame: no owner’s session, and the link’s cookie checked on every MAP page', () => {
    const outside = (dir: string) => readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((name) => /\.tsx?$/.test(name) && !name.includes('.test.'))
      .map((name) => ({ name, source: readFileSync(join(dir, name), 'utf8') }));
    for (const segment of ['c', 'm', 'n']) {
      expect(existsSync(join(ROOT, segment))).toBe(false);
      for (const { source } of outside(join(__dirname, segment))) {
        expect(source).not.toMatch(/\b(requireOwner|currentOwner|depsFor|companyFor|asOwner)\(/);
        expect(source).not.toMatch(/\(signed-in\)|AppFrame/);
      }
    }
    for (const page of ['m/[mapId]/page.tsx', 'm/[mapId]/present/page.tsx']) {
      const sources = loaderFiles(join(__dirname, page)).map((file) => readFileSync(file, 'utf8')).join('\n');
      expect(sources).toMatch(/\b(currentLinkHolder|readForLink)\(/);
    }
    expect(readFileSync(join(__dirname, 'm/[mapId]/link-loader.tsx'), 'utf8')).toMatch(/\bcurrentLinkHolder\(/);
  });

  it('keeps an email’s pages to reading on GET: every write is behind the page’s one POST button (Review Focus 2)', () => {
    for (const [page, reads, writes] of [
      ['n/a/[token]/page.tsx', /\bviewAction\(/, /\bperformAction\(/],
      ['n/u/[token]/page.tsx', /\bunsubscribeView\(/, /\bunsubscribe\(/],
    ] as const) {
      const source = readFileSync(join(__dirname, page), 'utf8');
      expect(source).toMatch(reads);
      expect(source).not.toMatch(writes);
      // The write is a server action ('use server'): a POST, never run by opening the page.
      const action = readFileSync(join(__dirname, page, '..', 'actions.ts'), 'utf8');
      expect(action.startsWith("'use server';")).toBe(true);
      expect(action).toMatch(writes);
    }
  });

  it('keeps the call guide public and static', () => {
    expect(readFileSync(join(ROOT, 'call-guide/page.tsx'), 'utf8')).not.toMatch(/\brequireOwner\(/);
  });
});
