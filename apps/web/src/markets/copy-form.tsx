'use client';

import { TIPS, type RecruitmentPartnerType } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { continueWithGoogle } from '@/app/sign-in/actions';
import { marketCopy } from '@/app/(signed-in)/actions/markets';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { Tip } from '@/ui/pieces';
import { Field, fieldControl, PartnerTypeSelect, partnerTypeHint } from './fields';
import { canReconnectGoogle, type StorageKind } from '@/storage-kind';

/** Picks the market to copy and names the new one. Success opens the copy. */
export function CopyForm({ sources, storage }: {
  sources: Array<{ marketId: string; displayName: string }>;
  storage: StorageKind;
}) {
  const router = useRouter();
  const [sourceId, setSourceId] = useState(sources[0]?.marketId ?? '');
  const [marketName, setMarketName] = useState('');
  const [partnerType, setPartnerType] = useState<RecruitmentPartnerType>('reseller');
  const [failure, setFailure] = useState<{ message: string; reconnect: boolean; fieldErrors: Record<string, string> } | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = failure?.fieldErrors ?? {};

  const submit = () => {
    setFailure(null);
    startTransition(async () => {
      try {
        const result = await marketCopy({ marketId: sourceId, info: { marketName, partnerType } });
        if (result.ok) router.push(`/markets/${result.entityId}`);
        else setFailure({ message: result.message, reconnect: result.error === 'auth', fieldErrors: result.fieldErrors ?? {} });
      } catch {
        setFailure({ message: COPY.COPY_FAILED, reconnect: false, fieldErrors: {} });
      }
    });
  };

  return (
    <div className="mt-6 grid gap-4">
      {failure && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-danger-soft p-3">
          <p role="alert" className="min-w-0 flex-1 text-sm text-danger">{failure.message}</p>
          {failure.reconnect && canReconnectGoogle(storage) && (
            <form action={continueWithGoogle}>
              <input type="hidden" name="next" value="/markets/copy" />
              <Button type="submit" variant="secondary">{COPY.RECONNECT_BUTTON}</Button>
            </form>
          )}
        </div>
      )}
      <form className="grid gap-4 rounded-xl border border-line bg-surface p-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Tip>{TIPS.copyMarket}</Tip>
        <Field label={COPY.FIELD_COPY_FROM}>
          {() => (
            <select className={cn(fieldControl, 'h-9 py-0')} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              {sources.map((s) => <option key={s.marketId} value={s.marketId}>{s.displayName}</option>)}
            </select>
          )}
        </Field>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field label={COPY.FIELD_NEW_MARKET} error={errors.marketName} hint={COPY.HINT_MARKET_NAME}>
            {(describedBy) => (
              <input className={cn(fieldControl, 'h-9 py-0')} value={marketName} placeholder={COPY.PLACEHOLDER_NEW_MARKET} aria-describedby={describedBy}
                aria-invalid={errors.marketName ? true : undefined} onChange={(e) => setMarketName(e.target.value)} />
            )}
          </Field>
          <Field label={COPY.COLUMN_PARTNER_TYPE} error={errors.partnerType} hint={partnerTypeHint(partnerType)}>
            {(describedBy) => <PartnerTypeSelect value={partnerType} describedBy={describedBy} onChange={setPartnerType} />}
          </Field>
        </div>
        <div className="flex justify-end border-t border-line pt-4">
          <Button type="submit" variant="primary" disabled={pending}>{pending ? COPY.COPYING : COPY.COPY_MARKET}</Button>
        </div>
      </form>
    </div>
  );
}
