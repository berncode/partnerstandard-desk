#!/usr/bin/env node
// Writes THIRD_PARTY_LICENSES: the licenses of every open source package a production install holds, for the image
// (Dockerfile). Usage, from the repository's root, after `pnpm install`:
//   node scripts/release/third-party-licenses.mjs THIRD_PARTY_LICENSES
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOTICE_FILE, noticesFrom } from './third-party-licenses-lib.mjs';

const out = process.argv[2];
if (!out) {
  console.error('Usage: node scripts/release/third-party-licenses.mjs <file to write>');
  process.exit(2);
}
const listing = JSON.parse(execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
// Next.js carries about 150 packages inside its own (next/dist/compiled), which pnpm doesn't list: each with its
// license file is added, under the license its package.json names.
const next = Object.values(listing).flat().find((pkg) => pkg.name === 'next');
for (const root of next?.paths ?? []) {
  const compiled = join(root, 'dist', 'compiled');
  if (!existsSync(compiled)) continue;
  const folders = readdirSync(compiled, { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const folder of folders.flatMap((e) => (e.name.startsWith('@') ? readdirSync(join(compiled, e.name)).map((n) => `${e.name}/${n}`) : [e.name]))) {
    const dir = join(compiled, folder);
    if (!existsSync(dir) || !readdirSync(dir).some((name) => NOTICE_FILE.test(name))) continue;
    let license = 'see its text below';
    try {
      const named = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).license;
      if (typeof named === 'string') license = named;
    } catch { /* no package.json beside it: the license text says it */ }
    (listing[license] ??= []).push({ name: `${folder} (inside next)`, versions: [], paths: [dir], license });
  }
}
const text = noticesFrom(listing, {
  // Files only: a folder called "license" is not a notice.
  list: (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name) : []),
  read: (path) => readFileSync(path, 'utf8'),
});
const count = Number(/contains (\d+) packages/.exec(text)?.[1] ?? 0);
if (count < 50) {
  console.error(`Only ${count} packages found: the install looks incomplete, so nothing was written.`);
  process.exit(1);
}
writeFileSync(out, text);
console.log(`${out}: ${count} packages.`);
