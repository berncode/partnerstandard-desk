'use client';

import type { AgentLevel } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import type { ReturnAddress } from '@partner-desk/platform';
import { useActionState } from 'react';
import { Button } from '@/ui/button';

/** What the form shows after an answer that didn't go through; null before. */
export type AllowState = { message: string } | null;

const LEVELS: Record<AgentLevel, { label: string; text: string }> = {
  read: { label: COPY.AGENT_LEVEL_READ, text: COPY.AGENT_LEVEL_READ_TEXT },
  change: { label: COPY.AGENT_LEVEL_CHANGE, text: COPY.AGENT_LEVEL_CHANGE_TEXT },
  propose: { label: COPY.AGENT_LEVEL_PROPOSE, text: COPY.AGENT_LEVEL_PROPOSE_TEXT },
};

/** Marks where the address goes in the copy, so it can be set apart from the words around it. */
const MARK = '\u0000';

/**
 * The allow page's question (agents spec 4.3, 10): which app asks, where it sends the person back (a web address's
 * host, or an app on this device by its scheme, set apart in a fixed-width font so a look-alike stands out), what it
 * can do at each level, that it acts in the person's name and can be turned off in Settings. The first level offered
 * (Read only) is picked. Allow and Cancel post the same form; `answer` is the action (a server action on the page).
 */
export function AllowForm({ appName, returnTo, personName, levels, oauthQuery, answer }: {
  appName: string; returnTo: ReturnAddress; personName: string; levels: AgentLevel[]; oauthQuery: string;
  answer: (previous: AllowState, formData: FormData) => Promise<AllowState>;
}) {
  const [state, action, pending] = useActionState(answer, null);
  const [shown, line] = returnTo.kind === 'web'
    ? [returnTo.host, COPY.AGENT_ALLOW_RETURN(MARK)]
    : [returnTo.scheme, COPY.AGENT_ALLOW_RETURN_APP(MARK)];
  const [before, after] = line.split(MARK);
  return (
    <form action={action} className="rounded-xl border border-line bg-surface p-4">
      <h1 className="text-lg font-semibold tracking-tight break-words">{COPY.AGENT_ALLOW_TITLE(appName)}</h1>
      <p className="mt-1 text-[13px] text-ink-2">
        {before}<strong className="font-mono font-semibold break-all text-ink">{shown}</strong>{after}
      </p>
      <p className="mt-1 text-[13px] text-ink-2">{COPY.AGENT_ALLOW_TEXT(personName)}</p>
      <input type="hidden" name="oauth_query" value={oauthQuery} />
      <fieldset className="mt-4 space-y-2">
        <legend className="mb-1.5 text-[13px] text-ink-3">{COPY.AGENT_ALLOW_LEVEL}</legend>
        {levels.map((level, index) => (
          <label key={level}
            className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line p-2.5 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
            <input type="radio" name="level" value={level} defaultChecked={index === 0} className="mt-1 accent-brand" />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{LEVELS[level].label}</span>
              <span className="block text-[13px] text-ink-3">{LEVELS[level].text}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {state && <p role="alert" className="mt-3 rounded-lg bg-danger-soft p-2.5 text-sm text-danger">{state.message}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="submit" name="answer" value="allow" variant="primary" disabled={pending} aria-busy={pending}>{COPY.AGENT_ALLOW}</Button>
        <Button type="submit" name="answer" value="cancel" variant="ghost" disabled={pending}>{COPY.CANCEL}</Button>
      </div>
    </form>
  );
}
