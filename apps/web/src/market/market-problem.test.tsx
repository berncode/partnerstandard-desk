// @vitest-environment jsdom
// A market whose file can't be read: Archive is a change, so a company server's viewer gets no button (owner, 2026-11-14).
import { COPY } from '@partner-desk/copy';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/app/(signed-in)/actions/markets', () => ({ marketArchive: vi.fn() }));
vi.mock('@/app/sign-in/actions', () => ({ continueWithGoogle: vi.fn() }));

const { MarketProblem } = await import('./market-problem');
const { StorageProvider } = await import('@/storage-context');

const gone = { error: 'file_not_found', message: COPY.FILE_GONE };

describe('MarketProblem', () => {
  it('offers an admin or a partner manager Archive, and a viewer only the way back to the markets', () => {
    const view = render(<StorageProvider storage="database"><MarketProblem marketId="m_1" failure={gone} storage="database" /></StorageProvider>);
    expect(screen.getByRole('button', { name: COPY.ARCHIVE })).toBeVisible();
    view.unmount();
    render(<StorageProvider storage="database" viewer><MarketProblem marketId="m_1" failure={gone} storage="database" /></StorageProvider>);
    expect(screen.queryByRole('button', { name: COPY.ARCHIVE })).toBeNull();
    expect(screen.getByRole('link', { name: COPY.BACK_TO_MARKETS })).toHaveAttribute('href', '/markets');
  });
});
