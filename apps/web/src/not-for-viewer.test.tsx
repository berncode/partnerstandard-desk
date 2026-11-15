// @vitest-environment jsdom
// A page header's start button on a company server: hidden from a viewer, shown to everyone else (owner, 2026-11-14).
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

type Role = 'admin' | 'partnerManager' | 'viewer';
const state = vi.hoisted(() => ({ vercel: false, session: null as null | { member: { role: Role } | null } }));
vi.mock('@partner-desk/platform/env', () => ({ onVercel: () => state.vercel }));
vi.mock('@/server/runtime', () => ({ currentOwner: async () => state.session }));

const { NotForViewer, ViewerGate } = await import('./not-for-viewer');

const BUTTON = <button type="button">New market</button>;
const gated = async () => render(<>{await ViewerGate({ children: BUTTON })}</>);

describe('a start button in a page header', () => {
  it('is hidden from a company server’s viewer', async () => {
    state.session = { member: { role: 'viewer' } };
    await gated();
    expect(screen.queryByRole('button', { name: 'New market' })).toBeNull();
  });

  it('shows for an admin and a partner manager', async () => {
    for (const role of ['admin', 'partnerManager'] as const) {
      state.session = { member: { role } };
      const view = await gated();
      expect(screen.getByRole('button', { name: 'New market' })).toBeVisible();
      view.unmount();
    }
  });

  it('shows on hosted, where nobody is a member, and for someone signed out (the loader signs them in)', async () => {
    for (const session of [{ member: null }, null]) {
      state.session = session;
      const view = await gated();
      expect(screen.getByRole('button', { name: 'New market' })).toBeVisible();
      view.unmount();
    }
  });

  it('stays in a Vercel build’s static HTML, which is always hosted', () => {
    state.vercel = true;
    state.session = { member: { role: 'viewer' } };
    render(<NotForViewer>{BUTTON}</NotForViewer>);
    expect(screen.getByRole('button', { name: 'New market' })).toBeVisible();
    state.vercel = false;
  });
});
