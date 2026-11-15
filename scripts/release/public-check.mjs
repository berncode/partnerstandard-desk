#!/usr/bin/env node
// What must not go public (plan 18, task 5; spec 2026-11-07 §13.2). Run it on the cleaned branch before the public
// repository's first commit. It reads every file `git add -A` would add, from the
// repository's root, and lists every real email address, key or token, every match of your own private patterns, and the
// old private list of owner steps.
//
//   node scripts/release/public-check.mjs --private ~/desk-private.txt --allow ~/desk-public-ok.txt
//
// Both files live outside the repository, one regular expression per line: writing your private patterns into it would
// publish them. The allow file names what may stay public after all; each line is tried on the finding as printed
// (`path:line: what: match`), so it can name an address, a file or a line. Exits 1 when it finds anything.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findingsIn, parsePatterns } from './public-check-lib.mjs';

function fail(message) {
  console.error(message);
  process.exit(2);
}

const args = process.argv.slice(2);
function patternsIn(flag) {
  const at = args.indexOf(flag);
  if (at < 0) return [];
  const file = args[at + 1];
  if (!file || file.startsWith('--')) fail(`${flag} needs a file`);
  if (!existsSync(file)) fail(`${flag}: no file at ${file}`);
  try {
    return parsePatterns(readFileSync(file, 'utf8'), file);
  } catch (error) {
    fail(error.message);
  }
}
const privatePatterns = patternsIn('--private');
const allowed = patternsIn('--allow');

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
// What `git add -A` would add: tracked files and new ones, without what .gitignore leaves out.
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(Boolean)
  // Files only: git lists another repository inside this one (a worktree's folder) as one entry, which is a folder.
  .filter((file) => existsSync(join(root, file)) && statSync(join(root, file)).isFile());
if (files.length === 0) fail('No files to check: run it inside the repository, with its files added or not ignored.');

const found = files.flatMap((file) => findingsIn(file, readFileSync(join(root, file), 'utf8'), { privatePatterns, allowed }));
for (const line of found) console.log(line);
console.log(found.length ? `\n${found.length} to clean before the repository goes public.` : `Nothing found in ${files.length} files.`);
process.exit(found.length ? 1 : 0);
