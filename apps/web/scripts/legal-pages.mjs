// On Vercel, before the migrations and the build (apps/web/vercel.json): puts the operator's legal pages in place of
// the stand-ins (legal-pages-lib.mjs). Elsewhere it does nothing.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prepareLegalPages } from './legal-pages-lib.mjs';

const pages = fileURLToPath(new URL('../src/content/legal/pages/', import.meta.url));
try {
  const done = await prepareLegalPages({ env: process.env, write: (name, json) => writeFileSync(`${pages}${name}.json`, json) });
  console.log(done === 'fetched' ? 'Legal pages: the operator\'s own, fetched.' : 'Legal pages: the stand-ins (not a hosted build).');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
