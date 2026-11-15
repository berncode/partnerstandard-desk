import { levelsWithinRole } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import { askedScopes, levelsOffered, returnAddress, verifyAllowQuery } from '@partner-desk/platform';
import { redirect } from 'next/navigation';
import { agentGrants, currentOwner, getAuth } from '@/server/runtime';
import { answerAgent } from './actions';
import { AllowForm } from './allow-form';

/** The request as the provider signed it, back into one query string (every value of a repeated name kept). */
function queryOf(params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(name, one);
  }
  return query.toString();
}

/**
 * The allow page's question. Request data (the address, the session) is read only here, inside Suspense. A request
 * that isn't signed, has run out, names no registered app, asks for no level, or whose return address can't be read
 * or isn't one the app registered, gets no Allow: the page never asks without saying where the app sends you back.
 */
export async function Question({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const oauthQuery = queryOf(await searchParams);
  const session = await currentOwner();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/oauth/allow?${oauthQuery}`)}`);
  const asked = new URLSearchParams(oauthQuery);
  const valid = await verifyAllowQuery(getAuth(), oauthQuery);
  const app = valid ? await agentGrants().app(asked.get('client_id') ?? '') : null;
  const returnTo = app ? returnAddress(asked.get('redirect_uri'), app.redirectUris) : null;
  // A viewer is offered "Read only" alone (plan 15): their agent can't do more.
  const levels = levelsWithinRole(levelsOffered(askedScopes(oauthQuery)), session.member?.role);
  if (app === null || returnTo === null || levels.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface p-4">
        <h1 className="text-lg font-semibold tracking-tight">{COPY.AGENT_ALLOW_INVALID_TITLE}</h1>
        <p className="mt-1 text-[13px] text-ink-2">{COPY.AGENT_ALLOW_INVALID}</p>
      </div>
    );
  }
  return (
    <AllowForm appName={app.name || COPY.AGENT_FALLBACK_NAME} returnTo={returnTo} personName={session.owner.displayName} levels={levels}
      oauthQuery={oauthQuery} answer={answerAgent} />
  );
}
