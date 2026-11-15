# Contributing to PartnerStandard Desk

Thank you for helping. This page says how the code is built, how to run it, and what we need before we can take a change.

## Before your first pull request: the contributor agreement

Your contribution goes into the project under the project's own licenses: code under AGPL 3.0 only, method content in `packages/method` under CC BY 4.0. On top of that, every outside contribution needs a signed contributor agreement, so PartnerStandard can also offer the project under other terms. You keep your copyright. The text is in [`CLA.md`](CLA.md).

CLA Assistant asks you to sign on your first pull request; you sign once, with your GitHub account. We can merge a pull request once it is signed.

## Where your pull request goes

Open your pull request against the **`preproduction`** branch, not `main`. We test changes on our staging server from `preproduction`, and bring them into `main` together after that.

## How we work

The order that worked for us. Skipping the design cost more than writing it.

1. **A design,** for anything bigger than a fix. Open an issue first and say what you want to change and why; we agree on the design there before code. For a small change, the design can go in the pull request.
2. **A build plan** in the pull request: small tasks, each with its tests.
3. **The build,** task by task, tests first.
4. **A review by someone who didn't build it,** for every task, and once more for the whole change.

[`AGENTS.md`](AGENTS.md) holds the rules every change follows, for people and AI coding agents alike: one way in (every read and write goes through the commands layer), plain words on screen with no em dashes, the method, not a CRM, and more. Read it before you write code.

Comments that cite "plan N", "task M" or "spec x.y" refer to the design notes of the first build, which are not published. Read them as history.

## Run it on your computer

You need Node 22 or newer and pnpm 11.

```bash
pnpm install
cp .env.example apps/web/.env.local     # works as it is, with test sign-in
pnpm --filter @partner-desk/platform db:migrate
pnpm --filter @partner-desk/web dev
```

Open http://localhost:3000 and sign in with test sign-in. To try the company server edition, set `EDITION=self-hosted`, `ADMIN_EMAIL` and a database of its own (`DATABASE_URL=file:../../.data/company.db`, which it migrates when it starts) in `apps/web/.env.local`; [`.env.example`](.env.example) explains every setting.

## The gate

Before every commit, everything you touched passes:

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm e2e
```

The e2e suite runs both editions (hosted on port 3800, a company server on 3801: both must be free) and needs Playwright's Chromium (`pnpm exec playwright install --with-deps chromium`). Never commit red, and never skip, disable or loosen a test to get green: fix the cause or ask.

## Where things are

| Folder | What it holds |
| --- | --- |
| `apps/web` | The Next.js app: screens, the MCP server, the REST API, emails, the scheduled job |
| `packages/core` | The rules and calculations, pure: no I/O |
| `packages/method` | The method content (CC BY 4.0) |
| `packages/copy` | The app's own words: screens, emails, the How it works guide |
| `packages/commands` | The one way in: every read and write, with its access check and event |
| `packages/storage` | The stores: Google Sheets and Drive (hosted), SQLite (a company server), in memory (tests) |
| `packages/platform` | Accounts, sign-in, the database tables (a company server's work files among them), settings |
| `deploy` | Docker Compose, Caddy, Litestream and the Coolify template (the image itself: `Dockerfile` at the root) |
| `scripts/release` | The checks a release runs on its image |
| `docs` | Running it on your own server, the file format and what is planned next |

## How we treat each other

Everyone who takes part follows our code of conduct, the Contributor Covenant: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Security

Please don't open a public issue for a security problem: [`SECURITY.md`](SECURITY.md) says how to tell us privately.

## Trademark

PartnerStandard™ and the PartnerStandard logo are trademarks of PartnerStandard. The licenses don't cover them. If you offer a changed version to others, give it your own name and logo. Only a build with `NEXT_PUBLIC_PD_BRAND=partnerstandard` shows the PartnerStandard logo (`apps/web/src/ui/brand.ts`).
