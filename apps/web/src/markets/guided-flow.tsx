'use client';

// Through the commands' server actions: the market is made first, then the first partners go in as one import.
import { buildSearchPrompt, marketInfoSchema, newMarket, toFieldErrors, type Market, type PartnerBook } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from 'react';
import { z } from 'zod';
import { continueWithGoogle } from '@/app/sign-in/actions';
import { marketCreate } from '@/app/(signed-in)/actions/markets';
import { partnerImport } from '@/app/(signed-in)/actions/partners';
import { today } from '@/partners/partners-model';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { Tip } from '@/ui/pieces';
import {
  firstPartnerChanges, firstPartnerNote, listRefusal, MAX_FIRST_CANDIDATES, stepFromAddress, type FirstPartner,
} from './markets-model';
import { FirstPartnersStep, MarketStep, MustHavesStep, STEPS, WhyStep, type MarketDraft } from './steps';
import { canReconnectGoogle, type StorageKind } from '@/storage-kind';

/** What creating a market answers when it fails. `reconnect`: Google needs the person's sign-in again. */
interface Failure { message: string; reconnect: boolean }

export interface GuidedFlowProps {
  /** Step 1's product and target customers, from the newest market (empty for a first market). */
  defaults: { ourProduct: string; ourTargetCustomers: string };
  companyName: string;
  /** The Partner book as loaded: the search prompt leaves out what it knows, and the first partners are checked against it. */
  book: PartnerBook;
  /** Keys this person's saved draft. */
  ownerId: string;
  storage: StorageKind;
  /** `?step=` as it was in the address, or null. */
  initialStep: string | null;
}

const STEP_OF_FIELD: Record<keyof MarketDraft, number> = {
  marketName: 0, partnerType: 0, ourProduct: 0, ourTargetCustomers: 0, whyPartnerRoute: 1, mustHaves: 2, howMarketBuys: 2, howMarketBuysNote: 2,
};
const draftSchema = marketInfoSchema.pick({
  marketName: true, partnerType: true, ourProduct: true, ourTargetCustomers: true, whyPartnerRoute: true, mustHaves: true,
  howMarketBuys: true, howMarketBuysNote: true,
});
const stepOf = (field: string): number | undefined => STEP_OF_FIELD[field as keyof MarketDraft];

// The draft in this tab's sessionStorage: it survives a Google reconnect, which leaves the page and comes back to it.

const savedDraftSchema = z.object({
  draft: draftSchema,
  partners: z.array(z.object({ id: z.string(), company: z.string(), website: z.string() })).max(MAX_FIRST_CANDIDATES),
  index: z.number().int().min(0).max(STEPS.length - 1),
});
type SavedDraft = z.infer<typeof savedDraftSchema>;

const storageKey = (ownerId: string) => `partner-desk:new-market:${ownerId}`;

function tabStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function loadDraft(ownerId: string): SavedDraft | null {
  try {
    const raw = tabStorage()?.getItem(storageKey(ownerId));
    const parsed = raw ? savedDraftSchema.safeParse(JSON.parse(raw)) : null;
    return parsed?.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function saveDraft(ownerId: string, saved: SavedDraft | null) {
  try {
    const storage = tabStorage();
    if (saved) storage?.setItem(storageKey(ownerId), JSON.stringify(saved));
    else storage?.removeItem(storageKey(ownerId));
  } catch {
    // Storage is full or refused: the draft lives on in memory only.
  }
}

const subscribeNothing = () => () => {};
/** False on the server and while hydrating, true afterwards: storage is read only then, so hydration matches. */
const useHydrated = () => useSyncExternalStore(subscribeNothing, () => true, () => false);

/**
 * New market: four short steps, each with a tip and an example. Once the page has hydrated, the flow mounts again from
 * the draft this tab saved, if any. The step is in the address (`?step=2`), so a reload keeps it.
 */
export function GuidedFlow(props: GuidedFlowProps) {
  const hydrated = useHydrated();
  return <Flow key={hydrated ? 'restored' : 'first'} {...props} restore={hydrated} />;
}

function Flow({ defaults, companyName, book, ownerId, storage, initialStep, restore }: GuidedFlowProps & { restore: boolean }) {
  const router = useRouter();
  const [saved] = useState(() => (restore ? loadDraft(ownerId) : null));
  const [draft, setDraft] = useState<MarketDraft>(() => saved?.draft ?? {
    marketName: '', partnerType: 'reseller', ...defaults, whyPartnerRoute: '', mustHaves: [...COPY.BASELINE_MUST_HAVES],
    howMarketBuys: 'unknown', howMarketBuysNote: '',
  });
  const [partners, setPartners] = useState<FirstPartner[]>(saved?.partners ?? []);
  const [index, setIndex] = useState(() => stepFromAddress(initialStep, STEPS.length) ?? saved?.index ?? 0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (restore) saveDraft(ownerId, { draft, partners, index });
  }, [restore, ownerId, draft, partners, index]);
  useEffect(() => {
    if (restore) window.history.replaceState(null, '', `?step=${index + 1}`);
  }, [restore, index]);

  const step = STEPS[index]!;
  const last = index === STEPS.length - 1;

  // The market as typed so far fills the search prompt.
  const searchPrompt = useMemo(
    () => buildSearchPrompt({ market: newMarket({ ...draft, companyId: 'draft', updatedBy: 'draft' }, 'draft'), book, companyName, hypothesisId: null }),
    [draft, book, companyName],
  );

  const change = (patch: Partial<MarketDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const addFirstPartner = (company: string, website: string): string | null => {
    const refusal = listRefusal(partners, { company, website });
    if (refusal === 'full') return COPY.FIRST_PARTNERS_LIMIT(MAX_FIRST_CANDIDATES);
    if (refusal === 'again') return COPY.ALREADY_IN_LIST;
    if (!company) return COPY.COMPANY_NEEDED;
    setPartners((list) => [...list, { id: `${Date.now()}-${list.length}`, company, website }]);
    return null;
  };

  const create = () => {
    setFailure(null);
    startTransition(async () => {
      // Success moves on, so the draft goes first. A failure puts it back, ready for a retry or a reconnect.
      saveDraft(ownerId, null);
      const back = () => saveDraft(ownerId, { draft, partners, index });
      try {
        const made = await marketCreate({ info: draft });
        if (!made.ok) {
          back();
          setFailure({ message: made.message, reconnect: made.error === 'auth' });
          const fieldErrors = made.fieldErrors ?? {};
          const steps = Object.keys(fieldErrors).map(stepOf).filter((i): i is number => i !== undefined);
          if (steps.length > 0) {
            setErrors(fieldErrors);
            setIndex(Math.min(...steps));
          }
          return;
        }
        // The market exists now: whatever happens next, the person lands on it, so a retry can't make a second one.
        const marketId = made.entityId!;
        const market: Market = made.snapshot.value;
        let notAdded = 0;
        if (partners.length > 0) {
          const { changes, notAdded: skipped } = firstPartnerChanges(book, market, partners, today());
          notAdded = skipped;
          if (changes.length > 0) {
            // The market exists, so a failing import never fails the flow: the person lands on it with the count.
            try {
              const imported = await partnerImport({ marketId, changes });
              if (!imported.ok) notAdded = partners.length;
            } catch {
              notAdded = partners.length;
            }
          }
        }
        router.push(notAdded > 0 ? `/markets/${marketId}?firstPartners=${notAdded}` : `/markets/${marketId}`);
      } catch {
        back();
        setFailure({ message: COPY.CREATE_FAILED, reconnect: false });
      }
    });
  };

  /** This step's fields must be right to go on; before creating, every step's (a skipped one may hold too much text). */
  const next = () => {
    const parsed = draftSchema.safeParse(draft);
    const fieldErrors = parsed.success ? {} : toFieldErrors(parsed.error);
    const blocking = Object.keys(fieldErrors).map((field) => stepOf(field) ?? index).filter((i) => last || i === index);
    if (blocking.length > 0) {
      setErrors(fieldErrors);
      setIndex(Math.min(...blocking));
      return;
    }
    setErrors({});
    if (last) create();
    else setIndex(index + 1);
  };

  const body = {
    market: <MarketStep draft={draft} errors={errors} onChange={change} />,
    why: <WhyStep draft={draft} errors={errors} onChange={change} />,
    mustHaves: <MustHavesStep draft={draft} errors={errors} onChange={change} />,
    partners: (
      <FirstPartnersStep partners={partners} onAdd={addFirstPartner} searchPrompt={searchPrompt}
        noteFor={(partner) => firstPartnerNote(book, draft.partnerType, partner)}
        onRemove={(id) => setPartners((list) => list.filter((p) => p.id !== id))} />
    ),
  }[step.key];

  return (
    <div className="grid w-full gap-5 md:grid-cols-[12rem_minmax(0,1fr)]">
      <nav aria-label={COPY.STEPS_LABEL} className="md:pt-2">
        <p className="text-xs font-medium text-ink-3">{COPY.NEW_MARKET_STEP_OF(index + 1, STEPS.length)}</p>
        <div className="mt-2 h-1 rounded-full bg-surface-2 md:hidden">
          <div className="h-full rounded-full bg-brand" style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
        </div>
        <ol className="mt-3 hidden space-y-1 md:block">
          {STEPS.map((s, i) => (
            <li key={s.key} aria-current={i === index ? 'step' : undefined}
              className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm', i === index ? 'bg-surface font-medium text-ink' : 'text-ink-3')}>
              <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                i < index ? 'bg-brand text-on-brand' : i === index ? 'bg-brand-soft text-brand-strong' : 'bg-surface-2')}>
                {i < index ? <Check className="h-3 w-3" aria-hidden /> : i + 1}
              </span>
              {s.name}
            </li>
          ))}
        </ol>
      </nav>

      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">{step.title}</h1>
        <div className="mt-4"><Tip>{step.tip}</Tip></div>
        {failure && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-danger-soft p-3">
            <p role="alert" className="min-w-0 flex-1 text-sm text-danger">{failure.message}</p>
            {failure.reconnect && canReconnectGoogle(storage) && (
              <form action={continueWithGoogle}>
                <input type="hidden" name="next" value={`/markets/new?step=${index + 1}`} />
                <Button type="submit" variant="secondary">{COPY.RECONNECT_BUTTON}</Button>
              </form>
            )}
          </div>
        )}
        {/* Until the page has hydrated the flow is about to mount again (above), so nothing typed into it would survive. */}
        <fieldset disabled={!restore} className="m-0 min-w-0 border-0 p-0">
          <div className="mt-6">{body}</div>
          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            {index > 0 && <Button variant="ghost" onClick={() => { setErrors({}); setIndex(index - 1); }}>{COPY.BACK}</Button>}
            <div className="ml-auto flex gap-2">
              {index > 0 && !last && <Button variant="ghost" onClick={() => { setErrors({}); setIndex(index + 1); }}>{COPY.SKIP}</Button>}
              <Button variant="primary" onClick={next} disabled={pending}>{last ? (pending ? COPY.CREATING : COPY.CREATE_MARKET) : COPY.NEXT}</Button>
            </div>
          </div>
        </fieldset>
      </div>
    </div>
  );
}
