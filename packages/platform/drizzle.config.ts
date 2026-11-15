import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

// Local development and tests use a libSQL file; hosted uses Turso (libsql://…).
// The Vercel Turso integration names its variables TURSO_*, or DATABASE_TURSO_* with the prefix "DATABASE";
// DATABASE_* wins when several are set. Keep in step with withTursoAliases in src/env.ts.
// The default file sits at <repo root>/.data/dev.db, whichever directory the script runs from.
const env = process.env;
const defaultUrl = `file:${fileURLToPath(new URL('../../.data/dev.db', import.meta.url))}`;
const url = env.DATABASE_URL || env.TURSO_DATABASE_URL || env.DATABASE_TURSO_DATABASE_URL || defaultUrl;
const authToken = env.DATABASE_AUTH_TOKEN || env.TURSO_AUTH_TOKEN || env.DATABASE_TURSO_AUTH_TOKEN;

export default url.startsWith('file:')
  ? defineConfig({ dialect: 'sqlite', schema: './src/db/schema.ts', out: './drizzle', dbCredentials: { url } })
  : defineConfig({
    dialect: 'turso', schema: './src/db/schema.ts', out: './drizzle',
    dbCredentials: { url, authToken },
  });
