'use client';

// The move offered is a step, not a stage.
import type { Call } from '@partner-desk/core';
import { CALL_GUIDE, STEP_LABELS, TOPICS } from '@partner-desk/method';
import { CALL_KIND_LABELS, COPY } from '@partner-desk/copy';
import { Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { formatDate } from '@/partners/partners-model';
import { Button } from '@/ui/button';
import { InlineText } from '@/ui/inline-text';
import { Section } from '@/ui/pieces';
import { CallForm } from './call-form';
import { useAct, usePartner } from './partner-context';
import { notesTitle, partnerCalls } from './partner-model';

function CallItem({ call }: { call: Call }) {
  const { dispatch, readOnly } = usePartner();
  const act = useAct();
  /** Names only what changed, e.g. one topic: the call's other cells keep any hand edits made in the sheet. */
  const update = (patch: Record<string, unknown>) => dispatch({ kind: 'update', entity: 'call', id: call.id, patch }, { label: COPY.CALL_UPDATED });
  const day = formatDate(call.date);
  return (
    <li data-testid="call" className="rounded-lg border border-line bg-surface p-3">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm font-semibold">{`${day} · ${CALL_KIND_LABELS[call.kind]}`}</p>
        {!readOnly && (
          <Button variant="ghost" size="icon" aria-label={COPY.DELETE_CALL(day)}
            onClick={() => act({ kind: 'delete', entity: 'call', id: call.id }, { label: COPY.CALL_DELETED })}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        {call.kind === 'discovery' && TOPICS.map((t) => (
          <div key={t} className="min-w-0">
            <p className="text-xs font-semibold text-ink-3">{CALL_GUIDE[t].title}</p>
            <InlineText value={call.topics[t]} label={CALL_GUIDE[t].title} field={`topics.${t}`} multiline disabled={readOnly}
              placeholder={CALL_GUIDE[t].notePrompt} className="text-sm"
              onCommit={(text) => update({ topics: { [t]: text } })} />
          </div>
        ))}
        <div className="min-w-0 md:col-span-2">
          <p className="text-xs font-semibold text-ink-3">{notesTitle(call.kind)}</p>
          <InlineText value={call.notes} label={notesTitle(call.kind)} field="notes" multiline disabled={readOnly}
            placeholder={COPY.ANYTHING_ELSE} className="text-sm" onCommit={(notes) => update({ notes })} />
        </div>
      </div>
      {/* Who changed it last, as the MAP page shows an activity's: an agent as "Desk Agent for Ruth". A row without a name shows nothing. */}
      {call.updatedBy.trim() && <p className="mt-2 text-xs break-words text-ink-3">{COPY.CALL_LAST_UPDATED_BY(call.updatedBy.trim())}</p>}
    </li>
  );
}

/** After the first discovery call of a researched partner: the move to Discovery call, offered, never made for you. */
function MoveOffer({ onDone }: { onDone: () => void }) {
  const { account, partner } = usePartner();
  const act = useAct();
  return (
    <div role="status" className="mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-brand-soft/60 p-3 text-sm">
      <p className="min-w-0 flex-1 basis-56">{COPY.MOVE_OFFER(account.company)}</p>
      <div className="flex gap-2">
        <Button variant="primary" size="sm"
          onClick={() => {
            act({ kind: 'setStep', partnerId: partner.id, to: 'discovery_call' }, { label: COPY.MOVED_TO(STEP_LABELS.discovery_call) });
            onDone();
          }}>
          {COPY.MOVE_TO_DISCOVERY_CALL}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone}>{COPY.KEEP_IN_RESEARCHED}</Button>
      </div>
    </div>
  );
}

/** The partner's calls: *Log a call*, pasted notes, and the call guide. */
export function Calls() {
  const { partner, book, readOnly } = usePartner();
  const [logging, setLogging] = useState(false);
  const [offerMove, setOfferMove] = useState(false);
  /** Set when the form closes, so *Log a call* takes focus once it is back. */
  const refocus = useRef(false);
  const close = () => {
    refocus.current = true;
    setLogging(false);
  };
  const calls = partnerCalls(book, partner.id);
  const stillResearched = partner.step === 'researched' && partner.closed === null;
  return (
    <Section title={COPY.CALLS_TITLE} description={COPY.CALLS_TEXT}>
      {offerMove && stillResearched && !readOnly && <MoveOffer onDone={() => setOfferMove(false)} />}
      {calls.length > 0
        ? <ul className="grid gap-2">{calls.map((call) => <CallItem key={call.id} call={call} />)}</ul>
        : <p className="text-sm text-ink-3">{COPY.CALLS_EMPTY}</p>}
      {!readOnly && (logging
        ? <CallForm onClose={close} onLogged={(offer) => { setOfferMove(offer); close(); }} />
        : (
          <Button variant="ghost" size="sm" className="mt-2 -ml-2" onClick={() => setLogging(true)}
            ref={(el) => {
              if (el && refocus.current) {
                refocus.current = false;
                el.focus();
              }
            }}>
            <Plus className="h-4 w-4" aria-hidden />
            {COPY.LOG_CALL}
          </Button>
        ))}
    </Section>
  );
}
