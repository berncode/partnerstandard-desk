'use client';

// Agents' proposals whose place on the page is gone (agent proposals spec 10.2): a partner type removed since, or a
// hypothesis deleted since. They sit at the top of the page, so the person can still answer them: the card says why it
// can't apply any more and offers Reject only.
import type { ProposalView } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { sayIfRefused } from '@/partner/partner-context';
import { ProposalCard } from './proposal-card';

export function GoneProposals({ views, timeZone, now, readOnly, onReject }: {
  views: readonly ProposalView[];
  timeZone: string;
  now: string;
  readOnly: boolean;
  onReject: (view: ProposalView, note: string) => { ok: boolean };
}) {
  if (views.length === 0) return null;
  return (
    <div className="grid gap-2">
      {views.map((view) => (
        <ProposalCard key={view.head.id} view={view} timeZone={timeZone} now={now} readOnly={readOnly}
          // Never offered: a proposal whose target is gone can't apply. Should one still come here, it says why.
          onAccept={() => sayIfRefused({ ok: false, message: view.cannot ?? COPY.GONE })}
          onReject={(note) => onReject(view, note)} />
      ))}
    </div>
  );
}
