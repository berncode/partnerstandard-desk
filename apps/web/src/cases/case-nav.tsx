// The tabs and their look. PartnerStandard Desk keeps one editor for the whole case in the case's layout (as for programs),
// so a tab needs no save before it opens and needs no leave or reload hooks.
import Link from 'next/link';
import { Fragment } from 'react';
import { cn } from '@/ui/cn';

export type CaseTab = 'offer' | 'case' | 'ours' | 'share';

/** Where a tab of a case lives: the partner case at the case's own address, as in the Business Case app. */
export function caseTabPath(caseId: string, tab: CaseTab): string {
  const base = `/business-cases/${encodeURIComponent(caseId)}`;
  return tab === 'case' ? base : `${base}/${tab}`;
}

/** Which one-pager the Share tab shows: the partner's (the default), or ours with `?show=ours`. */
export type ShareSide = 'partner' | 'ours';

/** The side `?show=` asks for. */
export const sideOf = (show: string | string[] | undefined): ShareSide => (show === 'ours' ? 'ours' : 'partner');

/** The Share tab's address for `side`. */
export const shareHref = (caseId: string, side: ShareSide) => `${caseTabPath(caseId, 'share')}${side === 'ours' ? '?show=ours' : ''}`;

/** Which tab of the case the address shows, or null. */
export function caseTabOf(pathname: string, caseId: string): CaseTab | null {
  const base = caseTabPath(caseId, 'case');
  if (pathname === base) return 'case';
  const rest = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1) : null;
  return rest === 'offer' || rest === 'ours' || rest === 'share' ? rest : null;
}

const TAB = 'min-w-0 rounded-[10px] border bg-surface px-3.5 py-2 text-left break-words sm:min-w-[190px] sm:max-w-[280px]';
const CURRENT = 'border-brand-strong shadow-[inset_0_0_0_1px_var(--brand-strong)]';
const OTHER = 'border-line hover:bg-surface-2';

/** The four tabs of a case (BC v2 section 3), one route each. Our case is internal: its subtitle is in the warning color. */
function tabs(id: string, partner: string): { key: CaseTab; title: string; subtitle: string; internal?: boolean }[] {
  return [
    { key: 'offer', title: `1. Offer to ${partner}`, subtitle: 'Products and partner terms' },
    { key: 'case', title: '2. Partner case', subtitle: `What ${partner} gets out of it` },
    { key: 'ours', title: '3. Our case', subtitle: 'Internal: what it’s worth to us', internal: true },
    { key: 'share', title: '4. Share', subtitle: 'The one-pagers, ready to send' },
  ];
}

/**
 * The tabs of a case: Offer to <partner>, Partner case, Our case, and, after a thin divider, Share. Two by two on a
 * phone (the divider shows only where the tabs sit in one row).
 */
export function CaseNav({ id, partner, current }: { id: string; partner: string; current: CaseTab | null }) {
  return (
    <nav aria-label="Case" className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap print:hidden">
      {tabs(id, partner).map((tab) => (
        <Fragment key={tab.key}>
          {tab.key === 'share' && <span data-divider aria-hidden className="my-1 hidden w-px self-stretch bg-line sm:block" />}
          <Link href={caseTabPath(id, tab.key)} aria-current={current === tab.key ? 'page' : undefined}
            className={cn(TAB, current === tab.key ? CURRENT : OTHER)}>
            <span className="block text-sm font-semibold text-ink">{tab.title}</span>{' '}
            <span className={cn('block text-xs', tab.internal ? 'text-warn' : 'text-ink-3')}>{tab.subtitle}</span>
          </Link>
        </Fragment>
      ))}
    </nav>
  );
}
