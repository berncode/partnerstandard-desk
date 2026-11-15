import { connection, NextResponse } from 'next/server';
import { unsubscribeDeps } from '@/server/runtime';
import { unsubscribe } from '@/server/unsubscribe';

/**
 * RFC 8058 one-click unsubscribe: mail providers POST `List-Unsubscribe=One-Click` to the List-Unsubscribe address.
 * There is deliberately no GET: Next answers 405, so a link scanner opening the address unsubscribes nobody.
 */
export async function POST(_request: Request, ctx: RouteContext<'/api/unsubscribe/[token]'>) {
  const { token } = await ctx.params;
  await connection();
  const result = await unsubscribe(unsubscribeDeps(), token);
  return new NextResponse(result.ok ? 'Unsubscribed' : 'This link does not work.', {
    status: result.ok ? 200 : 400,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
