'use client';

// Agents' proposals on the market page (agent proposals spec 10.2), each next to what it changes: a market status
// proposal beside Status in the header, a hypothesis status proposal on its hypothesis, and a new partners proposal
// above the pipeline, whose "Review the companies" opens the import preview filled with them.
import { marketDisplayName, proposalTable, type ParsedTable, type ProposalItem, type ProposalView } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { ProposalCard } from '@/proposals/proposal-card';
import { proposalWhat } from '@/proposals/proposal-model';
import { sayIfRefused } from '@/partner/partner-context';
import { useChangeLogOffer } from './change-log-offer';
import { useMarket } from './market-context';

/** What the import preview needs from a new partners proposal: its companies as a table, and who proposed them. */
export interface CompaniesProposal { proposalId: string; table: ParsedTable; hypothesisId: string | null }

/** The waiting status cards of one place: the market's status (no `hypothesisId`), or one hypothesis's. */
export function StatusProposals({ hypothesisId }: { hypothesisId?: string }) {
  const { proposals, readOnly } = useMarket();
  const offer = useChangeLogOffer();
  if (!proposals) return null;
  const kind = hypothesisId === undefined ? 'marketStatus' : 'hypothesisStatus';
  const views = proposals.views.filter((v) => v.head.kind === kind && (hypothesisId === undefined || v.target.hypothesisId === hypothesisId));
  if (views.length === 0) return null;
  return (
    <div className="grid gap-2">
      {views.map((view) => (
        <ProposalCard key={view.head.id} view={view} timeZone={proposals.timeZone} now={proposals.now} readOnly={readOnly}
          onAccept={() => sayIfRefused(proposals.accept(view, offer))}
          onReject={(note) => sayIfRefused(proposals.reject(view, note))} />
      ))}
    </div>
  );
}

/** The companies of a new partners proposal, as the import preview's table (row i is the proposal's company i). */
export function companiesOf(view: ProposalView, items: readonly ProposalItem[]): CompaniesProposal {
  const own = items.filter((i) => i.proposalId === view.head.id);
  return { proposalId: view.head.id, table: proposalTable(own), hypothesisId: view.target.hypothesisId };
}

/** The new partners proposals above the pipeline: how many companies, for which hypothesis or market, and the agent's reason. */
export function CompaniesProposals({ onReview, reviewing = null }: {
  onReview: (proposal: CompaniesProposal) => void;
  /** The proposal whose companies the import preview shows, if any. */
  reviewing?: string | null;
}) {
  const { proposals, readOnly, book, market } = useMarket();
  if (!proposals) return null;
  const views = proposals.views.filter((v) => v.head.kind === 'partners');
  if (views.length === 0) return null;
  return (
    <div className="mb-4 grid gap-2">
      {views.map((view) => {
        const hypothesis = market.hypotheses.find((h) => h.id === view.target.hypothesisId);
        const forWhat = hypothesis?.name.trim() || view.about || marketDisplayName(market.info);
        return (
          <ProposalCard key={view.head.id} view={view} timeZone={proposals.timeZone} now={proposals.now} readOnly={readOnly}
            acceptLabel={COPY.PROPOSAL_REVIEW_COMPANIES} asking={reviewing === view.head.id}
            body={<p className="font-medium break-words">{proposalWhat(view, forWhat)}</p>}
            onAccept={() => onReview(companiesOf(view, book.proposalItems))}
            onReject={(note) => sayIfRefused(proposals.reject(view, note))} />
        );
      })}
    </div>
  );
}
