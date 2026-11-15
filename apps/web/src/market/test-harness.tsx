// For the market page's component tests: the page's context over a real market and Partner book, with core's rules
// applied to every change, so a test sees what the person would see. Shaped after src/partner/test-harness.tsx.
import {
  applyMarketChange, applyMarketChanges, applyPartnerChange, applyPartnerChanges, proposalViews,
  type Market, type MarketChange, type PartnerBook, type PartnerChange, type ProposalHead,
} from '@partner-desk/core';
import { NOW } from '@partner-desk/core/test-builders';
import type { RowIssue } from '@partner-desk/storage';
import { render } from '@testing-library/react';
import { useRef, useState, type ReactNode } from 'react';
import type { PartnerBatch } from '@/editor/remotes';
import type { DispatchOptions } from '@/editor/use-editor';
import type { MarketOption } from '@/partners/partners-model';
import type { ProgramOption } from '@/programs/title';
import { ChangeLogOfferProvider } from './change-log-offer';
import { MarketContext } from './market-context';
import { attentionOf, rowKey, type MarketTab } from './market-model';

export interface HarnessOptions {
  readOnly?: boolean;
  markets?: MarketOption[];
  issues?: RowIssue[];
  openTab?: (tab: MarketTab, hash?: string) => void;
  /** Refuse every market change with this message, as the editor does when a change can't apply. */
  refuse?: string;
  /**
   * The server refuses partner batches (an import) so: nothing is saved, and every row it showed goes. `times`: only
   * the first so many (default every one). `saved`: the book keeps the batch all the same, as when an earlier send of
   * the same import landed.
   */
  refuseImport?: { message: string; valid?: number; times?: number; saved?: boolean; unknown?: true };
  companyName?: string;
  /** Partners whose add isn't saved yet: they have no id a link could use. */
  unsaved?: string[];
  /** The company's programs, as the page lists them. */
  programs?: ProgramOption[];
  /** False when the list of programs couldn't be read (default true). */
  programsListed?: boolean;
  /** The index's proposals about this market: their cards come from the book's rows as they are now. */
  proposals?: ProposalHead[];
}

/** Every change the page made, to either file, in order. */
export interface Log {
  market: Array<{ change: MarketChange; options?: DispatchOptions }>;
  marketBatches: MarketChange[][];
  partners: Array<{ change: PartnerChange; options?: DispatchOptions }>;
  partnerBatches: Array<{ changes: PartnerChange[]; marketId: string; label?: string | undefined; batch: PartnerBatch }>;
  /** Refusals the import heard, after which the page reads again. */
  refused: Array<{ error: string; message: string }>;
}

let ids = 0;
const stampFor = () => ({ now: NOW, actor: 'Anna', newId: (kind: string) => `${kind}_local${++ids}` });

