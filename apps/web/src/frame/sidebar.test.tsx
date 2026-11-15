// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ pathname: '/partners' }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));

import { PreviewProvider } from '@/ui/preview';
import { Sidebar, SidebarPreview } from './sidebar';

const renderSidebar = () => render(<Sidebar company={<span>Acme GmbH</span>} account={<button type="button">Anna</button>} />);

beforeEach(() => { mocks.pathname = '/partners'; });

describe('Sidebar', () => {
  it('reads as PartnerStandard Desk: the logo, a Desk badge beside it, and the whole name on the link', () => {
    renderSidebar();
    const aside = screen.getByRole('complementary');
    const home = within(aside).getByRole('link', { name: 'PartnerStandard Desk' });
    expect(home).toHaveAttribute('href', '/');
    expect(within(home).getByText('Desk')).toBeInTheDocument();
  });

  it('on a Community Edition build shows its own mark and badge, never the PartnerStandard logo (owner, 2026-11-15)', async () => {
    vi.stubEnv('NEXT_PUBLIC_PD_BRAND', '');
    try {
      const user = userEvent.setup();
      renderSidebar();
      const aside = screen.getByRole('complementary');
      const home = within(aside).getByRole('link', { name: 'PartnerStandard Desk Community Edition' });
      expect(home).toHaveAttribute('href', '/');
      expect(within(home).getByText('Community')).toBeInTheDocument();
      expect(within(aside).queryByRole('img', { name: 'PartnerStandard' })).not.toBeInTheDocument();
      await user.click(within(aside).getByRole('button', { name: 'Shrink menu' }));
      expect(within(aside).getByRole('link', { name: 'PartnerStandard Desk Community Edition' })).toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('shows the company name, the links and the account slot', () => {
    renderSidebar();
    const aside = screen.getByRole('complementary');
    expect(within(aside).getByText('Acme GmbH')).toBeInTheDocument();
    expect(within(aside).getByRole('link', { name: 'Partners' })).toBeInTheDocument();
    expect(within(aside).getByRole('button', { name: 'Anna' })).toBeInTheDocument();
  });

  it('shows Company facts above Partners and one Programs link, also in the phone panel', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const aside = screen.getByRole('complementary');
    expect(within(aside).getByRole('link', { name: 'Company facts' })).toHaveAttribute('href', '/company-facts');
    expect(within(aside).getByRole('link', { name: 'Programs' })).toHaveAttribute('href', '/programs');
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: 'Programs' })).toBeInTheDocument();
  });

  it('shrinks to icons and expands again', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const aside = screen.getByRole('complementary');
    expect(aside).toHaveAttribute('data-collapsed', 'false');
    await user.click(within(aside).getByRole('button', { name: 'Shrink menu' }));
    expect(aside).toHaveAttribute('data-collapsed', 'true');
    // The links keep their names, so they stay usable with icons only.
    expect(within(aside).getByRole('link', { name: 'Markets' })).toBeInTheDocument();
    await user.click(within(aside).getByRole('button', { name: 'Expand menu' }));
    expect(aside).toHaveAttribute('data-collapsed', 'false');
  });

  it('opens the phone panel from the top bar and Escape closes it', async () => {
    const user = userEvent.setup();
    renderSidebar();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const panel = screen.getByRole('dialog', { name: 'Main menu' });
    expect(within(panel).getByRole('link', { name: 'Call guide' })).toBeInTheDocument();
    expect(within(panel).getByText('Acme GmbH')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the panel when a link is chosen', async () => {
    const user = userEvent.setup();
    renderSidebar();
    // jsdom can't navigate; the click only has to reach the link's handler.
    const stopNavigation = (event: Event) => event.preventDefault();
    document.addEventListener('click', stopNavigation);
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Settings' }));
    document.removeEventListener('click', stopNavigation);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the panel when Programs is chosen on a program’s page', async () => {
    const user = userEvent.setup();
    mocks.pathname = '/programs/pg_aaaaaaaaaa/why';
    renderSidebar();
    const stopNavigation = (event: Event) => event.preventDefault();
    document.addEventListener('click', stopNavigation);
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Programs' }));
    document.removeEventListener('click', stopNavigation);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('names the brand link after the app, also when the menu is shrunk to icons', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const aside = screen.getByRole('complementary');
    await user.click(within(aside).getByRole('button', { name: 'Shrink menu' }));
    // The visible "P" is decoration; the link keeps the app's name.
    expect(within(aside).getByRole('link', { name: /^PartnerStandard Desk$/ })).toHaveAttribute('href', '/');
    expect(within(aside).queryByRole('link', { name: 'P' })).not.toBeInTheDocument();
  });

  describe('when the window widens past the phone layout', () => {
    type Listener = (event: { matches: boolean }) => void;
    const original = window.matchMedia;
    let listeners: Listener[] = [];
    beforeEach(() => {
      listeners = [];
      window.matchMedia = ((query: string) => ({
        matches: false, media: query, onchange: null,
        addEventListener: (_: string, listener: Listener) => { listeners.push(listener); },
        removeEventListener: (_: string, listener: Listener) => { listeners = listeners.filter((l) => l !== listener); },
        addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    });
    afterEach(() => { window.matchMedia = original; });

    it('closes the open panel, so its focus trap and scroll lock go', async () => {
      const user = userEvent.setup();
      renderSidebar();
      await user.click(screen.getByRole('button', { name: 'Open menu' }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      act(() => listeners.forEach((listener) => listener({ matches: true })));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('leaves the panel open while the window stays narrow', async () => {
      const user = userEvent.setup();
      renderSidebar();
      await user.click(screen.getByRole('button', { name: 'Open menu' }));
      act(() => listeners.forEach((listener) => listener({ matches: false })));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('stops listening when the sidebar goes away', () => {
      const view = renderSidebar();
      expect(listeners.length).toBeGreaterThan(0);
      view.unmount();
      expect(listeners).toHaveLength(0);
    });
  });

  describe('SidebarPreview', () => {
    it('marks the preview’s page as current, whatever the address, and links nowhere', () => {
      mocks.pathname = '/';
      const { container } = render(
        <PreviewProvider pathname="/this-week"><SidebarPreview company={<span>Brookvale Software</span>} account={<span>Ruth</span>} /></PreviewProvider>,
      );
      expect(screen.getByText('Brookvale Software')).toBeInTheDocument();
      expect(screen.getByTitle('This week')).toHaveAttribute('aria-current', 'page');
      expect(screen.getByTitle('Partners')).not.toHaveAttribute('aria-current');
      expect(container.querySelector('[href]')).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
      // A picture of the menu: no landmark for screen readers.
      expect(screen.queryByRole('complementary')).toBeNull();
      expect(screen.queryByRole('navigation')).toBeNull();
    });
  });
});
