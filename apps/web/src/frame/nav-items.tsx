'use client';

import { COPY } from '@partner-desk/copy';
import { BookOpen, BriefcaseBusiness, Building2, CalendarCheck, CalendarDays, Layers, ListChecks, Phone, Settings, Store, Users, type LucideIcon } from 'lucide-react';
import { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useSyncExternalStore, type ReactNode } from 'react';
import { answeredCount, subscribeAnswered, syncRead } from '@/proposals/waiting-store';
import { cn } from '@/ui/cn';
import { AppLink, usePreviewPathname } from '@/ui/preview';

export interface NavItem {
  href: string;
  label: string;
  Icon: LucideIcon;
}
interface NavGroup { label?: string; items: NavItem[] }

/**
 * The sidebar (owner, 2026-11-01): This week, the home page after sign-in, alone at the top; Partners, Markets and
 * Programs together; the three documents kept per partner; guides; and what you set up once at the bottom.
 */
export const NAV_GROUPS: NavGroup[] = [
  { items: [{ href: '/this-week', label: COPY.NAV_THIS_WEEK, Icon: CalendarDays }] },
  {
    label: COPY.NAV_ECOSYSTEM,
    items: [
      { href: '/partners', label: COPY.NAV_PARTNERS, Icon: Users },
      { href: '/markets', label: COPY.NAV_MARKETS, Icon: Store },
      { href: '/programs', label: COPY.NAV_PROGRAMS, Icon: Layers },
    ],
  },
  {
    label: COPY.NAV_OPERATIONS,
    items: [
      { href: '/business-cases', label: COPY.NAV_BUSINESS_CASES, Icon: BriefcaseBusiness },
      { href: '/plans', label: COPY.NAV_PLANS, Icon: ListChecks },
      { href: '/reviews', label: COPY.NAV_REVIEWS, Icon: CalendarCheck },
    ],
  },
  {
    label: COPY.NAV_GUIDES,
    items: [
      { href: '/guide', label: COPY.NAV_GUIDE, Icon: BookOpen },
      { href: '/call-guide', label: COPY.NAV_CALL_GUIDE, Icon: Phone },
    ],
  },
  {
    items: [
      { href: '/company-facts', label: COPY.NAV_COMPANY_FACTS, Icon: Building2 },
      { href: '/settings', label: COPY.NAV_SETTINGS, Icon: Settings },
    ],
  },
];

const WEEK_HREF = '/this-week';

/** A link is current on its own page and below it (/markets/abc is under /markets). */
export const isCurrent = (pathname: string, href: string): boolean => pathname === href || pathname.startsWith(`${href}/`);

/**
 * One link of the sidebar, marked as the page you are on. Labels hide in a shrunk sidebar; the name stays. `badge`:
 * what shows at the link's end (This week's waiting proposals), read out as the link's description.
 */
export function NavLink({ item: { href, label, Icon }, onNavigate, badge }: { item: NavItem; onNavigate?: () => void; badge?: ReactNode }) {
  const appPathname = usePathname();
  const pathname = usePreviewPathname() ?? appPathname;
  const current = isCurrent(pathname, href);
  const badgeId = useId();
  return (
    <AppLink
      href={href}
      title={label}
      aria-label={label}
      aria-describedby={badge ? badgeId : undefined}
      aria-current={current ? 'page' : undefined}
      onClick={onNavigate}
      className={cn(
        'relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand group-data-[collapsed=true]:justify-center group-data-[collapsed=true]:px-0',
        current ? 'bg-brand-soft text-brand-strong' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="truncate group-data-[collapsed=true]:hidden">{label}</span>
      {badge && <span id={badgeId} className="ml-auto flex group-data-[collapsed=true]:absolute group-data-[collapsed=true]:top-0 group-data-[collapsed=true]:right-0.5">{badge}</span>}
      <PendingDot alone={!badge} />
    </AppLink>
  );
}

/**
 * How many proposals wait for the person (the layout reads it from our index): a number beside This week, nothing at
 * 0. Answers given on this visit come off at once; a new count from the server starts again (`readAt`, the time of
 * the read), while the same read mounted again (the phone menu's panel) keeps them off.
 */
export function ProposalsWaiting({ count, readAt }: { count: number; readAt?: string }) {
  const answered = useSyncExternalStore(subscribeAnswered, answeredCount, () => 0);
  // The desktop column and the phone menu each show a copy; only a new read from the server starts again.
  useEffect(() => syncRead(readAt ?? `count:${count}`), [count, readAt]);
  const shown = Math.max(0, count - answered);
  if (shown === 0) return null;
  return (
    <span className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-brand px-1 text-[11px] leading-none font-semibold text-white tabular-nums">
      <span aria-hidden>{shown}</span>
      <span className="sr-only">{COPY.NAV_PROPOSALS_WAITING(shown)}</span>
    </span>
  );
}

/**
 * A pulsing dot at the end of the link you clicked, until its page starts to show. Always there, so nothing moves.
 * `alone`: no badge before it, so it takes the end of the link itself.
 */
function PendingDot({ alone }: { alone: boolean }) {
  const { pending } = useLinkStatus();
  return (
    <span aria-hidden className={cn(
      'h-1.5 w-1.5 shrink-0 rounded-full bg-brand group-data-[collapsed=true]:hidden', alone && 'ml-auto',
      pending ? 'link-pending' : 'opacity-0',
    )} />
  );
}

/**
 * The sidebar's links. Inside a parent with `group` and `data-collapsed=true` the labels hide and the icons stay;
 * the label stays as the link's name and tooltip. `proposalsWaiting`: the count beside This week (`ProposalsWaiting`,
 * read by the layout inside Suspense).
 */
export function NavLinks({ onNavigate, proposalsWaiting }: { onNavigate?: () => void; proposalsWaiting?: ReactNode }) {
  return (
    <nav aria-label={COPY.NAV_LABEL} className="flex flex-1 flex-col gap-3">
      {NAV_GROUPS.map((group, index) => (
        // The last group (Settings) sits at the bottom of the sidebar.
        <div key={group.label ?? index} className={cn('flex flex-col gap-0.5', index === NAV_GROUPS.length - 1 && 'mt-auto')}>
          {group.label && (
            <p className="px-2.5 pt-1 pb-0.5 text-[11px] font-semibold tracking-wider text-ink-3 uppercase group-data-[collapsed=true]:hidden">{group.label}</p>
          )}
          {group.items.map((item) => (
            <NavLink key={item.href} item={item} onNavigate={onNavigate} badge={item.href === WEEK_HREF ? proposalsWaiting : undefined} />
          ))}
        </div>
      ))}
    </nav>
  );
}
