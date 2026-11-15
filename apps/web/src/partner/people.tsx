'use client';

// People belong to the partner.
import { activeSellerCount, PERSON_ROLES, type Person, type PersonRole } from '@partner-desk/core';
import { COPY, PERSON_ROLE_LABELS } from '@partner-desk/copy';
import { Plus, Trash2 } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { controlClass } from '@/ui/control';
import { InlineText } from '@/ui/inline-text';
import { Section } from '@/ui/pieces';
import { sayIfRefused, useAct, usePartner } from './partner-context';

const control = cn(controlClass, 'disabled:opacity-70');

/** An empty email is no email. */
const emailOf = (value: string) => value.trim() || null;

function PersonItem({ person }: { person: Person }) {
  const { dispatch, readOnly } = usePartner();
  const act = useAct();
  const update = (patch: Partial<Person>) =>
    dispatch({ kind: 'update', entity: 'person', id: person.id, patch }, { label: COPY.PERSON_UPDATED });
  // Only sellers can be active sellers.
  const setRole = (role: PersonRole) => update(role === 'seller' ? { role } : { role, activeSeller: false });

  return (
    <li className="px-3 py-2">
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-x-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_15rem] lg:items-center">
          <InlineText value={person.name} label={COPY.FIELD_NAME} field="name" disabled={readOnly} className="text-sm font-medium"
            onCommit={(name) => update({ name })} />
          <InlineText value={person.title} label={COPY.FIELD_TITLE} field="title" disabled={readOnly} placeholder={COPY.FIELD_TITLE}
            className="text-sm text-ink-2" onCommit={(title) => update({ title })} />
          <InlineText value={person.email ?? ''} label={COPY.FIELD_EMAIL} field="email" disabled={readOnly} placeholder={COPY.FIELD_EMAIL}
            className="text-sm text-ink-2" onCommit={(email) => update({ email: emailOf(email) })} />
          <div className="flex flex-wrap items-center gap-3">
            <select aria-label={COPY.FIELD_ROLE} value={person.role} disabled={readOnly} className={cn(control, 'h-7 w-auto')}
              onChange={(e) => sayIfRefused(setRole(e.target.value as PersonRole))}>
              {PERSON_ROLES.map((role) => <option key={role} value={role}>{PERSON_ROLE_LABELS[role]}</option>)}
            </select>
            {person.role === 'seller' && (
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={person.activeSeller} disabled={readOnly} className="h-4 w-4 accent-brand-strong"
                  onChange={(e) => sayIfRefused(update({ activeSeller: e.target.checked }))} />
                {COPY.ACTIVE_SELLER}
              </label>
            )}
          </div>
        </div>
        {!readOnly && (
          <Button variant="ghost" size="icon" className="h-7 w-7 text-ink-3" aria-label={COPY.DELETE_NAMED(person.name)}
            onClick={() => act({ kind: 'delete', entity: 'person', id: person.id }, { label: COPY.PERSON_DELETED })}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    </li>
  );
}

/** *Add person*: name, title, email and role. Escape or Cancel closes it. */
function AddPerson({ onClose }: { onClose: () => void }) {
  const { account, dispatch } = usePartner();
  const [draft, setDraft] = useState({ name: '', title: '', email: '', role: 'contact' as PersonRole });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const formId = useId();
  const set = (patch: Partial<typeof draft>) => { setDraft({ ...draft, ...patch }); setErrors({}); };

  const add = () => {
    const values = { accountId: account.id, name: draft.name, title: draft.title, email: emailOf(draft.email), role: draft.role };
    const outcome = dispatch({ kind: 'add', entity: 'person', values }, { label: COPY.PERSON_ADDED });
    if (!outcome.ok) return setErrors(outcome.fieldErrors ?? { name: outcome.message });
    onClose();
  };
  const field = (key: 'name' | 'title' | 'email', label: string, input: ReactNode) => (
    <label className="grid gap-1 text-xs font-medium text-ink-3">
      {label}
      {input}
      {errors[key] && <span id={`${formId}-${key}`} className="font-normal text-danger">{errors[key]}</span>}
    </label>
  );
  const textInput = (key: 'name' | 'title' | 'email') => (
    <input autoFocus={key === 'name'} type={key === 'email' ? 'email' : 'text'} value={draft[key]} className={control}
      aria-invalid={errors[key] ? true : undefined} aria-describedby={errors[key] ? `${formId}-${key}` : undefined}
      onChange={(e) => set({ [key]: e.target.value })} />
  );

  return (
    <form aria-label={COPY.NEW_PERSON} noValidate className="mt-3 grid gap-2 rounded-xl bg-surface-2/60 p-3 sm:grid-cols-2"
      onSubmit={(e) => { e.preventDefault(); add(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      {field('name', COPY.FIELD_NAME, textInput('name'))}
      {field('title', COPY.FIELD_TITLE, textInput('title'))}
      {field('email', COPY.FIELD_EMAIL, textInput('email'))}
      <label className="grid gap-1 text-xs font-medium text-ink-3">
        {COPY.FIELD_ROLE}
        <select value={draft.role} className={control} onChange={(e) => set({ role: e.target.value as PersonRole })}>
          {PERSON_ROLES.map((role) => <option key={role} value={role}>{PERSON_ROLE_LABELS[role]}</option>)}
        </select>
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="primary" size="sm">{COPY.ADD}</Button>
        <Button variant="ghost" size="sm" onClick={onClose}>{COPY.CANCEL}</Button>
      </div>
    </form>
  );
}

/** The people on the partner's side: contacts, sponsors and sellers. Active sellers answer recruitment question 3. */
export function People() {
  const { account, book, readOnly } = usePartner();
  const [adding, setAdding] = useState(false);
  /** Set when the form closes, so *Add person* takes focus once it is back. */
  const refocus = useRef(false);
  const close = () => {
    refocus.current = true;
    setAdding(false);
  };
  const people = book.people.filter((p) => p.accountId === account.id);
  return (
    <Section title={COPY.PEOPLE_TITLE} description={COPY.PEOPLE_TEXT}
      actions={<span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-ink-2">{COPY.ACTIVE_SELLERS(activeSellerCount(book, account.id))}</span>}>
      {people.length > 0
        ? <ul className="divide-y divide-line rounded-lg border border-line">{people.map((person) => <PersonItem key={person.id} person={person} />)}</ul>
        : <p className="text-sm text-ink-3">{COPY.PEOPLE_EMPTY}</p>}
      {!readOnly && (adding
        ? <AddPerson onClose={close} />
        : (
          <Button variant="ghost" size="sm" className="mt-2 -ml-2" onClick={() => setAdding(true)}
            ref={(el) => {
              if (el && refocus.current) {
                refocus.current = false;
                el.focus();
              }
            }}>
            <Plus className="h-4 w-4" aria-hidden />
            {COPY.ADD_PERSON}
          </Button>
        ))}
    </Section>
  );
}
