// The product is PartnerStandard Desk (owner, 2026-11-09). The old name stays only where an existing
// user's Drive work keeps it (owner, 2026-11-10): the earlier folder name the app still finds, the earlier file prefix a
// rename keeps, the earlier case column it still reads, and the tests and docs that describe them.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
/** The code and the files a person reads: docs for self-hosters, the deploy files, the image, the workflows. */
const SOURCES = [
  'apps/web/src', 'apps/web/e2e', 'packages/commands/src', 'packages/core/src', 'packages/method/src', 'packages/copy/src', 'packages/platform/src', 'packages/storage/src',
  'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CLA.md', 'AGENTS.md', 'CODE_OF_CONDUCT.md', 'docs/self-hosting.md', 'docs/file-format.md',
  'docs/open-items.md', 'packages/method/README.md', 'packages/copy/src', 'deploy', 'Dockerfile', '.github/workflows', '.env.example', 'scripts/release',
];

/** Each allowed use, only in the file that needs it. */
const ONLY_IN: Array<[RegExp, RegExp]> = [
  // The earlier folder name, and the comment that explains it.
  [/^packages\/copy\/src\/copy\.ts$/, /earlierFolderNames: \['Partner Desk'\]|earlierFilePrefixes: \['Partner Desk – '\]|the product was Partner Desk/g],
  // Renaming keeps an earlier prefix ("Partner Desk – ").
  [/^packages\/storage\/src\/google\/rename\.ts$/, /\("Partner Desk – "\)/g],
  [/^packages\/storage\/src\/google\/(case|program)-store\.test\.ts$/, /'Partner Desk – [^']*'/g],
  // The file format page names what accounts from before keep.
  [/^docs\/file-format\.md$/, /keeps its folder, PartnerStandard \/ Partner Desk;|`Partner Desk – …`|`Partner Desk type`/g],
  [/^packages\/storage\/src\/google\/folders\.ts$/, /the earlier "PartnerStandard \/ Partner Desk"|^ \* "PartnerStandard \/ Partner Desk"\. /g],
  // The earlier case column.
  [/^packages\/storage\/src\/sheet-codec\/case-records\.ts$/, /"Partner Desk type"|\['Partner Desk type'\]/g],
  // Tests that make an existing user's old folder or case file.
  [/^packages\/storage\/src\/google\/folders\.test\.ts$/, /'Partner Desk'|\(Partner Desk\)/g],
  [/^packages\/storage\/src\/sheet-codec\/case-layout\.test\.ts$/, /"Partner Desk type"|'Partner Desk type'/g],
  // A download keeps its Drive file's name, an old file's too; the header writes it in plain ASCII and encoded.
  [/^apps\/web\/src\/files\/xlsx\.test\.ts$/, /Partner Desk – |Partner Desk - Partners|Partner%20Desk/g],
  // The guide's checks that a company server never names the Drive folder, by either name.
  [/^packages\/copy\/src\/guide-editions\.test\.ts$|^apps\/web\/src\/app\/\(signed-in\)\/guide\/guide\.test\.tsx$/, /Partner Desk folder|PartnerStandard \\\/ Partner Desk/g],
];

function* files(path: string): Generator<string> {
  if (!existsSync(path)) return;
  if (!statSync(path).isDirectory()) {
    yield path;
    return;
  }
  for (const name of readdirSync(path)) {
    const inner = join(path, name);
    if (statSync(inner).isDirectory()) yield* files(inner);
    else if (/\.(ts|tsx|mjs|json|snap|md|ya?ml|sh|example)$|^Dockerfile$|^Caddyfile$/.test(name) || name === '.env.example') yield inner;
  }
}

/** Every line, in the code and the files people read, that still says Partner Desk where it isn't a Drive name. */
function oldNameLeft(): string[] {
  const left: string[] = [];
  for (const source of SOURCES) {
    for (const path of files(join(ROOT, source))) {
      const rel = path.slice(ROOT.length);
      if (rel === 'apps/web/src/product-name.test.ts') continue;
      const extra = ONLY_IN.filter(([where]) => where.test(rel)).map(([, what]) => what);
      readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
        const rest = extra.reduce((text, allowed) => text.replace(allowed, ''), line);
        if (rest.includes('Partner Desk')) left.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
  }
  return left;
}

describe('the product name', () => {
  it('says PartnerStandard Desk everywhere, and Partner Desk only for the Drive names it still finds things by', () => {
    expect(oldNameLeft()).toEqual([]);
  });

  it('would catch the old name everywhere but the lines that keep an existing user’s Drive work working', () => {
    const left = (path: string, line: string) => ONLY_IN.filter(([where]) => where.test(path)).map(([, what]) => what)
      .reduce((text, allowed) => text.replace(allowed, ''), line).includes('Partner Desk');
    expect(left('packages/copy/src/copy.ts', "  APP_NAME: 'Partner Desk',")).toBe(true);
    expect(left('packages/copy/src/copy.ts', "    partnersFile: 'Partner Desk – Partners',")).toBe(true);
    expect(left('packages/copy/src/copy.ts', "    earlierFolderNames: ['Partner Desk'],")).toBe(false);
    expect(left('packages/copy/src/copy.ts', "    folderPath: ['PartnerStandard', 'Partner Desk'],")).toBe(true);
    expect(left('packages/copy/src/guide.ts', "    earlierFolderNames: ['Partner Desk'],")).toBe(true);
    expect(left('packages/storage/src/sheet-codec/case-records.ts', "  'PartnerStandard Desk type': ['Partner Desk type'] };")).toBe(false);
  });
});
