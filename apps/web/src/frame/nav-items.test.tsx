// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ pathname: '/partners' }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));

import { noteAnswered } from '@/proposals/waiting-store';
import { isCurrent, NavLinks, ProposalsWaiting } from './nav-items';

describe('isCurrent', () => {
  it('matches a page and the pages under it, not a lookalike', () => {
    expect(isCurrent('/markets', '/markets')).toBe(true);
    expect(isCurrent('/markets/abc', '/markets')).toBe(true);
    expect(isCurrent('/marketsplace', '/markets')).toBe(false);
  });
});

describe('NavLinks', () => {
  it('lists This week, Ecosystem, Operations, Guides, then Company facts and Settings, in that order', () => {
    render(<NavLinks />);
    const nav = screen.getByRole('navigation', { name: 'Main menu' });
    expect(Array.from(nav.querySelectorAll('a')).map((a) => [a.getAttribute('aria-label'), a.getAttribute('href')])).toEqual([
      ['This week', '/this-week'],
      ['Partners', '/partners'],
      ['Markets', '/markets'],
      ['Programs', '/programs'],
      ['Business cases', '/business-cases'],
      ['Mutual Action Plans', '/plans'],
      ['Business reviews', '/reviews'],
      ['How it works', '/guide'],
      ['Call guide', '/call-guide'],
      ['Company facts', '/company-facts'],
      ['Settings', '/settings'],
    ]);
    expect(nav).toHaveTextContent('Ecosystem');
    expect(nav).toHaveTextContent('Operations');
    expect(nav).toHaveTextContent('Guides');
    expect(nav).toHaveTextContent('Business cases');
    // No heading only repeats its one link any more.
    expect(nav).not.toHaveTextContent(/Recruitment|Run partners/);
  });

  it('marks the page you are on', () => {
    mocks.pathname = '/markets/abc';
    render(<NavLinks />);
    expect(screen.getByRole('link', { name: 'Markets' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Partners' })).not.toHaveAttribute('aria-current');
  });

  it('marks Programs on the overview, on Add a program and on any program’s page', () => {
    for (const path of ['/programs', '/programs/new', '/programs/pg_bbbbbbbbbb/money']) {
      mocks.pathname = path;
      const { unmount } = render(<NavLinks />);
      expect(screen.getByRole('link', { name: 'Programs' })).toHaveAttribute('aria-current', 'page');
      unmount();
    }
  });

  it('marks Business cases on the page, on New case and on any case', () => {
    for (const path of ['/business-cases', '/business-cases/new', '/business-cases/case_aaaaaaaaaaaa/offer']) {
      mocks.pathname = path;
      const { unmount } = render(<NavLinks />);
      expect(screen.getByRole('link', { name: 'Business cases' })).toHaveAttribute('aria-current', 'page');
      unmount();
    }
  });

  it('marks Mutual Action Plans on the page, on a MAP and on its guided steps', () => {
    for (const path of ['/plans', '/plans/map_aaaaaaaaaa', '/plans/map_aaaaaaaaaa/start']) {
      mocks.pathname = path;
      const { unmount } = render(<NavLinks />);
      expect(screen.getByRole('link', { name: 'Mutual Action Plans' })).toHaveAttribute('aria-current', 'page');
      unmount();
    }
  });

  it('the sidebar shows 3 beside This week, and nothing at 0', () => {
    mocks.pathname = '/partners';
    const { unmount } = render(<NavLinks proposalsWaiting={<ProposalsWaiting count={3} />} />);
    const week = screen.getByRole('link', { name: 'This week' });
    expect(within(week).getByText('3')).toBeVisible();
    expect(week).toHaveAccessibleDescription('3 proposals waiting');
    // Only beside This week.
    expect(screen.getByRole('link', { name: 'Partners' })).toHaveTextContent(/^Partners$/);
    unmount();

    render(<NavLinks proposalsWaiting={<ProposalsWaiting count={0} />} />);
    expect(screen.getByRole('link', { name: 'This week' })).toHaveTextContent(/^This week$/);
    expect(screen.getByRole('link', { name: 'This week' })).not.toHaveAccessibleDescription(/waiting/);
  });

  it('says 1 proposal waiting for one', () => {
    render(<NavLinks proposalsWaiting={<ProposalsWaiting count={1} />} />);
    expect(screen.getByRole('link', { name: 'This week' })).toHaveAccessibleDescription('1 proposal waiting');
  });

  it('an answer keeps the count down when the phone menu mounts the count again, until a new count is read', () => {
    const first = render(<ProposalsWaiting count={3} readAt="2026-11-04T09:00:00.000Z" />);
    act(() => noteAnswered('prp_one'));
    expect(first.container).toHaveTextContent(/^22 proposals waiting$/);
    // The phone menu's panel mounts its own count each time it opens: the answer still counts.
    const again = render(<ProposalsWaiting count={3} readAt="2026-11-04T09:00:00.000Z" />);
    expect(again.container).toHaveTextContent(/^22 proposals waiting$/);
    first.unmount();
    again.unmount();
    // A new read from the server holds the answer already.
    const fresh = render(<ProposalsWaiting count={2} readAt="2026-11-04T09:05:00.000Z" />);
    expect(fresh.container).toHaveTextContent(/^22 proposals waiting$/);
  });
});
