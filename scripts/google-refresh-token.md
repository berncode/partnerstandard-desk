# Get a test refresh token for the live check

The live check (`pnpm test:live`) signs in to a real Google account. It needs a refresh token for a **test account**, not a real user's. Never commit the token. Nothing loads `.env.local` for the live check: export the three values in your shell, as the block in step 6 does, in the same shell you run `pnpm test:live` from.

You need the client id and client secret of a Google OAuth client: make an OAuth client of type "Web application" in a Google Cloud project of your own.

## Steps

1. Open the OAuth Playground: https://developers.google.com/oauthplayground
2. Click the gear icon (top right). Tick "Use your own OAuth credentials". Enter the client id and client secret.
3. On your client in Google Cloud (APIs & Services, Credentials), add `https://developers.google.com/oauthplayground` as an authorized redirect URI.
4. In the Playground, step 1: type the scope `https://www.googleapis.com/auth/drive.file` in the box ("Input your own scopes") and click Authorize APIs. Sign in with the **test account**.
5. Step 2: click "Exchange authorization code for tokens". Copy the **refresh token**.
6. Put the three values in your shell (not in a file that is committed):

```bash
export GOOGLE_LIVE_CLIENT_ID=...
export GOOGLE_LIVE_CLIENT_SECRET=...
export GOOGLE_LIVE_REFRESH_TOKEN=...
pnpm test:live
```

The run makes its own `PartnerStandard / PartnerStandard Desk` folders in the test account and adds a few dozen small spreadsheets. The discard checks move some of them to the trash. It prints the timings with `console.info`.

## Clean up

To clean up, trash the test folders in the test account's Drive.
