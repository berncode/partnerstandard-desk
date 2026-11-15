# Security

## Report a problem privately

If you find a security problem in PartnerStandard Desk, please tell us privately, not in a public issue: on GitHub, open this repository's **Security** tab and choose **Report a vulnerability**. Only PartnerStandard sees what you send.

Please include what you found, how to reproduce it, and which version or address it affects. We try to answer within five working days and to keep you posted while we fix it, and we credit you in the release notes unless you'd rather not be named. Reporting needs a GitHub account; if you have none, say so in a public issue without any detail, and we'll find another way.

## Which versions get fixes

| Edition | Fixes |
| --- | --- |
| Hosted (https://desk.partnerstandard.com) | Always the newest version: we fix it there first |
| On your own server | The newest release. Fixes come as small releases (1.4.2 to 1.4.3), announced in GitHub's security advisories. With `DESK_VERSION` set to `latest` (the default) or `1`, you get them with `docker compose pull` and `docker compose up -d` ([`docs/self-hosting.md`](docs/self-hosting.md), Updating) |

Older releases don't get fixes: update to the newest, which any older version can do in one step ([`docs/self-hosting.md`](docs/self-hosting.md), Updating).

## What we look after

- Tokens are encrypted at rest; sign-in links are stored hashed, tied to one person, and used once.
- An email's buttons never act on a visit: they open a page with one button to confirm.
- Agents act with the access of the person they act for, and decisions always wait for a person.
- Share, MAP and review links and API keys are stored hashed too.
- Hosted, the app reaches Google Drive with the `drive.file` access only: it sees the files it made, nothing else. Your work stays in your own Drive; our database holds accounts, encrypted tokens, file ids, a few names, links, events with ids only, locks, grants and the webhooks you set up.
- On your own server, nothing goes to PartnerStandard: your work stays in your database, and the only request the app makes of its own is the update check, which you can turn off.

## No promise

We fix security problems as soon as we reasonably can, but we promise no response time and no fix by a given date. On your own server, installing a fix is up to you. PartnerStandard Desk comes as is, without any warranty ([`LICENSE`](LICENSE), sections 15 and 16).
