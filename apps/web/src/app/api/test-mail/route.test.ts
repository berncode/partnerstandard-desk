import { describe, expect, it, vi } from 'vitest';
import { MemoryMailer } from '@/server/mailer';

const state = vi.hoisted(() => ({ test: true, outbox: null as unknown as MemoryMailer }));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {} }));
vi.mock('@partner-desk/platform', () => ({ testSignInEnabled: () => state.test }));
vi.mock('@/server/runtime', () => ({ testOutbox: () => state.outbox }));

const { GET } = await import('./route');

describe('GET /api/test-mail', () => {
  it('lists the kept emails, to one address when asked, only with test sign-in', async () => {
    state.outbox = new MemoryMailer();
    await state.outbox.send({ to: 'lena@example.com', subject: 'A', html: '<p>A</p>', text: 'A' });
    await state.outbox.send({ to: 'ben@example.com', subject: 'B', html: '<p>B</p>', text: 'B' });
    const all = await (await GET(new Request('https://desk.test/api/test-mail'))).json();
    expect(all.messages.map((m: { subject: string }) => m.subject)).toEqual(['A', 'B']);
    const lena = await (await GET(new Request('https://desk.test/api/test-mail?to=Lena@Example.com'))).json();
    expect(lena.messages.map((m: { subject: string }) => m.subject)).toEqual(['A']);
    state.test = false;
    expect((await GET(new Request('https://desk.test/api/test-mail'))).status).toBe(404);
  });
});
