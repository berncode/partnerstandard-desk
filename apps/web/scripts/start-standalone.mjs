// Starts the standalone server the way self-hosting ships it.
// Run after `next build`. Next does not copy static files into the standalone folder.
import { spawn } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
const out = `${web}.next/standalone/apps/web`;

cpSync(`${web}.next/static`, `${out}/.next/static`, { recursive: true });
if (existsSync(`${web}public`)) cpSync(`${web}public`, `${out}/public`, { recursive: true });

const child = spawn(process.execPath, [`${out}/server.js`], {
  stdio: 'inherit',
  env: { ...process.env, PORT: process.env.PORT ?? '3000', HOSTNAME: process.env.HOSTNAME ?? '127.0.0.1' },
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
