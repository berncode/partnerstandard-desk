'use client';

// The switch between the two one-pagers: the partner's one-pager with Download PDF and the share link, and ours with
// Download PDF and no link. One editor holds the whole case in the case's layout, so both one-pagers are drawn from the
// case on screen (never an older copy, so no "bring the latest before printing" step is needed), and sharing first saves
// what is on screen, then the editor goes on from the case as the share stamped it. The page holds whether the case is
// shared (CaseHost).
import { partnerSide, type BusinessCase as Case } from '@partner-desk/core';
import type { Snapshot } from '@partner-desk/storage';
import Link from 'next/link';
import { useMemo } from 'react';
import type { RemoteOutcome } from '@/editor/remote';
import { buttonVariants } from '@/ui/button';
import { cn } from '@/ui/cn';
import { useCaseEditor } from './case-editor';
import { caseTabPath, shareHref, type ShareSide } from './case-nav';
import { useCasePage } from './case-page';
import { DownloadPdfButton } from './download-pdf-button';
import { OnePageCase } from './one-page-case';
import { finiteNumbers, ourView } from './our-case';
import { OurOnePager } from './our-one-pager';
import { ShareControls, type ShareActions } from './share-controls';

export type ShareCase = (input: { caseId: string }) => Promise<RemoteOutcome<{ url: string; snapshot: Snapshot<Case> }>>;
export type UnshareCase = (input: { caseId: string }) => Promise<RemoteOutcome<{ snapshot: Snapshot<Case> }>>;

const SWITCH = 'flex h-[38px] items-center px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset';
const ACTIONS = 'mx-auto mt-3.5 flex max-w-[840px] flex-wrap items-start justify-end gap-x-3 gap-y-2 print:hidden';
const NOTE = 'min-w-0 flex-1 basis-60 self-center text-[12.5px] break-words text-ink-3';

/** The switch between the two one-pagers (the prototype's `#shareSwitch`), as two links: each side has its own address. */
function Switch({ id, partner, side }: { id: string; partner: string; side: ShareSide }) {
  const tabs: { key: ShareSide; title: string; more: string; href: string }[] = [
    { key: 'partner', title: 'Partner case', more: `· for ${partner}`, href: shareHref(id, 'partner') },
    { key: 'ours', title: 'Our case', more: '· internal, for your manager', href: shareHref(id, 'ours') },
  ];
  return (
    <div className="mx-auto mb-3.5 flex max-w-[840px] justify-center print:hidden">
      <nav aria-label="One-pager" className="flex min-w-0 flex-wrap overflow-hidden rounded-[9px] border border-line">
        {tabs.map((tab, i) => {
          const current = tab.key === side;
          return (
            <Link key={tab.key} href={tab.href} aria-current={current ? 'page' : undefined}
              className={cn(SWITCH, 'min-w-0 break-words', i > 0 && 'border-l border-line',
                current ? 'bg-brand-strong text-on-brand' : 'bg-surface text-ink-2 hover:bg-surface-2')}>
              <span>
                {tab.title}{' '}
                <span className={cn(!current && (tab.key === 'ours' ? 'text-warn' : 'text-ink-3'))}>{tab.more}</span>
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** The partner's one-pager, Download PDF and the share link (BC v2 §9). Given only the partner's side of the case. */
function PartnerSide({ c, partner, actions }: { c: Case; partner: string; actions: ShareActions }) {
  const { sharedAt } = useCasePage();
  const view = useMemo(() => partnerSide(finiteNumbers(c), c.offer.company), [c]);
  return (
    <section aria-label={`Partner case · for ${partner}`}>
      <OnePageCase view={view} />
      <div className={ACTIONS}>
        <p className={NOTE}>{`The link shows this case as it is now. Changes you make here show up for ${partner}.`}</p>
        <div className="flex min-w-0 flex-wrap items-start justify-end gap-2">
          <DownloadPdfButton />
          <ShareControls caseId={c.id} partner={partner} sharedAt={sharedAt} align="end" actions={actions} />
        </div>
      </div>
    </section>
  );
}

/** Our one-pager for your manager (BC v2 §9): Download PDF, and no link. */
function OurSide({ c }: { c: Case }) {
  const view = useMemo(() => ourView(finiteNumbers(c)), [c]);
  return (
    <section aria-label="Our case · internal, for your manager">
      <OurOnePager view={view} />
      <div className={ACTIONS}>
        <p className={cn(NOTE, 'flex-none basis-auto')}>Internal: download it and send it to your manager. It has no link.</p>
        <DownloadPdfButton variant="primary" />
      </div>
    </section>
  );
}

/**
 * The Share tab (tab 4 of a case, BC v2 §3 and §9): a switch between the partner's one-pager, with its share link, and
 * our one-pager for your manager, which has no link. Only the side shown is drawn. The print layout keeps only the
 * one-pager. Sharing saves what is on screen first, so the link shows it; the share stamps the case, and the editor's
 * next save goes over the stamped case.
 */
export function ShareTab({ side, share, unshare }: { side: ShareSide; share: ShareCase; unshare: UnshareCase }) {
  const editor = useCaseEditor();
  const { setSharedAt } = useCasePage();
  const c = editor.case;
  const partner = c.partner.trim() || 'the partner';
  const typeGone = !c.offer.types.some((t) => t.id === c.typeId);

  const actions: ShareActions = {
    share: async (caseId) => {
      const flushed = await editor.saveNow();
      if (!flushed.ok) return flushed;
      const shared = await share({ caseId });
      if (!shared.ok) return { ok: false, message: shared.message };
      editor.adopt(shared.snapshot.value);
      setSharedAt(new Date().toISOString());
      return { ok: true, url: shared.url };
    },
    stop: async (caseId) => {
      // No save in flight while the stamp is cleared; the link goes off even when what is on screen can't be saved.
      await editor.saveNow();
      const stopped = await unshare({ caseId });
      if (!stopped.ok) return { ok: false, message: stopped.message };
      editor.adopt(stopped.snapshot.value);
      setSharedAt(null);
      return { ok: true };
    },
  };

  return (
    <>
      <Switch id={c.id} partner={partner} side={side} />
      {typeGone ? (
        <div className="mx-auto grid max-w-[840px] justify-items-start gap-3 rounded-xl border border-line bg-surface p-4">
          <h1 className="sr-only">Share</h1>
          <p className="text-sm font-medium text-warn">This case’s partner type is no longer in its offer.</p>
          <Link href={caseTabPath(c.id, 'case')} className={buttonVariants({ variant: 'secondary' })}>Open the partner case</Link>
        </div>
      ) : side === 'ours' ? <OurSide c={c} /> : <PartnerSide c={c} partner={partner} actions={actions} />}
    </>
  );
}
