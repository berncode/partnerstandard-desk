# Instructions for coding agents

PartnerStandard Desk is a PartnerStandard product: one workspace where a partner manager runs each partner from the first idea to exit. It grows out of four of PartnerStandard's own apps (MAP, Recruitment, Business Case, Program Designer). The owner is PartnerStandard. These rules hold for every agent and every session in this repo.

## Before you write anything

1. Read `README.md` and `CONTRIBUTING.md`, then everything under `docs/`.
2. For partnership method questions (stages, 4C, MAP, QBR, KPIs, partner types), use the PartnerStandard Knowledge Hub MCP server if you have access and it is connected, and cite the `pro.partnerstandard.com` page. When the hub and the code disagree, don't pick: say so in the issue or pull request and ask the owner.

## How we work

This is the order that works here. Skipping the design cost more than writing it.

1. **Design** in an issue, or in the pull request for a small change. The owner approves it before any build plan.
2. **Build plan** in the pull request: small tasks, each with its tests and the gate.
3. **Build**, task by task. **Every task is reviewed by someone who didn't build it** (another agent or session). A final review of the whole branch follows; it catches what crosses tasks.
4. **Staging**, then **production**, both by the owner.

More rules:

- **Keep the guide true.** A design that changes a flow lists the sections of the in-app guide ("How it works") it touches, and its plan has a task to update them (decided 2026-11-01).
- **Mark your own decisions.** Anything the owner didn't decide is a `[builder's call]`. List each one in the pull request with what it costs if it was wrong.
- **Try the real service before building on it.** A 30-minute live check against real Google beats reading the docs. Write down what you learned in the pull request.
- **The owner reviews all copy** a user reads before launch. List new copy in the pull request.
- **Steps only the owner can do** (Vercel, Turso, Google Cloud, domains, legal) go into the pull request as a numbered checklist, with the exact values to enter.

## Decisions that are the owner's

Never decide these alone; ask, and record the answer in the issue or pull request:

- stage names, the 4C letters, partner types and any other method wording;
- the Partner record's fields;
- licenses, prices, the product name and domains;
- anything that touches production, live data, users' files or the shared Google sign-in;
- removing a feature the app has.

## Product rules

- **Your work stays yours.** Hosted, the work lives in the user's Google Drive and our database holds only accounts, encrypted tokens, file ids, a few display names, links, events (ids only), locks and grants. Never plan, case or market content in our database or in logs. Self-hosted, everything lives in the company's database.
- **Method, not a CRM.** Every field earns its place. No deal registration desk, MDF claims, commission payouts or partner content library: those stay in the CRM, and PartnerStandard Desk links to it.
- **People decide.** The tool and agents advise. Stage moves, closing a partner, signing and exit need a person.
- **No candidates.** Every company is a partner from the day you add it; only its stage and step change (decided 2026-10-28). Don't write "candidate" in screens, docs or plans, except when describing PartnerStandard's Recruitment app.
- **Both sides.** Plans and cases show what the partner gets and what we get.
- **One page.** Alignment, not paperwork.
- **Plain words on screen.** Short sentences, everyday words, no jargon a user reads (no CAC, ARR or MDF), and **no em dashes** in any text a user reads. Write these docs the same way.
- **Screens:** shadcn/ui themed with the PartnerStandard look (Inter Tight, green `#29ba74`, light and dark), the shadcn Sidebar as the app frame. The screens already here are the reference for every new one: copy their components and look, don't redraw them (decided 2026-10-28). Since 2026-11-01 the screens are dense, in the style of the Cloudflare dashboard: small titles, tight cards, lists as rows, labels beside their values.
- **Out:** Notion (decided 2026-10-27), Microsoft sign-in and storage (until a customer needs it), and any AI inside the product that decides for the user.

## Architecture rules

