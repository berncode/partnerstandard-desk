'use client';

// The call belongs to the partner.
import { CALL_KINDS, type CallKind } from '@partner-desk/core';
import { CALL_GUIDE, TIPS, TOPICS, type Topic } from '@partner-desk/method';
import { CALL_KIND_LABELS, COPY } from '@partner-desk/copy';
import { ExternalLink } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { usePartner } from './partner-context';
import { movesToDiscoveryCall, notesTitle } from './partner-model';
import { PasteNotes, type SortedNotes } from './paste-notes';

const control =
  'w-full min-w-0 rounded-lg border bg-surface px-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30';

const emptyTopics = () => Object.fromEntries(TOPICS.map((t) => [t, ''])) as Record<Topic, string>;

/** Pasted text goes under what is already typed, never over it. */
const joined = (current: string, added: string) => (current.trim() && added ? `${current.trimEnd()}\n\n${added}` : current + added);

/** A text box with its label, an optional line of help under the label, and its error. */
function Box({ label, help, error, value, onChange, rows = 3, placeholder }: {
  label: string; help?: string; error?: string; value: string; onChange: (value: string) => void; rows?: number; placeholder?: string;
}) {
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();
  const describedBy = [help && helpId, error && errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="grid content-start gap-0.5">
      <label htmlFor={inputId} className="text-sm font-medium">{label}</label>
      {help && <p id={helpId} className="text-xs text-ink-3">{help}</p>}
      <textarea id={inputId} rows={rows} value={value} placeholder={placeholder} aria-describedby={describedBy}
        aria-invalid={error ? true : undefined} onChange={(e) => onChange(e.target.value)}
        className={cn(control, 'mt-1 py-2', error ? 'border-danger' : 'border-line')} />
      {error && <p id={errorId} className="mt-0.5 text-xs text-danger">{error}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1 text-xs font-medium text-ink-3">{label}{children}</label>;
}

/**
 * *Log a call*: a discovery call has the six topic boxes, each with what to learn, and Other notes; a follow-up call
 * has one notes box. Nothing is saved until *Save call*. `onLogged` says whether this was the first discovery call of a
 * researched partner, which offers the move to Discovery call.
 */
export function CallForm({ onClose, onLogged }: { onClose: () => void; onLogged: (offerMove: boolean) => void }) {
  const { partner, book, dispatch, today } = usePartner();
  const [date, setDate] = useState(today);
  const [kind, setKind] = useState<CallKind>('discovery');
  const [topics, setTopics] = useState(emptyTopics);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const fill = (sorted: SortedNotes) => {
    setTopics((current) => Object.fromEntries(TOPICS.map((t) => [t, joined(current[t], sorted.topics[t])])) as Record<Topic, string>);
    setNotes((current) => joined(current, sorted.notes));
    setErrors({});
  };
  const save = () => {
    const offerMove = movesToDiscoveryCall(book, partner.id, kind);
    const values = { partnerId: partner.id, date, kind, topics: kind === 'discovery' ? topics : emptyTopics(), notes };
    const outcome = dispatch({ kind: 'add', entity: 'call', values }, { label: COPY.CALL_LOGGED });
    if (!outcome.ok) return setErrors(outcome.fieldErrors ?? { _: outcome.message });
    onLogged(offerMove);
  };

  return (
    <form aria-label={COPY.NEW_CALL} noValidate className="mt-3 grid gap-4 rounded-xl border border-line p-3 sm:p-4"
      onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={COPY.FIELD_DATE}>
          <input type="date" required value={date} onChange={(e) => { setDate(e.target.value); setErrors({}); }}
            aria-invalid={errors.date ? true : undefined} className={cn(control, 'h-9 w-auto', errors.date ? 'border-danger' : 'border-line')} />
        </Field>
        <Field label={COPY.FIELD_KIND}>
          <select value={kind} onChange={(e) => setKind(e.target.value as CallKind)} className={cn(control, 'h-9 w-auto border-line')}>
            {CALL_KINDS.map((k) => <option key={k} value={k}>{CALL_KIND_LABELS[k]}</option>)}
          </select>
        </Field>
        <a href="/call-guide" target="_blank" rel="noopener"
          className="mb-2 inline-flex items-center gap-1 rounded text-sm font-medium text-brand-strong underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand">
          {COPY.OPEN_CALL_GUIDE}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      </div>
      {errors.date && <p className="-mt-2 text-xs text-danger">{errors.date}</p>}

      {kind === 'discovery' && (
        <>
          <p className="text-sm text-ink-2">{TIPS.discoveryCall}</p>
          <PasteNotes onSorted={fill} />
          <div className="grid gap-3 md:grid-cols-2">
            {TOPICS.map((t) => (
              <Box key={t} label={CALL_GUIDE[t].title} help={CALL_GUIDE[t].learn} error={errors[`topics.${t}`]} value={topics[t]}
                onChange={(value) => { setTopics({ ...topics, [t]: value }); setErrors({}); }} />
            ))}
          </div>
        </>
      )}
      <Box label={notesTitle(kind)} error={errors.notes} value={notes} rows={kind === 'discovery' ? 3 : 5}
        placeholder={kind === 'discovery' ? COPY.OTHER_NOTES_PLACEHOLDER : COPY.FOLLOW_UP_PLACEHOLDER}
        onChange={(value) => { setNotes(value); setErrors({}); }} />

      {errors._ && <p role="alert" className="text-sm text-danger">{errors._}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm">{COPY.SAVE_CALL}</Button>
        <Button variant="ghost" size="sm" onClick={onClose}>{COPY.CANCEL}</Button>
      </div>
    </form>
  );
}
