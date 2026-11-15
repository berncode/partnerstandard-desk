import { testSignInEnabled } from '@partner-desk/platform';
import { connection, NextResponse } from 'next/server';
import { testOutbox } from '@/server/runtime';

/**
 * Test sign-in only (e2e): the emails this server kept instead of sending, to one address with `?to=`. Exists only
 * with PD_TEST_AUTH=1, which the env check refuses on Vercel.
 */
export async function GET(request: Request) {
  await connection();
  if (!testSignInEnabled()) return new NextResponse('Not found', { status: 404 });
  const to = new URL(request.url).searchParams.get('to')?.trim().toLowerCase();
  const messages = testOutbox().outbox.filter((m) => !to || m.to.trim().toLowerCase() === to);
  return NextResponse.json({ messages }, { headers: { 'Cache-Control': 'no-store' } });
}