- **One way in.** Every read and write goes through the commands layer: a zod schema for the input, an access check (`can(actor, command)`), a conflict check, and for every change an event with ids only (a read records none: decided 2026-11-14). Screens (server actions), the MCP server, the REST API, email buttons, jobs and connectors all call commands. Nothing else touches storage.
- **Actors:** owner, team member (self-hosted), partner contact (magic link, own side only), agent (acting for a person, with that person's access). Every write records its actor, for example "Desk Agent for Ruth".
- **Agent levels:** read (always allowed), change (allowed by the grant), propose (waits for a person), no sign-in (pure calculations). Decisions are always proposals. Agent imports go through the same preview people use.
- **Domain packages are pure:** no I/O, no Next.js, no storage. Rules, calculations and validation only, test-first.
- **Storage sits behind one contract.** Each adapter (Google Sheets and Drive, SQLite, later Postgres, and an in-memory fake) passes the same contract test suite.
- **The Drive folder is PartnerStandard Desk's database** (decided 2026-11-03). People don't edit, move or delete its files by hand, except an admin who knows what they are doing, and PartnerStandard Desk says so on screen. The code still reads tolerantly, re-reads before every save, finds rows by id, never overwrites a row it couldn't read, and keeps a format version in each file (`_meta`), so a stray hand edit or a second browser tab never loses data. Build no features for hand edits.
- **Deleting means trash** in the user's Drive, never deleted for good.
- **Never revoke the shared Google grant.** All PartnerStandard tools share one Google sign-in; a revoke signs the user out of every tool. Disconnect and Delete account remove only our own records.
- **Emails never act on a link visit (GET).** A link opens a confirmation page with one button (POST). Link scanners open every link.
- **Google:** `drive.file` scope only. About 60 reads a minute per user: use the Partners index, the read cache and one call budget per user.
- **Self-hosted:** all settings from environment variables, a health check route, data only in `/data`, runs as a normal user, works behind any proxy, one app instance while the database is SQLite. Migrations run on start, after a copy of the database file.
- **Security:** tokens encrypted at rest, magic links hashed and tied to one person, test sign-in refused on every Vercel deployment, never a secret in the repo (`.env.example` only).

## Stack

- Node 22 or newer, pnpm 11 (workspaces), TypeScript
- Next.js 16 (App Router, cache components), React 19, Tailwind 4, shadcn/ui (on Radix, added with the shadcn command line tool), lucide icons, sonner toasts
- Better Auth 1.7 with the Drizzle adapter
- Drizzle ORM 0.45 on libSQL: Turso when hosted, a SQLite file when self-hosted
- zod 4, Vitest, Testing Library, Playwright
- Resend for email, in both editions (no SMTP for now: owner, 2026-11-08)
- Hosted on Vercel, functions in Dublin (`dub1`); self-hosted as one Docker image (Next.js standalone output)

### This is NOT the Next.js you know

Next.js 16 has breaking changes: APIs, conventions and file structure may differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code, and heed deprecation notices.

## The gate

The full gate is:

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm e2e
```

GitHub runs it on every push to `preproduction` and on every pull request into it (`.github/workflows/gate.yml`); `main` takes only a commit whose gate and image checks are green. Before you push, run the tests for what you touched (for example `pnpm exec vitest run <files>`, `pnpm typecheck`, `pnpm lint`, and the e2e specs of the screens you changed). Run the whole gate locally when a change reaches across the app.

Never push red. Never skip, disable or loosen a test to get green; fix the cause or ask.

## License

- The code is under **AGPL-3.0-only** (`LICENSE`). Set `"license": "AGPL-3.0-only"` in every `package.json`, except `packages/method`'s, which says `"CC-BY-4.0"`.
- **Dependencies must fit AGPL 3.0:** MIT, ISC, BSD, Apache-2.0, MPL-2.0, LGPL and GPL-3.0 are fine. Ask the owner before adding anything else (for example proprietary, SSPL, Commons Clause or GPL-2.0-only).
- **Never copy code** from a source whose license doesn't fit, including snippets from the web without a clear license.
- **Not covered by the code license:** the method content (tips, starters, examples, call guide, 4C texts, prompts), which is under CC BY 4.0 (decided 2026-11-07), and the PartnerStandard name and logo. Keep method content in its own package (`packages/method`) so it can carry its own license; the app's own words (screens, emails, the guide) are code, mostly in `packages/copy`. The method package imports nothing of the app's.
- **Outside contributions** need the signed contributor agreement in `CLA.md`; CLA Assistant asks on the first pull request.

## Git

- Work on a branch per task or plan and open a pull request for the owner. `main` holds what the owner approved.
- Small commits with plain messages in the repo's style (`feat(scope): …`, `fix: …`, `docs: …`).
