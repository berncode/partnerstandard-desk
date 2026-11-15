'use client';

import type { WebhookDelivery, WebhookStatus } from '@partner-desk/commands';
import { WEBHOOK_EVENTS, type WebhookEvent } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { Plus } from 'lucide-react';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { Field, fieldControl } from '@/markets/fields';
import { Button } from '@/ui/button';
import { Chip, type ChipTone } from '@/ui/chip';
import { cn } from '@/ui/cn';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { CopyButton } from '@/ui/copy-button';
import { Dialog, DialogContent } from '@/ui/dialog';
import { useViewer } from '@/storage-context';
import {
  addWebhook, removeWebhook, sendWebhookAgain, sendWebhookTest, turnWebhookOff, turnWebhookOn, webhookDeliveries, type AgentsFailure,
  type WebhookView,
} from './agents-actions';
import { EmptyLine, KEEP_OPEN, SubSection, timeIn } from './agents-shared';

const STATUS: Record<WebhookStatus, { label: string; tone: ChipTone }> = {
  active: { label: COPY.WEBHOOK_STATUS_ACTIVE, tone: 'brand' },
  off: { label: COPY.WEBHOOK_STATUS_OFF, tone: 'neutral' },
  off_failing: { label: COPY.WEBHOOK_STATUS_OFF_FAILING, tone: 'danger' },
};

/** After Send test or Send again: how often, and how long apart, the deliveries are read again until each has an answer. */
const POLL_TRIES = 5;
const POLL_EVERY_MS = 2_000;

/** A thrown action is answered as one that failed. */
async function attempt<R extends { ok: true }>(work: () => Promise<R | AgentsFailure>): Promise<R | AgentsFailure> {
  try {
    return await work();
  } catch {
    return { ok: false, message: COPY.SETTINGS_WRONG };
  }
}

/**
 * The person's webhooks (agents spec 7.1): address, events, status, last deliveries with Send again on a failed one,
 * Send test, Turn off or on, Delete.
 */
export function Webhooks({ initial, timeZone }: { initial: WebhookView[]; timeZone: string }) {
  const [webhooks, setWebhooks] = useState(initial);
  const headingId = useId();
  // A company server's viewer adds no webhook, and only turns off or deletes the ones they made before (owner, 2026-11-14).
  const viewer = useViewer();
  const update = (id: string, change: Partial<WebhookView>) => setWebhooks((list) => list.map((w) => (w.id === id ? { ...w, ...change } : w)));
  return (
    <SubSection id={headingId} title={COPY.WEBHOOKS} hint={COPY.WEBHOOKS_HINT}
      action={viewer ? undefined : <AddWebhook onAdded={(webhook) => setWebhooks((list) => [...list, webhook])} />}>
      {webhooks.length === 0 ? <EmptyLine>{COPY.WEBHOOKS_NONE}</EmptyLine> : (
        <ul className="divide-y divide-line">
          {webhooks.map((webhook) => (
            <WebhookRow key={webhook.id} webhook={webhook} timeZone={timeZone} onChange={(change) => update(webhook.id, change)}
              onDeleted={() => setWebhooks((list) => list.filter((w) => w.id !== webhook.id))} />
          ))}
        </ul>
      )}
    </SubSection>
  );
}

