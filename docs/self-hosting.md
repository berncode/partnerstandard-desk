# Running PartnerStandard Desk on your own server

PartnerStandard Desk runs as one Docker image. Everything your team writes stays in one database file on your server, in the `/data` folder. Nothing goes to PartnerStandard. Besides the emails it sends through your Resend account and the webhooks you set up, the only request the app makes is a check for a newer release on GitHub, at most once a day when an admin opens Settings, which you can turn off.

The files you need are in the `deploy` folder of this repository: `docker-compose.yml`, `.env.example`, `Caddyfile` and `litestream.yml`.

## Your server, your responsibility

You run this server, so it is yours to look after: keeping it secure and up to date, taking backups and checking that they restore, and handling the personal data in it lawfully. Under the GDPR your company is the controller of that data; PartnerStandard receives none of it and is not your processor. The software comes as is, without any warranty ([`LICENSE`](../LICENSE), sections 15 and 16), and PartnerStandard offers no support for installs. Questions and bug reports are welcome as GitHub issues, without a promise of an answer.

## What you need

- A Linux server with Docker and Docker Compose. 2 CPUs and 4 GB of memory are plenty for a team.
- A domain or subdomain for it, like `desk.example.com`, pointing at the server.
- A [Resend](https://resend.com) account with a verified sending domain: people sign in with a link sent by email.
- For backups: a bucket in S3-type storage (Hetzner Object Storage, Cloudflare R2, AWS S3, Backblaze B2, MinIO and others) and a key that may read and write it.

## Install

1. Copy the `deploy` folder to the server, for example to `/opt/partnerstandard-desk`.
2. In that folder, copy `.env.example` to `.env` and fill it in. Each setting is explained there. The ones you must set: `APP_URL`, `BETTER_AUTH_SECRET`, `ADMIN_EMAIL`, `RESEND_API_KEY`, `EMAIL_FROM`; for HTTPS `APP_DOMAIN`; and for backups the `LITESTREAM_` settings.
3. Start it, with HTTPS and backups:

   ```bash
   docker compose --profile https --profile backup up -d
   ```

4. Open `APP_URL` and sign in with the `ADMIN_EMAIL` address. That person is the first admin and invites everyone else from Settings, Members.

Without the profiles, `docker compose up -d` starts the app alone, on port 3000 of the server itself only.

### Try it on your own computer first

Set `APP_URL=http://localhost:3000` and `PD_TEST_AUTH=1` in `.env`, then run `docker compose up -d` and open http://localhost:3000. Test sign-in lets you in without an email. It works only with a local `APP_URL`, so a real install can never have it on.

## HTTPS

The `https` profile starts [Caddy](https://caddyserver.com) in front of the app. Caddy gets a certificate for `APP_DOMAIN` by itself and renews it. It needs:

- the domain's DNS pointing at the server;
- ports 80 and 443 open;
- `APP_URL` set to `https://` and the same domain.

### Behind your own proxy

Any proxy works (nginx, Traefik, a load balancer), with two rules:

- **Set `APP_URL`** to the address people use: every link the app makes starts with it.
- **Pass the original host on.** The app checks that a save comes from the address it was sent to. Caddy and Traefik do this by themselves. In nginx, add:

  ```nginx
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  ```

  Without it, pages open but every save fails.

If the proxy runs on another machine, set `APP_PORT` to the server's private address and port, like `APP_PORT=10.0.0.5:3000`, and let only the proxy reach it. Don't use plain `3000`: Docker opens such a port to the whole internet, past firewalls like ufw, and the app would answer plain http to anyone.

Run one app container only: the database is one file, and two containers on it would get in each other's way.

## Backups

You get two kinds.

**Litestream (the `backup` profile)** copies every save to your bucket, a few seconds behind. Set the `LITESTREAM_` settings in `.env`. Litestream logs `snapshot complete` once it has the first full copy. This is what you restore from when the server is lost.

**Start-up copies.** Before an update changes the database, the app copies it to `/data/backups/`, named after the last database change it had and the time, like `partnerstandard-desk-0016_workspace-2026-11-09T21-50-20-551Z.db`. It keeps the last 5. This is what you go back to when you want the version you had before an update.

If you prefer your own backups, stop the app (`docker compose stop app`) and copy the whole `data` volume (`docker volume inspect partnerstandard-desk_data` shows where it is on the server). Never copy only `partnerstandard-desk.db` while the app runs: the latest saves may still be in `partnerstandard-desk.db-wal` beside it.

## Restore from Litestream

On a new server, or after the `data` volume is lost:

1. Copy the `deploy` folder and your `.env` to the server.
2. Make the containers and the empty `data` volume without starting them, so the volume belongs to the app's user:

   ```bash
   docker compose --profile https --profile backup up --no-start
   ```

3. Restore the database from the bucket into the volume:

   ```bash
   docker compose run --rm --no-deps litestream restore -if-replica-exists /data/partnerstandard-desk.db
   ```

4. Start everything:

   ```bash
   docker compose --profile https --profile backup up -d
   ```

Everyone stays signed in: their sessions are in the restored database too.

To restore over a database that is still there but damaged, stop the app first (`docker compose stop app litestream`), move the database out of the volume, then do steps 3 and 4:

```bash
docker compose run --rm --no-deps --entrypoint sh app -c \
  'cd /data && mkdir -p damaged && mv partnerstandard-desk.db* .partnerstandard-desk.db-litestream damaged/ 2>/dev/null; true'
```

## When an update fails

The app stops before it serves and logs one line, `database_start_failed`, with the reason. Your database is exactly as it was: every change an update makes goes in at once or not at all. Compose starts the app again and again; each start fails the same way and makes no new copy, so your older copies stay.

1. Set `DESK_VERSION` in `.env` back to the version you ran before (the release before the one that failed, on GitHub, Releases), and start it: `docker compose up -d`.
2. Tell us what the log said (GitHub issues), so the next release fixes it.

## Go back to the version before an update

When an update worked but you want the version you had, its database must go back too: the older version refuses a database from a newer one (`database_newer_than_app`). The start-up copy is that database as it was before the update. **Everything saved since the update is lost.**

1. Stop the app and Litestream: `docker compose stop app litestream`.
2. Find the copy: the newest file in `/data/backups/` made at the time of the update (its name ends with the date and time, in UTC).

   ```bash
   docker compose run --rm --no-deps --entrypoint ls app -l /data/backups
   ```

3. Put it in place, in a throwaway container with the volume. The database you replace goes to `/data/replaced/`, and Litestream's own folder with it, so Litestream starts afresh:

   ```bash
   docker compose run --rm --no-deps --entrypoint sh app -c \
     'cd /data && mkdir -p replaced && mv partnerstandard-desk.db* .partnerstandard-desk.db-litestream replaced/ 2>/dev/null; cp backups/<the copy>.db partnerstandard-desk.db'
   ```

4. Give Litestream a new folder in the bucket, so the backups from after the update stay apart: set `LITESTREAM_PATH=partnerstandard-desk-2` (or the next number) in `.env`.
5. Set `DESK_VERSION` in `.env` to the version you ran before, and start everything: `docker compose --profile https --profile backup up -d`.

When you restore from Litestream later, use the newest `LITESTREAM_PATH`.

## Updating

```bash
docker compose --profile https --profile backup pull
docker compose --profile https --profile backup up -d
```

The app copies the database, runs what changed, and starts. Any older version updates straight to the newest. Going back to an older version needs its start-up copy (above). Admins see "Update available" in Settings when a new release is out. The app looks at most once a day, when an admin opens Settings. `UPDATE_CHECK=off` turns that off, and with it the version line in Settings.

`DESK_VERSION` chooses what you get: `latest`; `1` for every 1.x release; `1.4` to stay on 1.4 (1.4.1, 1.4.2 and so on); or `1.4.2` for exactly that release. Security fixes come in the newest release ([`SECURITY.md`](../SECURITY.md)).

## The scheduled job

Every 15 minutes the app runs its job by itself: MAP reminders and digests, webhooks still to send, and the hourly clean-up. Its log says `scheduler_ran` each time. To run it from your own scheduler instead, set `SCHEDULER=off` and `CRON_SECRET` (16 characters or more; make one with `openssl rand -base64 32`), and call `GET /api/cron/tick` with the header `Authorization: Bearer <CRON_SECRET>` every 15 minutes.

## Health check

`GET /api/health` answers `{"ok":true}` once the database answers, and 503 otherwise. The image's own health check calls it, so `docker ps` shows the app as healthy or not.

- The image's check asks `127.0.0.1` inside the container. If you set `HOSTNAME` to one address only, it can't reach the app there: leave `HOSTNAME` as it is.
- An update on a big database can take longer than the check's first minute. The app answers once it has finished; until then Docker may call it unhealthy. That is fine: it isn't restarted for it.

## Without Compose

```bash
docker run -d --name partnerstandard-desk -p 127.0.0.1:3000:3000 -v partnerstandard-desk-data:/data --env-file .env \
  ghcr.io/berncode/partnerstandard-desk:latest
```

## Build the image yourself

From the repository's root folder:

```bash
docker build -t partnerstandard-desk:local .
```

Then set `DESK_IMAGE=partnerstandard-desk` and `DESK_VERSION=local` in `.env`. Behind a proxy that inspects HTTPS, give the build its certificate as a secret: `--secret id=ca,src=/path/to/proxy-ca.crt`. The build downloads its packages and a font, so it needs the internet.

## What the image does

- Runs as a normal user (uid 1000) and writes only to `/data`.
- Reads every setting from the environment when it starts. No setting of yours and no secret is built into the image.
- On start: copies the database when an update waits, updates it, and only then serves. If an update fails, it stops.
