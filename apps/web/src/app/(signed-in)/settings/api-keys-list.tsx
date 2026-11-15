'use client';

import type { AgentLevel } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import type { ApiKeyInfo } from '@partner-desk/platform';
import { Plus } from 'lucide-react';
import { useId, useRef, useState, useTransition } from 'react';
import { Field, fieldControl } from '@/markets/fields';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { CopyButton } from '@/ui/copy-button';
import { Dialog, DialogContent } from '@/ui/dialog';
import { createApiKey, turnOffApiKey } from './agents-actions';
import { dayIn, EmptyLine, Facts, KEEP_OPEN, lastUsed, LEVEL_LABEL, MAX_KEY_NAME, SubSection } from './agents-shared';

const LEVELS: Array<{ level: AgentLevel; text: string }> = [
  { level: 'read', text: COPY.AGENT_LEVEL_READ_TEXT },
  { level: 'change', text: COPY.AGENT_LEVEL_CHANGE_TEXT },
  { level: 'propose', text: COPY.AGENT_LEVEL_PROPOSE_TEXT },
];

/**
 * The person's API keys that are on: name, first characters, level, dates, how many of its proposals wait, and Turn off
 * (asked first); Create key.
 */
export function ApiKeys({ initial, personName, timeZone, waiting, levels = ['read', 'change', 'propose'] }: {
  initial: ApiKeyInfo[]; personName: string; timeZone: string; waiting: (key: ApiKeyInfo) => string[];
  /** The levels a new key may have: a company server's viewer gets "Read only" alone (plan 15). */
  levels?: readonly AgentLevel[];
}) {
  const [keys, setKeys] = useState(initial);
  const [confirming, setConfirming] = useState<ApiKeyInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startPending] = useTransition();
  const headingId = useId();

  const turnOff = (key: ApiKeyInfo) => startPending(async () => {
    setError(null);
    try {
      const result = await turnOffApiKey(key.id);
      if (result.ok) setKeys(result.keys);
      else setError(result.message);
    } catch {
      setError(COPY.SETTINGS_WRONG);
    }
    setConfirming(null);
  });

  return (
    <SubSection id={headingId} title={COPY.API_KEYS} hint={COPY.API_KEYS_HINT} action={<CreateKey personName={personName} levels={levels} onCreated={setKeys} />}>
      {keys.length === 0 ? <EmptyLine>{COPY.API_KEYS_NONE}</EmptyLine> : (
        <ul className="divide-y divide-line">
          {keys.map((key) => <KeyRow key={key.id} apiKey={key} timeZone={timeZone} waiting={waiting(key)} disabled={pending} onTurnOff={() => setConfirming(key)} />)}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <ConfirmDialog open={confirming !== null} onOpenChange={(open) => { if (!open) setConfirming(null); }} busy={pending}
        title={COPY.TURN_OFF_TITLE(confirming?.name ?? '')} text={COPY.API_KEY_TURN_OFF_TEXT} action={COPY.TURN_OFF}
        onConfirm={() => { if (confirming) turnOff(confirming); }} />
    </SubSection>
  );
}

function KeyRow({ apiKey, timeZone, waiting, disabled, onTurnOff }: {
  apiKey: ApiKeyInfo; timeZone: string; waiting: string[]; disabled: boolean; onTurnOff: () => void;
}) {
  const nameId = useId();
  return (
    <li aria-labelledby={nameId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0">
      <div className="min-w-0 flex-1 basis-48">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span id={nameId} className="min-w-0 truncate text-sm font-medium">{apiKey.name}</span>
          <code className="font-mono text-xs text-ink-3">{`${apiKey.prefix}…`}</code>
        </p>
        <Facts items={[LEVEL_LABEL[apiKey.level], COPY.AGENTS_CREATED_ON(dayIn(apiKey.createdAt, timeZone)), lastUsed(apiKey.lastUsedAt, timeZone), ...waiting]} />
      </div>
      <Button size="sm" variant="ghost" aria-label={COPY.TURN_OFF_NAMED(apiKey.name)} disabled={disabled} onClick={onTurnOff}>{COPY.TURN_OFF}</Button>
    </li>
  );
}

/**
 * Create key: a name and a level, then the key, shown once with Copy. Closing the dialog forgets the key: it is never
 * kept after that, and the list shows only its first characters.
 */
function CreateKey({ personName, levels, onCreated }: {
  personName: string; levels: readonly AgentLevel[]; onCreated: (keys: ApiKeyInfo[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [level, setLevel] = useState<AgentLevel>('read');
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ name: string; key: string } | null>(null);
  const [pending, startPending] = useTransition();
  const keyField = useRef<HTMLInputElement>(null);

  const change = (next: boolean) => {
    if (pending) return;
    setOpen(next);
    if (!next) {
      setName('');
      setLevel('read');
      setNameError(null);
      setError(null);
      setMade(null);
    }
  };

  const create = () => startPending(async () => {
    setNameError(null);
    setError(null);
    try {
      const result = await createApiKey(name, level);
      if (!result.ok) {
        if (result.fieldErrors?.name) setNameError(result.fieldErrors.name);
        else setError(result.message);
        return;
      }
      setMade({ name: name.trim(), key: result.key });
      onCreated(result.keys);
    } catch {
      setError(COPY.SETTINGS_WRONG);
    }
  });

  return (
    <Dialog open={open} onOpenChange={change}>
      <Button size="sm" onClick={() => change(true)}>
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {COPY.API_KEY_CREATE}
      </Button>
      {open && (made ? (
        <DialogContent title={COPY.API_KEY_MADE_TITLE} {...KEEP_OPEN}>
          <div className="mt-3 grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <input ref={keyField} readOnly value={made.key} aria-label={COPY.API_KEY_FIELD(made.name)} onFocus={(e) => e.currentTarget.select()}
                className={cn(fieldControl, 'h-9 min-w-0 flex-1 basis-56 py-0 font-mono text-xs')} />
              <CopyButton text={made.key} onCopyFailed={() => keyField.current?.select()}>{COPY.API_KEY_COPY}</CopyButton>
            </div>
            <p className="text-xs text-ink-3">{COPY.API_KEY_ONCE}</p>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={() => change(false)}>{COPY.DONE}</Button>
          </div>
        </DialogContent>
      ) : (
        <DialogContent title={COPY.API_KEY_CREATE} description={COPY.API_KEYS_HINT}>
          <form noValidate className="mt-3 grid gap-3" onSubmit={(event) => { event.preventDefault(); create(); }}>
            <Field label={COPY.API_KEY_NAME} error={nameError ?? undefined} hint={COPY.API_KEY_NAME_HINT(personName)}>
              {(describedBy) => (
                <input className={fieldControl} value={name} maxLength={MAX_KEY_NAME} autoComplete="off" aria-describedby={describedBy}
                  aria-invalid={nameError ? true : undefined} onChange={(e) => setName(e.target.value)} />
              )}
            </Field>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-medium text-ink-3">{COPY.AGENT_ALLOW_LEVEL}</legend>
              {LEVELS.filter((option) => levels.includes(option.level)).map(({ level: value, text }) => (
                <label key={value}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line p-2.5 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                  <input type="radio" name="api-key-level" value={value} checked={level === value} onChange={() => setLevel(value)} className="mt-1 accent-brand" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{LEVEL_LABEL[value]}</span>
                    <span className="block text-[13px] text-ink-3">{text}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={pending} onClick={() => change(false)}>{COPY.CANCEL}</Button>
              <Button type="submit" variant="primary" disabled={pending} aria-busy={pending || undefined}>{COPY.API_KEY_CREATE}</Button>
            </div>
          </form>
        </DialogContent>
      ))}
    </Dialog>
  );
}