function WebhookRow({ webhook, timeZone, onChange, onDeleted }: {
  webhook: WebhookView; timeZone: string; onChange: (change: Partial<WebhookView>) => void; onDeleted: () => void;
}) {
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [showDeliveries, setShowDeliveries] = useState(false);
  const [polling, setPolling] = useState(0);
  const [pending, startPending] = useTransition();
  const urlId = useId();
  const { id, url } = webhook;
  const status = STATUS[webhook.status];
  const on = webhook.status === 'active';
  // A company server's viewer may turn a webhook off and delete it, nothing else (`can`, plan 15; owner, 2026-11-14).
  const viewer = useViewer();
  // The list makes a new onChange on each render; the poll below keeps to the latest without starting over.
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });

  // After Send test or Send again: read the deliveries again while any shown has no answer yet, a few times at most.
  useEffect(() => {
    if (polling === 0) return;
    let stopped = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      tries += 1;
      const result = await attempt(() => webhookDeliveries(id));
      if (stopped || !result.ok) return;
      onChangeRef.current({ deliveries: result.deliveries });
      if (result.deliveries.some((d) => d.status === null) && tries < POLL_TRIES) timer = setTimeout(tick, POLL_EVERY_MS);
    };
    timer = setTimeout(tick, POLL_EVERY_MS);
    return () => { stopped = true; clearTimeout(timer); };
  }, [polling, id]);

  const sendTest = () => startPending(async () => {
    setNote(null);
    const result = await attempt(() => sendWebhookTest(id));
    if (!result.ok) { setNote({ ok: false, message: result.message }); return; }
    onChange({ deliveries: result.deliveries });
    setShowDeliveries(true);
    setNote({ ok: true, message: COPY.WEBHOOK_TEST_SENT });
    setPolling((n) => n + 1);
  });

  const sendAgain = (deliveryId: string) => startPending(async () => {
    setNote(null);
    const result = await attempt(() => sendWebhookAgain(id, deliveryId));
    if (!result.ok) { setNote({ ok: false, message: result.message }); return; }
    onChange({ deliveries: result.deliveries });
    setNote({ ok: true, message: COPY.WEBHOOK_SENT_AGAIN });
    setPolling((n) => n + 1);
  });

  const switchOnOff = () => startPending(async () => {
    setNote(null);
    if (on) {
      const result = await attempt(() => turnWebhookOff(id));
      if (result.ok) onChange({ status: result.webhook.status });
      else setNote({ ok: false, message: result.message });
      return;
    }
    // Turned on, what waited while it was off is dropped: the list shows what is kept, and the note says so.
    const result = await attempt(() => turnWebhookOn(id));
    if (!result.ok) { setNote({ ok: false, message: result.message }); return; }
    onChange({ status: result.webhook.status, deliveries: result.deliveries });
    setNote({ ok: true, message: COPY.WEBHOOK_TURNED_ON });
  });

  const remove = () => startPending(async () => {
    const result = await attempt(() => removeWebhook(id));
    setConfirming(false);
    if (result.ok) onDeleted();
    else setNote({ ok: false, message: result.message });
  });

  return (
    <li aria-labelledby={urlId} className="py-3 first:pt-0">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <p id={urlId} className="font-mono text-[13px] break-all">{url}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Chip tone={status.tone} className="whitespace-normal">{status.label}</Chip>
            <span className="min-w-0 font-mono text-xs break-all text-ink-3">{webhook.events.join(', ')}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {!viewer && <Button size="sm" aria-label={COPY.WEBHOOK_SEND_TEST_NAMED(url)} disabled={pending} onClick={sendTest}>{COPY.WEBHOOK_SEND_TEST}</Button>}
          {(on || !viewer) && (
            <Button size="sm" variant="ghost" aria-label={on ? COPY.TURN_OFF_NAMED(url) : COPY.TURN_ON_NAMED(url)} disabled={pending} onClick={switchOnOff}>
              {on ? COPY.TURN_OFF : COPY.TURN_ON}
            </Button>
          )}
          <Button size="sm" variant="danger" aria-label={COPY.WEBHOOK_DELETE_NAMED(url)} disabled={pending} onClick={() => setConfirming(true)}>
            {COPY.WEBHOOK_DELETE}
          </Button>
        </div>
      </div>
      {note && <p role={note.ok ? 'status' : 'alert'} className={cn('mt-1 text-xs', note.ok ? 'text-ink-2' : 'text-danger')}>{note.message}</p>}
      <details className="mt-2" open={showDeliveries} onToggle={(e) => setShowDeliveries(e.currentTarget.open)}>
        <summary className="cursor-pointer text-xs font-medium text-ink-2">{COPY.WEBHOOK_DELIVERIES}</summary>
        <Deliveries deliveries={webhook.deliveries} timeZone={timeZone} busy={pending} onSendAgain={on && !viewer ? sendAgain : null} />
      </details>
      <ConfirmDialog open={confirming} onOpenChange={setConfirming} busy={pending} title={COPY.WEBHOOK_DELETE_TITLE} text={COPY.WEBHOOK_DELETE_TEXT}
        action={COPY.WEBHOOK_DELETE} onConfirm={remove} />
    </li>
  );
}

