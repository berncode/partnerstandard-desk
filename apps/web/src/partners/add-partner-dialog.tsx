'use client';

// The fields follow the Recruitment app's add form; the duplicate check is the import's (core's findSamePartner), so adding by hand and importing agree.
import { accountOf, newId, type Exclusion, type PartnerBook, type PartnerChange } from '@partner-desk/core';
import {
  RECRUITMENT_STEPS,
  STAGE_LABELS,
  STEP_LABELS,
  type PartnerType,
  type View,
} from '@partner-desk/method';
import {
  COPY,
} from '@partner-desk/copy';
import Link from 'next/link';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { marketRead } from '@/app/(signed-in)/actions/markets';
import type { Editor } from '@/editor/use-editor';
import { partnerHref } from '@/partner/partner-model';
import type { PartnerBatch } from '@/editor/remotes';
import { Button } from '@/ui/button';
import { controlClass } from '@/ui/control';
import { Dialog, DialogContent } from '@/ui/dialog';
import { PartnerTypeOptions } from './filters';
import {
  duplicateOf, isSignedWhere, marketsForType, newPartnerChanges, otherTypeMessage, placementChanges, sameTypeMessage, WHERE_STAGES,
  type MarketOption, type Where,
} from './partners-model';

type PartnerEditor = Editor<PartnerBook, PartnerChange, PartnerBatch>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  book: PartnerBook;
  markets: readonly MarketOption[];
  editor: Pick<PartnerEditor, 'apply' | 'applyMany' | 'savedIdFor'>;
  /** Called with the view the new partner is in, once it is placed. */
  onAdded: (view: View) => void;
  /** The owner's today, in their Settings time zone: the date "Signed on" starts on. */
  today: string;
}

