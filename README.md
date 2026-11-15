# PartnerStandard Desk

One workspace where a partner manager runs each partner from the first idea to exit: the markets you look for partners in, recruitment with the 4C questions, programs, business cases that show both sides, the Mutual Action Plan you share with the partner, and the weekly view and reviews once the partnership runs. Every step works on screen or through your own AI agent (MCP, a REST API and webhooks).

It follows the PartnerStandard method (https://pro.partnerstandard.com). It is a method, not a CRM: deals, payouts and partner content stay in your CRM.

> [!NOTE]
> **The Community Edition is the version you run yourself.** You install, update, back up and secure it, and there is no support for it. To try PartnerStandard Desk first, sign in at https://desk.partnerstandard.com. To learn more, write to hello@partnerstandard.com.

## Two ways to use it

| | Hosted | On your own server |
| --- | --- | --- |
| Where | https://desk.partnerstandard.com | Your server, from one Docker image |
| Who it suits | One partner manager who wants to start now | Teams and companies that want their work on their own servers |
| People | One person per account | A team: admins, partner managers and viewers, invited by email |
| Sign-in | Google | A link by email |
| Where the work lives | Your own Google Drive, as spreadsheets | Your company's database (SQLite), in one folder |
| Agents (MCP, API, webhooks) | Yes | Yes |

## Run it on your own server

You need a Linux server with Docker; a domain whose DNS points at it, with ports 80 and 443 open; a [Resend](https://resend.com) account for the emails it sends (sign-in links, invites, MAP emails); and, for backups, a bucket in S3-type storage (Hetzner, Cloudflare R2, AWS and others).

```bash
git clone https://github.com/berncode/partnerstandard-desk.git
cd partnerstandard-desk/deploy
cp .env.example .env          # fill it in: each setting is explained there
docker compose --profile https --profile backup up -d
```

Then open your address and sign in with the `ADMIN_EMAIL` you set. [`docs/self-hosting.md`](docs/self-hosting.md) covers it all: settings, HTTPS, backups, restoring, updates and running behind your own proxy.

## Documentation

- [`docs/self-hosting.md`](docs/self-hosting.md): running it on your own server.
- [`docs/file-format.md`](docs/file-format.md): the workbooks your work is kept in, so any tool can read them.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): how the code is built and how to help.
- [`SECURITY.md`](SECURITY.md): how to report a security problem.
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md): how we treat each other.

## License

Copyright (C) 2026 Bernhard Friedrichs (PartnerStandard).

PartnerStandard Desk is free software under the GNU Affero General Public License, version 3 only (`AGPL-3.0-only`). See [`LICENSE`](LICENSE).

- Anyone may use, change and self-host it. Anyone who offers a changed version to others over a network must publish their changes under the same license.
- The method content in PartnerStandard Desk (the stages, partner types, 4C and CASO texts, the call guide, tips, the MAP's starters, examples, guided steps and sample plan, the example market, the program catalog (benefits, Preferred requirements, the partner types' descriptions, who invoices, payment models), the prompts and the links to the guides) is in `packages/method`, under Creative Commons Attribution 4.0 (CC BY 4.0, [`packages/method/LICENSE`](packages/method/LICENSE)): anyone may use it, also commercially, and must credit PartnerStandard as [`packages/method/README.md`](packages/method/README.md) says. The app's own words (screens, emails, the How it works guide, mostly in `packages/copy`) are code, under AGPL 3.0 only.
- Contributions need a signed contributor agreement, so PartnerStandard can also offer the project under other terms: [`CLA.md`](CLA.md). [`CONTRIBUTING.md`](CONTRIBUTING.md) says how.

## No warranty

PartnerStandard Desk is provided as is, without any warranty, and PartnerStandard is not liable for damage from using it, as far as the law allows ([`LICENSE`](LICENSE), sections 15 and 16). If you run it on your own server, you do so at your own risk: you are responsible for the server, its security and updates, your backups, and the data you keep in it, including what the GDPR and other laws ask of you. PartnerStandard receives none of that data and gives no support for your server.

## The PartnerStandard name and logo

PartnerStandard™ and the PartnerStandard logo are trademarks of PartnerStandard. The licenses above don't cover them. If you offer a changed version to others, give it your own name and logo.
