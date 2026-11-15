// Each package says its license (plan 18, task 2; spec 2026-11-07 §13.3): the method content is CC BY 4.0, in
// packages/method alone, and builds on nothing of the app's; everything else is code under AGPL 3.0 only.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const packageJson = (dir: string) => JSON.parse(read(`${dir}/package.json`)) as { name: string; license: string };
const workspaces = ['apps', 'packages'].flatMap((top) => readdirSync(join(ROOT, top)).map((name) => `${top}/${name}`))
  .filter((dir) => { try { return statSync(join(ROOT, dir, 'package.json')).isFile(); } catch { return false; } });

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(join(ROOT, dir))) {
    const path = `${dir}/${name}`;
    if (statSync(join(ROOT, path)).isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(name)) yield path;
  }
}

describe('licenses', () => {
  it('the method content is CC BY 4.0, with the license’s text and how to credit PartnerStandard', () => {
    expect(packageJson('packages/method').license).toBe('CC-BY-4.0');
    expect(read('packages/method/LICENSE').startsWith('Creative Commons Attribution 4.0 International')).toBe(true);
    expect(read('packages/method/README.md')).toContain('Method content by PartnerStandard (https://pro.partnerstandard.com), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).');
  });

  it('everything else is AGPL 3.0 only', () => {
    expect(packageJson('.').license).toBe('AGPL-3.0-only');
    for (const dir of workspaces.filter((d) => d !== 'packages/method')) expect(packageJson(dir).license, dir).toBe('AGPL-3.0-only');
    expect(workspaces).toContain('packages/copy');
  });

  it('the method content imports nothing outside its own package', () => {
    for (const path of sources('packages/method/src')) {
      for (const [, from = ''] of read(path).matchAll(/(?:from|import|import\()\s*['"]([^'"]+)['"]/g)) {
        const own = from.startsWith('./') || (from.startsWith('../') && !from.startsWith('../../'));
        expect(own || from === 'vitest', `${path} imports ${from}`).toBe(true);
      }
    }
  });
});