export function AddPartnerDialog({ open, onOpenChange, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent title={COPY.ADD_PARTNER} description={COPY.ADD_PARTNER_TEXT} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <AddPartnerForm {...rest} onClose={() => onOpenChange(false)} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function Field({ label, error, hint, children, htmlFor, errorId }: {
  label: string; error?: string; hint?: string; children: ReactNode; htmlFor: string; errorId: string;
}) {
  return (
    <div className="grid gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-ink-3">{hint}</p>}
      {error && <p id={errorId} className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function AddPartnerForm({ book: current, markets, editor, onAdded, today, onClose }: Omit<Props, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const ids = { company: useId(), website: useId(), country: useId(), type: useId(), where: useId(), signed: useId(), market: useId() };
  const [company, setCompany] = useState('');
  const [website, setWebsite] = useState('');
  const [country, setCountry] = useState('');
  const [partnerType, setPartnerType] = useState<PartnerType>('reseller');
  const [where, setWhere] = useState<Where>('researched');
  const [signedDate, setSignedDate] = useState(today);
  const [marketId, setMarketId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // A save with no clear answer may be in the file: adding again could make a second record, so the adds stay off.
  const [unclear, setUnclear] = useState(false);
  // The duplicate check is against the book as it was when the dialog opened: the partner being added is not its own duplicate.
  const [book] = useState(current);
  // The chosen market's Exclusions, read once per market (`marketRead`); null when it couldn't be read.
  const [exclusions, setExclusions] = useState<Record<string, readonly Exclusion[] | null>>({});

  const offered = marketsForType(markets, partnerType);
  const market = offered.find((m) => m.marketId === marketId) ?? null;
  const chosenExclusions = market ? exclusions[market.marketId] : null;
  // Until the market's Exclusions are read, nothing is added: the warning must come first.
  const reading = market !== null && chosenExclusions === undefined;
  const duplicate = duplicateOf(book, { company, website, country, partnerType, marketId: market?.marketId ?? null }, chosenExclusions ?? []);
  const signed = isSignedWhere(where);

  useEffect(() => {
    if (!market || market.marketId in exclusions) return;
    let current = true;
    const id = market.marketId;
    marketRead(id)
      .then((read) => (read.ok ? read.snapshot.value.exclusions : null), () => null)
      .then((list) => { if (current) setExclusions((known) => ({ ...known, [id]: list })); });
    return () => { current = false; };
  }, [market, exclusions]);

  /** `anyway`: the person pressed Add anyway for a company on the market's Exclusions. Enter alone never adds one. */
  const add = async (anyway = false) => {
    // Same type never makes another section. Enter submits the form, and the Add button is hidden, so the check is here too.
    if (busy || unclear || reading || duplicate?.kind === 'same_type') return;
    if (duplicate?.kind === 'exclusion' && !anyway) return;
    const problems: Record<string, string> = {};
    if (company.trim() === '') problems.company = COPY.REQUIRED(COPY.FIELD_COMPANY);
    if (signed && signedDate === '') problems.signedDate = COPY.SIGNED_DATE_NEEDED;
    if (Object.keys(problems).length > 0) return setErrors(problems);

    const moves = (id: string) => placementChanges(id, where, signedDate);
    // Researched needs no move, so the dialog closes at once and the row shows at once. Any other place waits for the save.
    const needsMoves = where !== 'researched';
    const partnerId = newId('partner');
    // The company (or the one already here, its empty facts filled), the type and the market link: one write, so one
    // Undo takes back all of them, and a failure leaves no company without a type.
    const changes: PartnerChange[] = newPartnerChanges(book, { company, website, country }, partnerType, partnerId);
    if (market) changes.push({ kind: 'add', entity: 'marketLink', values: { partnerId, marketId: market.marketId, hypothesisId: null } });
    const partnerIndex = changes.findIndex((change) => change.kind === 'add' && change.entity === 'partner');
    // One toast. The partner's id is the one the later moves name.
    const outcome = editor.applyMany(changes, market ? { marketId: market.marketId } : {}, needsMoves ? undefined : { label: COPY.PARTNER_ADDED })
      .then((r): { ok: true; id: string | null } | { ok: false; unknown?: true } =>
        (r.ok ? { ok: true, id: r.entityIds[partnerIndex] ?? null } : { ok: false, ...(r.unknown ? { unknown: r.unknown } : {}) }));
    if (!needsMoves) {
      onAdded('potential');
      onClose();
    } else setBusy(true);
    const saved = await outcome;
    if (!needsMoves) return;
    if (saved.ok && saved.id) {
      let done = 0;
      for (const move of moves(saved.id)) {
        if (!(await editor.apply(move)).ok) break;
        done++;
      }
      const all = moves(saved.id).length;
      // Say what happened: after a failed move the partner is where the last good move left it (the editor says why).
      toast(done === all ? COPY.PARTNER_ADDED : COPY.PARTNER_ADDED_NOT_MOVED);
      onAdded(signed && done > 0 ? 'active' : 'potential');
      onClose();
    } else if (!saved.ok && saved.unknown) setUnclear(true);
    else setBusy(false);
  };

  const addToIt = async () => {
    if (duplicate?.kind !== 'same_type' || !market || unclear) return;
    setBusy(true);
    const outcome = await editor.apply(
      { kind: 'add', entity: 'marketLink', values: { partnerId: duplicate.partner.id, marketId: market.marketId, hypothesisId: null } },
      { label: COPY.MARKET_ADDED_TO_PARTNER(market.displayName) },
    );
    if (outcome.ok) onClose();
    else if (outcome.unknown) setUnclear(true);
    else setBusy(false);
  };

  const errorId = (field: string) => `${ids.company}-error-${field}`;
  const control = (field: string) => ({
    className: controlClass, 'aria-invalid': errors[field] ? true : undefined, 'aria-describedby': errors[field] ? errorId(field) : undefined,
  });
  const clear = () => setErrors({});
  const blocked = duplicate?.kind === 'same_type';
  // A partner added a moment ago has no id its page knows until its add is saved.
  const openId = duplicate?.kind === 'same_type' ? editor.savedIdFor(duplicate.partner.id) : null;

  return (
    <form className="mt-4 grid gap-3" onSubmit={(e) => { e.preventDefault(); void add(); }} aria-busy={reading || undefined}>
      <Field label={COPY.FIELD_COMPANY} htmlFor={ids.company} error={errors.company} errorId={errorId('company')}>
        <input id={ids.company} autoFocus value={company} placeholder={COPY.FIELD_COMPANY_PLACEHOLDER} {...control('company')}
          onChange={(e) => { setCompany(e.target.value); clear(); }} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={COPY.FIELD_WEBSITE} htmlFor={ids.website} errorId={errorId('website')}>
          <input id={ids.website} value={website} placeholder="https://" className={controlClass} onChange={(e) => setWebsite(e.target.value)} />
        </Field>
        <Field label={COPY.FIELD_COUNTRY} htmlFor={ids.country} errorId={errorId('country')}>
          <input id={ids.country} value={country} className={controlClass} onChange={(e) => setCountry(e.target.value)} />
        </Field>
      </div>
      <Field label={COPY.FIELD_PARTNER_TYPE} htmlFor={ids.type} errorId={errorId('type')}>
        <select id={ids.type} value={partnerType} className={controlClass}
          onChange={(e) => { setPartnerType(e.target.value as PartnerType); setMarketId(''); }}>
          <PartnerTypeOptions />
        </select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={COPY.FIELD_WHERE} htmlFor={ids.where} errorId={errorId('where')}>
          <select id={ids.where} value={where} className={controlClass} onChange={(e) => { setWhere(e.target.value as Where); clear(); }}>
            <optgroup label={STAGE_LABELS.recruitment}>
              {RECRUITMENT_STEPS.map((step) => <option key={step} value={step}>{STEP_LABELS[step]}</option>)}
            </optgroup>
            <optgroup label={COPY.WHERE_GROUP_WORKING}>
              {WHERE_STAGES.map((stage) => <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>)}
            </optgroup>
          </select>
        </Field>
        {signed && (
          <Field label={COPY.FIELD_SIGNED_ON} htmlFor={ids.signed} error={errors.signedDate} errorId={errorId('signedDate')}>
            <input id={ids.signed} type="date" value={signedDate} {...control('signedDate')} onChange={(e) => { setSignedDate(e.target.value); clear(); }} />
          </Field>
        )}
      </div>
      <Field label={COPY.FIELD_MARKET} htmlFor={ids.market} hint={COPY.MARKET_HINT} errorId={errorId('market')}>
        <select id={ids.market} value={market?.marketId ?? ''} className={controlClass} onChange={(e) => setMarketId(e.target.value)}>
          <option value="">{COPY.NO_MARKET}</option>
          {offered.map((m) => <option key={m.marketId} value={m.marketId}>{m.displayName}</option>)}
        </select>
      </Field>

      {duplicate && (
        <div role="status" className="grid gap-2 rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm text-warn">
          {duplicate.kind === 'same_type' ? (
            <>
              <p>{sameTypeMessage(duplicate)}</p>
              {duplicate.linked && market && <p>{COPY.ALREADY_IN_THIS_MARKET(market.displayName)}</p>}
              <div className="flex flex-wrap gap-2">
                {market && !duplicate.linked && (
                  <Button size="sm" variant="primary" disabled={busy || unclear} onClick={() => void addToIt()}>
                    {COPY.ADD_MARKET_TO_IT(market.displayName)}
                  </Button>
                )}
                {openId === null ? <span className="inline-flex h-8 items-center text-xs">{COPY.SAVING}</span> : (
                  <Link href={partnerHref(accountOf(book, duplicate.partner)?.id ?? openId, duplicate.partner.partnerType)}
                    className="inline-flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-2">
                    {COPY.OPEN_IT}
                  </Link>
                )}
              </div>
            </>
          ) : (
            <p>{duplicate.kind === 'other_type'
              ? otherTypeMessage(duplicate, partnerType)
              : COPY.ON_EXCLUSIONS(duplicate.company)}</p>
          )}
        </div>
      )}

      {unclear && <p role="alert" className="text-sm text-danger">{COPY.SAVE_ADD_UNKNOWN}</p>}

      <div className="mt-1 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{COPY.CANCEL}</Button>
        {!blocked && duplicate?.kind !== 'exclusion' && <Button type="submit" variant="primary" disabled={busy || unclear || reading}>{COPY.ADD}</Button>}
        {duplicate?.kind === 'exclusion' && (
          <Button variant="primary" disabled={busy || unclear} onClick={() => void add(true)}>{COPY.ADD_ANYWAY}</Button>
        )}
      </div>
    </form>
  );
}
