'use client';

import type { PartnerBook, PartnerChange } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import type { Snapshot } from '@partner-desk/storage';
import { Plus } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { partnersAdapter } from '@/editor/adapters';
import { ReconnectBanner } from '@/editor/reconnect-banner';
import { partnersRemote, type PartnerBatch } from '@/editor/remotes';
import { useEditor } from '@/editor/use-editor';
import { Button } from '@/ui/button';
import { AddPartnerDialog } from '@/partners/add-partner-dialog';
import { EmptyFilter, EmptyView, FindPartnersLink, NoPartnersYet } from '@/partners/empty-states';
import { FilterBar, ViewTabs } from '@/partners/filters';
import { PartnersBoard } from '@/partners/partners-board';
import {
  hasBoard, hasFilters, parseQuery, partnersFor, queryString, showsMapHealth, switchView, viewCounts, withoutFilters,
  type MapsListed, type MarketOption, type PartnerQuery,
} from '@/partners/partners-model';
import { PartnersTable } from '@/partners/partners-table';
import type { ProgramOption } from '@/programs/title';
import type { StorageKind } from '@/storage-kind';

/**
 * The Partners screen. The view, the filters and the layout live in the address, so a link, Back and a reload all keep
 * them. The Partner book goes through the editor, so adding a partner shows at once and saves in the background.
 */
export function PartnersView({ initial, markets, programs, programsListed, mapPartnerIds = [], actor, today, storage }: {
  initial: Snapshot<PartnerBook>; markets: MarketOption[]; programs: ProgramOption[];
  /** The partner types with a MAP, by row id, from the directory (an empty MAP keeps no health on its row). */
  mapPartnerIds?: string[];
  /** False when the list of programs couldn't be read. */
  programsListed: boolean;
  actor: string; storage: StorageKind;
  /** The owner's today, in their Settings time zone: the date Add partner's "Signed on" starts on. */
  today: string;
}) {
  const editor = useEditor<PartnerBook, PartnerChange, PartnerBatch>(initial, { adapter: partnersAdapter, remote: partnersRemote, actor });
  const book = editor.value;
  const params = useSearchParams();
  // With no view in the address it opens on Active, or on Potential when nobody is active: decided on the book as it
  // was loaded, so a new partner doesn't move the person to another tab.
  const query = useMemo(() => parseQuery(params, initial.value.partners), [params, initial]);
  const [adding, setAdding] = useState(false);

  // A change starts from the address as it is now, not from the last render: the address is updated by the browser at
  // once, and a second change made before React has caught up must not undo the first.
  const go = (change: (current: PartnerQuery) => PartnerQuery, how: 'push' | 'replace' = 'replace') => {
    const current = parseQuery(new URLSearchParams(window.location.search), initial.value.partners);
    window.history[how === 'push' ? 'pushState' : 'replaceState'](null, '', queryString(change(current)));
  };
  const canAdd = !editor.readOnly;
  const maps: MapsListed = useMemo(() => new Set(mapPartnerIds), [mapPartnerIds]);
  const list = partnersFor(book, query, maps);
  const showHealth = showsMapHealth(book, query, maps);
  const open = () => setAdding(true);

  return (
    <div className="grid gap-4">
      {editor.readOnly && <ReconnectBanner next="/partners" storage={storage} />}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-xl font-semibold tracking-tight">{COPY.PARTNERS_TITLE}</h1>
          <p className="mt-0.5 text-sm text-ink-3">{COPY.PARTNERS_SUBTITLE}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <FindPartnersLink />
          {canAdd && (
            <Button variant="primary" onClick={open}>
              <Plus className="h-4 w-4" aria-hidden />
              {COPY.ADD_PARTNER}
            </Button>
          )}
        </div>
      </div>

      {book.partners.length === 0 ? (
        <NoPartnersYet onAdd={open} canAdd={canAdd} />
      ) : (
        <ViewTabs view={query.view} counts={viewCounts(book, query, maps)} onChange={(view) => go((q) => switchView(q, view), 'push')}>
          <FilterBar query={query} markets={markets} programs={programs} programsListed={programsListed} mapHealth={showHealth}
            onChange={(patch) => go((q) => ({ ...q, ...patch }))} />
          {list.length === 0 ? (
            hasFilters(query)
              ? <EmptyFilter onClear={() => go(withoutFilters)} />
              : <EmptyView view={query.view} onAdd={open} canAdd={canAdd} />
          ) : query.layout === 'board' && hasBoard(query.view) ? (
            <PartnersBoard view={query.view as 'potential' | 'active'} partners={list} book={book} markets={markets} savedIdFor={editor.savedIdFor} />
          ) : (
            <PartnersTable partners={list} book={book} markets={markets} programs={programs} programsListed={programsListed} mapHealth={showHealth}
              maps={maps} savedIdFor={editor.savedIdFor} />
          )}
        </ViewTabs>
      )}

      <AddPartnerDialog open={adding} onOpenChange={setAdding} book={book} markets={markets} editor={editor} today={today}
        onAdded={(view) => go((q) => ({ ...withoutFilters(q), view }), 'push')} />
    </div>
  );
}
