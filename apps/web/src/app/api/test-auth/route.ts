import { randomSuffix } from '@partner-desk/core';
import { safeNextPath, serverEnv, testSignInEnabled, testUserEmail } from '@partner-desk/platform';
import { connection, NextResponse } from 'next/server';
import { getAuth } from '@/server/runtime';

/** `expires` is epoch seconds (Better Auth's testUtils cookie builder). */
interface TestCookie { name: string; value: string; path?: string; expires?: number; httpOnly?: boolean; secure?: boolean }
interface TestHelpers {
  createUser(input: { email: string; name: string }): unknown;
  saveUser(user: unknown): Promise<{ id: string }>;
  getCookies(input: { userId: string; domain: string }): Promise<TestCookie[]>;
}

/**
 * Test sign-in: makes a throwaway user with no Google account (their files live in this server's memory) and signs
 * them in. Exists only with PD_TEST_AUTH=1, which the env check refuses on Vercel.
 */
export async function GET(request: Request) {
  await connection(); // request-time only: never prerendered at build
  if (!testSignInEnabled()) return new NextResponse('Not found', { status: 404 });
  const url = new URL(request.url);
  const name = (url.searchParams.get('name') ?? 'Test Owner').slice(0, 80) || 'Test Owner';
  const test = ((await getAuth().$context) as unknown as { test: TestHelpers }).test;
  const email = testUserEmail(randomSuffix(10));
  const user = await test.saveUser(test.createUser({ email, name }));
  // The app's public origin, not the request's: behind a proxy (or Next's own server) request.url may name another host.
  const appUrl = new URL(serverEnv().APP_URL);
  const response = NextResponse.redirect(new URL(safeNextPath(url.searchParams.get('next')), appUrl));
  for (const cookie of await test.getCookies({ userId: user.id, domain: appUrl.hostname })) {
    response.cookies.set(cookie.name, cookie.value, {
      path: cookie.path ?? '/', httpOnly: cookie.httpOnly ?? true, sameSite: 'lax', secure: cookie.secure ?? false,
      ...(cookie.expires ? { expires: new Date(cookie.expires * 1000) } : {}),
    });
  }
  return response;
}
