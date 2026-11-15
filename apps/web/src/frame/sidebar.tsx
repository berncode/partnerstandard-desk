'use client';

import { COPY } from '@partner-desk/copy';
import { Menu as MenuIcon, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/ui/button';
import { AppLink } from '@/ui/preview';
import { shownBrand } from '@/ui/brand';
import { BADGE_COMMUNITY, BADGE_PARTNERSTANDARD, CommunityLogo, CommunitySquare, Logo } from '@/ui/logo';
import { NavLinks } from './nav-items';

export interface SidebarSlots {
  /** The company's name (read from the session, so the caller wraps it in Suspense). */
  company: ReactNode;
  /** The account menu, at the foot. */
  account: ReactNode;
  /** How many proposals wait, beside This week (`ProposalsWaiting`, read from the session, so wrapped in Suspense). */
  proposalsWaiting?: ReactNode;
}

/**
 * The logo and the "Desk" badge read as the name; collapsed, only the "P" shows. The link always carries the full name.
 * The Community Edition shows its own mark, badge and square instead (brand.ts).
 */
function Brand({ onNavigate }: { onNavigate?: () => void }) {
  const ours = shownBrand() === 'partnerstandard';
  return (
    <AppLink href="/" aria-label={ours ? COPY.APP_NAME : COPY.COMMUNITY_APP_NAME} onClick={onNavigate} className="flex min-w-0 items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand">
      {ours ? (
        <>
          <span className="group-data-[collapsed=true]:hidden"><Logo className="h-8 w-auto" /></span>
          <span className={`text-[11px] group-data-[collapsed=true]:hidden ${BADGE_PARTNERSTANDARD}`}>{COPY.APP_BADGE}</span>
          <span aria-hidden className="hidden size-8 items-center justify-center rounded-lg bg-brand-soft text-sm font-bold text-brand-strong group-data-[collapsed=true]:flex">P</span>
        </>
      ) : (
        <>
          <span aria-hidden className="group-data-[collapsed=true]:hidden"><CommunityLogo /></span>
          <span className={`text-[11px] group-data-[collapsed=true]:hidden ${BADGE_COMMUNITY}`}>{COPY.COMMUNITY_BADGE}</span>
          <span className="hidden group-data-[collapsed=true]:flex"><CommunitySquare className="size-8 rounded-lg text-sm" /></span>
        </>
      )}
    </AppLink>
  );
}

/** Brand, company, links and account: the same in the desktop column and in the phone panel. */
function SidebarBody({ company, account, proposalsWaiting, onNavigate, toggle }: SidebarSlots & { onNavigate?: () => void; toggle: ReactNode }) {
  return (
    <>
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-3 group-data-[collapsed=true]:h-auto group-data-[collapsed=true]:flex-col group-data-[collapsed=true]:justify-center group-data-[collapsed=true]:px-0 group-data-[collapsed=true]:py-2">
        <Brand onNavigate={onNavigate} />
        {toggle}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 group-data-[collapsed=true]:px-2">
        <div className="truncate px-2.5 text-sm font-semibold text-ink group-data-[collapsed=true]:hidden"><span data-testid="company-name">{company}</span></div>
        <NavLinks onNavigate={onNavigate} proposalsWaiting={proposalsWaiting} />
      </div>
      <div className="shrink-0 border-t border-line p-3 group-data-[collapsed=true]:px-2">{account}</div>
    </>
  );
}

/**
 * The same column as a still picture of the app (the landing page's sample): as tall as its box, not sticky, no shrink
 * button, no phone panel; hidden on a phone, as the app's column is, and from screen readers. Put it inside a
 * `PreviewProvider`.
 */
export function SidebarPreview({ company, account, proposalsWaiting }: SidebarSlots) {
  return (
    // A picture of the menu, not a menu: hidden from screen readers, so the page has no landmark that leads nowhere.
    <aside aria-hidden className="hidden w-56 shrink-0 flex-col border-r border-line bg-surface md:flex">
      <SidebarBody company={company} account={account} proposalsWaiting={proposalsWaiting} toggle={null} />
    </aside>
  );
}

/**
 * The Recruitment app's look (logo with a badge, tokens, ghost buttons) as a left column. It shrinks to icons on a desktop;
 * on a phone a top bar button slides the same column in.
 */
export function Sidebar({ company, account, proposalsWaiting }: SidebarSlots) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  // The panel is open for the page it was opened on, so any change of page (a link, the back button) closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (value: boolean) => setOpenOn(value ? pathname : null);
  // Widening the window past the phone layout hides the panel, but Radix would keep its focus trap and scroll lock.
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 768px)');
    const close = (event: { matches: boolean }) => { if (event.matches) setOpenOn(null); };
    wide.addEventListener('change', close);
    return () => wide.removeEventListener('change', close);
  }, []);

  return (
    <>
      <aside
        data-collapsed={collapsed}
        className={`group sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface md:flex print:hidden ${collapsed ? 'w-16' : 'w-56'}`}
      >
        <SidebarBody
          company={company}
          account={account}
          proposalsWaiting={proposalsWaiting}
          toggle={(
            <Button
              variant="ghost"
              size="icon"
              aria-label={collapsed ? COPY.NAV_EXPAND : COPY.NAV_SHRINK}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed((value) => !value)}
            >
              {collapsed ? <PanelLeftOpen className="h-5 w-5" aria-hidden /> : <PanelLeftClose className="h-5 w-5" aria-hidden />}
            </Button>
          )}
        />
      </aside>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface/85 px-3 backdrop-blur md:hidden print:hidden">
          <Dialog.Trigger asChild>
            <Button variant="ghost" size="icon" aria-label={COPY.NAV_OPEN}><MenuIcon className="h-5 w-5" aria-hidden /></Button>
          </Dialog.Trigger>
          <Brand />
        </header>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40 md:hidden" />
          <Dialog.Content className="slide-in-left fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-line bg-surface text-ink shadow-xl outline-none md:hidden">
            <Dialog.Title className="sr-only">{COPY.NAV_LABEL}</Dialog.Title>
            <Dialog.Description className="sr-only">{COPY.NAV_LABEL}</Dialog.Description>
            <SidebarBody
              company={company}
              account={account}
              proposalsWaiting={proposalsWaiting}
              onNavigate={() => setOpen(false)}
              toggle={(
                <Dialog.Close asChild>
                  <Button variant="ghost" size="icon" aria-label={COPY.NAV_CLOSE}><X className="h-5 w-5" aria-hidden /></Button>
                </Dialog.Close>
              )}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
