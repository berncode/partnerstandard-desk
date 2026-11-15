// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const server = vi.hoisted(() => ({ mapChange: vi.fn(), proposalAccept: vi.fn(), proposalReject: vi.fn() }));
vi.mock('@/app/(signed-in)/actions/maps', () => ({ mapChange: server.mapChange }));
vi.mock('@/app/(signed-in)/actions/proposals', () => ({ proposalAccept: server.proposalAccept, proposalReject: server.proposalReject }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const toasts = vi.hoisted(() => ({ undo: vi.fn(), info: vi.fn(), error: vi.fn(), dismissUndo: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/' }));
vi.mock('@/maps/notify', () => ({ sonnerNotify: toasts }));

const { SampleWeekSection } = await import('./sample-week-section');

describe('SampleWeekSection', () => {
  it('on the server: its words and an empty box, no dates (the page is built once, opened any day)', () => {
    const html = renderToString(<SampleWeekSection />);
    expect(html).toContain('Your week in PartnerStandard Desk');
    expect(html).not.toContain('Brightwater');
  });

  it('in the browser: the sidebar with This week current and every card filled', () => {
    render(<SampleWeekSection />);
    const region = screen.getByRole('region', { name: 'Your week in PartnerStandard Desk' });
    expect(within(region).getByText('Brookvale Software')).toBeInTheDocument();
    expect(within(region).getByTitle('This week')).toHaveAttribute('aria-current', 'page');
    expect(within(region).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Your week in PartnerStandard Desk', 'Proposals', 'Business reviews coming up', 'Partnerships that need you', 'Activities due', 'Recruitment waiting',
    ]);
    expect(region.querySelector('[href]')).toBeNull();
  });

  it('Mark done and Accept change the tab only', async () => {
    const user = userEvent.setup();
    render(<SampleWeekSection />);
    await user.click(screen.getByRole('button', { name: 'Mark done: Plan the joint webinar' }));
    await waitFor(() => expect(screen.queryByText('Plan the joint webinar')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('Accepted')).toBeInTheDocument();
    expect(server.mapChange).not.toHaveBeenCalled();
    expect(server.proposalAccept).not.toHaveBeenCalled();
  });

  it('Undo brings the line back without reading the page again from the server', async () => {
    const user = userEvent.setup();
    render(<SampleWeekSection />);
    await user.click(screen.getByRole('button', { name: 'Mark done: Send the price list' }));
    await waitFor(() => expect(toasts.undo).toHaveBeenCalled());
    await toasts.undo.mock.calls.at(-1)![1]();
    expect(await screen.findByText('Send the price list')).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(server.mapChange).not.toHaveBeenCalled();
  });
});