function answerOf(status: number | null): { text: string; className: string } {
  if (status === null) return { text: COPY.WEBHOOK_ANSWER_WAITING, className: 'text-ink-3' };
  if (status === 0) return { text: COPY.WEBHOOK_ANSWER_NONE, className: 'text-danger' };
  return { text: String(status), className: status >= 200 && status < 300 ? 'text-brand-strong' : 'text-danger' };
}

/** A delivery not done whose last answer is a failure: no answer, or not 2xx. Given up, or waiting for its next try. */
const failed = (status: number | null): boolean => status !== null && !(status >= 200 && status < 300);

/**
 * Time, event and answer code of the last 10 deliveries. Nothing else is kept to show. A failed one of a webhook that
 * is on (`onSendAgain`) has Send again beside its answer.
 */
function Deliveries({ deliveries, timeZone, busy, onSendAgain }: {
  deliveries: WebhookDelivery[]; timeZone: string; busy: boolean; onSendAgain: ((deliveryId: string) => void) | null;
}) {
  if (deliveries.length === 0) return <p className="mt-1 text-xs text-ink-3">{COPY.WEBHOOK_DELIVERIES_NONE}</p>;
  const cell = 'px-2 py-1 text-left align-top';
  return (
    <table className="mt-1 w-full table-fixed text-xs">
      <thead className="text-ink-3">
        <tr>
          <th scope="col" className={cn(cell, 'w-[6.5rem] font-medium')}>{COPY.WEBHOOK_DELIVERY_TIME}</th>
          <th scope="col" className={cn(cell, 'font-medium')}>{COPY.WEBHOOK_DELIVERY_EVENT}</th>
          <th scope="col" className={cn(cell, onSendAgain ? 'w-[7.5rem] sm:w-[11rem]' : 'w-[5.5rem]', 'font-medium')}>{COPY.WEBHOOK_DELIVERY_ANSWER}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {deliveries.map((delivery) => {
          const answer = answerOf(delivery.status);
          const time = timeIn(delivery.at, timeZone);
          return (
            // Keyed by the event id: unique within one webhook's list, and never shown.
            <tr key={delivery.id}>
              <td className={cn(cell, 'whitespace-nowrap tabular-nums text-ink-2')}>{time}</td>
              <td className={cn(cell, 'font-mono break-all text-ink-2')}>{delivery.type}</td>
              <td className={cell}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={cn('font-medium tabular-nums', answer.className)}>{answer.text}</span>
                  {onSendAgain && failed(delivery.status) && (
                    <Button size="sm" variant="ghost" aria-label={COPY.WEBHOOK_SEND_AGAIN_NAMED(delivery.type, time)} disabled={busy}
                      onClick={() => onSendAgain(delivery.id)}>
                      {COPY.WEBHOOK_SEND_AGAIN}
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Add webhook: an https address and the events, then the signing secret, shown once with Copy. Closing the dialog
 * forgets the secret.
 */
function AddWebhook({ onAdded }: { onAdded: (webhook: WebhookView) => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ url: string; secret: string } | null>(null);
  const [pending, startPending] = useTransition();
  const secretField = useRef<HTMLInputElement>(null);
  const eventsHintId = useId();

  const change = (next: boolean) => {
    if (pending) return;
    setOpen(next);
    if (!next) {
      setUrl('');
      setEvents([]);
      setFieldErrors({});
      setError(null);
      setMade(null);
    }
  };

  const toggle = (event: WebhookEvent, picked: boolean) =>
    setEvents((list) => (picked ? WEBHOOK_EVENTS.filter((e) => e === event || list.includes(e)) : list.filter((e) => e !== event)));

  const add = () => startPending(async () => {
    setFieldErrors({});
    setError(null);
    if (events.length === 0) {
      setFieldErrors({ events: COPY.WEBHOOK_EVENTS_MISSING });
      return;
    }
    const result = await attempt(() => addWebhook(url, events));
    if (!result.ok) {
      if (result.fieldErrors && Object.keys(result.fieldErrors).length > 0) setFieldErrors(result.fieldErrors);
      else setError(result.message);
      return;
    }
    setMade({ url: result.webhook.url, secret: result.secret });
    onAdded(result.webhook);
  });

  return (
    <Dialog open={open} onOpenChange={change}>
      <Button size="sm" onClick={() => change(true)}>
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {COPY.WEBHOOK_ADD}
      </Button>
      {open && (made ? (
        <DialogContent title={COPY.WEBHOOK_MADE_TITLE} className="break-words" {...KEEP_OPEN}>
          <p className="mt-2 font-mono text-[13px] break-all text-ink-2">{made.url}</p>
          <div className="mt-3 grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <input ref={secretField} readOnly value={made.secret} aria-label={COPY.WEBHOOK_SECRET_LABEL} onFocus={(e) => e.currentTarget.select()}
                className={cn(fieldControl, 'h-9 min-w-0 flex-1 basis-56 py-0 font-mono text-xs')} />
              <CopyButton text={made.secret} onCopyFailed={() => secretField.current?.select()}>{COPY.WEBHOOK_SECRET_COPY}</CopyButton>
            </div>
            <p className="text-xs text-ink-3">{COPY.WEBHOOK_SECRET_ONCE}</p>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={() => change(false)}>{COPY.DONE}</Button>
          </div>
        </DialogContent>
      ) : (
        <DialogContent title={COPY.WEBHOOK_ADD} description={COPY.WEBHOOKS_HINT}>
          <form noValidate className="mt-3 grid gap-3" onSubmit={(event) => { event.preventDefault(); add(); }}>
            <Field label={COPY.WEBHOOK_URL_LABEL} error={fieldErrors.url} hint={COPY.WEBHOOK_URL_HINT}>
              {(describedBy) => (
                <input className={fieldControl} type="url" inputMode="url" value={url} maxLength={2048} autoComplete="off" spellCheck={false}
                  placeholder="https://" aria-describedby={describedBy} aria-invalid={fieldErrors.url ? true : undefined} onChange={(e) => setUrl(e.target.value)} />
              )}
            </Field>
            <fieldset className="grid gap-1.5" aria-describedby={fieldErrors.events ? eventsHintId : undefined}>
              <legend className="mb-1 text-xs font-medium text-ink-3">{COPY.WEBHOOK_EVENTS_LABEL}</legend>
              {WEBHOOK_EVENTS.map((event) => (
                <label key={event} className="flex cursor-pointer items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 accent-brand" checked={events.includes(event)} onChange={(e) => toggle(event, e.target.checked)} />
                  <span className="min-w-0">
                    {COPY.WEBHOOK_EVENT_TEXT[event]}
                    {' '}
                    <span className="inline-block font-mono text-xs whitespace-nowrap text-ink-3">{event}</span>
                  </span>
                </label>
              ))}
              {fieldErrors.events && <p id={eventsHintId} className="text-xs text-danger">{fieldErrors.events}</p>}
            </fieldset>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={pending} onClick={() => change(false)}>{COPY.CANCEL}</Button>
              <Button type="submit" variant="primary" disabled={pending} aria-busy={pending || undefined}>{COPY.WEBHOOK_ADD}</Button>
            </div>
          </form>
        </DialogContent>
      ))}
    </Dialog>
  );
}
