'use client';

// The market page's header: Google Sheets only, words from COPY.
import { itemsToCheck, marketDisplayName, type MarketStatus } from '@partner-desk/core';
import { COPY, MARKET_STATUS_LABELS } from '@partner-desk/copy';
import { Check, CircleAlert, FileSpreadsheet, ListX, LoaderCircle } from 'lucide-react';
import type { SaveState } from '@/editor/use-editor';
import { Button, buttonVariants } from '@/ui/button';
import { Chip, type ChipTone } from '@/ui/chip';
import { cn } from '@/ui/cn';
import { useMarket } from './market-context';
import { StatusProposals } from './market-proposals';
import { useCopy, useFileLinkProps } from '@/storage-context';

export const STATUS_TONE: Record<MarketStatus, ChipTone> = { open: 'neutral', validated: 'brand', partly_validated: 'info', invalidated: 'danger' };

export function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return <span role="status" aria-live="polite" />;
  const text = { saved: COPY.SAVED, saving: COPY.SAVING, error: COPY.NOT_SAVED }[state];
  const Icon = { saved: Check, saving: LoaderCircle, error: CircleAlert }[state];
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex items-center gap-1.5 text-xs', state === 'error' ? 'text-danger' : 'text-ink-3')}>
      <Icon className={cn('h-3.5 w-3.5', state === 'saving' && 'animate-spin')} aria-hidden />
      {text}
    </span>
  );
}

/**
 * The market's name, status and the ways out to the spreadsheet and the Exclusions panel. `fileUrl` is null when there
 * is no spreadsheet to open (a test user's market lives in memory).
 */
export function MarketHeader({ fileUrl, onExclusions }: { fileUrl: string | null; onExclusions: () => void }) {
  const words = useCopy();
  const fileLink = useFileLinkProps();
  const { market, saving } = useMarket();
  const { info } = market;
  const toCheck = itemsToCheck(market);
  return (
    <header className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-xs font-medium tracking-wider text-ink-3 uppercase">{COPY.MARKET_LABEL}</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight break-words sm:text-2xl">{marketDisplayName(info)}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <Chip tone={STATUS_TONE[info.status]}>{MARKET_STATUS_LABELS[info.status]}</Chip>
            {toCheck > 0 && <Chip tone="warn">{COPY.ITEMS_TO_CHECK(toCheck)}</Chip>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SaveIndicator state={saving} />
          {fileUrl && (
            <a href={fileUrl} {...fileLink} className={buttonVariants({ size: 'sm' })}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              {words.OPEN_IN_SHEETS}
            </a>
          )}
          <Button size="sm" onClick={onExclusions}>
            <ListX className="h-4 w-4" aria-hidden />
            {COPY.EXCLUSIONS}
          </Button>
        </div>
      </div>
      {/* An agent's proposal of the market's status sits beside the status it would change. */}
      <div className="mt-3 empty:hidden"><StatusProposals /></div>
    </header>
  );
}