function Harness({ start, filesRef, options, log, children }: {
  start: { market: Market; book: PartnerBook };
  /** The files as they are now, shared with the test. */
  filesRef: { current: { market: Market; book: PartnerBook } };
  options: HarnessOptions; log: Log; children: ReactNode;
}) {
  const [market, setMarket] = useState(start.market);
  const [book, setBook] = useState(start.book);
  const refusals = useRef(0);
  const [importUnknown, setImportUnknown] = useState(false);
  const dispatch = (change: MarketChange, dispatchOptions?: DispatchOptions) => {
    log.market.push({ change, options: dispatchOptions });
    if (options.refuse) return { ok: false as const, error: 'invalid' as const, message: options.refuse };
    const outcome = applyMarketChange(filesRef.current.market, change, stampFor());
    if (outcome.ok) {
      filesRef.current = { ...filesRef.current, market: outcome.value };
      setMarket(outcome.value);
    }
    return outcome;
  };
  const applyMany = async (changes: MarketChange[]) => {
    log.marketBatches.push(changes);
    const outcome = applyMarketChanges(filesRef.current.market, changes, stampFor());
    if (!outcome.ok) return { ok: false as const };
    filesRef.current = { ...filesRef.current, market: outcome.value };
    setMarket(outcome.value);
    return { ok: true as const, entityIds: outcome.entityIds };
  };
  const applyPartner = async (change: PartnerChange, dispatchOptions?: DispatchOptions) => {
    log.partners.push({ change, options: dispatchOptions });
    const outcome = applyPartnerChange(filesRef.current.book, change, stampFor());
    if (!outcome.ok) return { ok: false as const };
    filesRef.current = { ...filesRef.current, book: outcome.value };
    setBook(outcome.value);
    return { ok: true as const, entityId: outcome.entityId };
  };
  const dispatchPartners = (changes: PartnerChange[], batch: PartnerBatch, batchOptions?: { label?: string }) => {
    log.partnerBatches.push({ changes, marketId: batch.marketId ?? '', label: batchOptions?.label, batch });
    const outcome = applyPartnerChanges(filesRef.current.book, changes, stampFor());
    if (outcome.ok) {
      filesRef.current = { ...filesRef.current, book: outcome.value };
      setBook(outcome.value);
    }
    return outcome;
  };
  const applyPartners = async (changes: PartnerChange[], batch: PartnerBatch) => {
    const before = filesRef.current.book;
    const outcome = dispatchPartners(changes, batch);
    if (!outcome.ok) return { ok: false as const, valid: outcome.valid, message: outcome.message };
    const refusal = options.refuseImport;
    if (refusal && refusals.current < (refusal.times ?? Infinity)) {
      refusals.current += 1;
      if (!refusal.saved) {
        filesRef.current = { ...filesRef.current, book: before };
        setBook(before);
      }
      return {
        ok: false as const, message: refusal.message,
        ...(refusal.valid !== undefined ? { valid: refusal.valid } : {}), ...(refusal.unknown ? { unknown: true as const } : {}),
      };
    }
    return { ok: true as const, entityIds: outcome.entityIds };
  };
  const attention = attentionOf(market, options.issues ?? [], book);
  const proposals = options.proposals && {
    views: proposalViews(options.proposals, { book, markets: { [market.info.marketId]: { market, archived: false } } }, NOW),
    timeZone: 'Europe/Berlin', now: NOW,
    accept: () => ({ ok: true as const }), reject: () => ({ ok: true as const }),
    refused: (failure: { error: string; message: string }) => { log.refused.push(failure); },
  };
  return (
    <MarketContext value={{
      marketId: market.info.marketId, market, book, markets: options.markets ?? [], programs: options.programs ?? [], programsListed: options.programsListed ?? true, companyName: options.companyName ?? 'Halden',
      readOnly: options.readOnly ?? false,
      saving: 'idle', issues: options.issues ?? [], dispatch, applyMany, idFor: (id) => id,
      partners: {
        apply: applyPartner, applyMany: applyPartners, dispatchMany: dispatchPartners,
        savedIdFor: (id) => (options.unsaved?.includes(id) ? null : id),
      },
      importUnknown, markImportUnknown: () => setImportUnknown(true),
      attentionFor: (entity, id) => attention.byRow.get(rowKey(entity, id)) ?? [],
      openTab: options.openTab ?? (() => {}),
      ...(proposals ? { proposals } : {}),
    }}>
      <ChangeLogOfferProvider>{children}</ChangeLogOfferProvider>
    </MarketContext>
  );
}

/** Renders `ui` inside the market page's context. `log` lists every change made, in order. */
export function renderMarket(ui: ReactNode, files: { market: Market; book: PartnerBook }, options: HarnessOptions = {}) {
  const log: Log = { market: [], marketBatches: [], partners: [], partnerBatches: [], refused: [] };
  const filesRef = { current: files };
  const result = render(<Harness start={files} filesRef={filesRef} options={options} log={log}>{ui}</Harness>);
  /** The Partner book as it is now. */
  const book = () => filesRef.current.book;
  return { ...result, log, book };
}
