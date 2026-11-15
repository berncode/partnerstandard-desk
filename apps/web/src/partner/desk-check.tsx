'use client';

// The qualification row belongs to the partner.
import { deskRecommendation, type Recommendation, type Score, type Scores } from '@partner-desk/core';
import { FOUR_C, FOUR_C_LEVELS, type FourC } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { ProposalCard } from '@/proposals/proposal-card';
import { cardsFor, letterOf } from '@/proposals/proposal-model';
import type { CommitOutcome } from '@/ui/inline-text';
import { InlineText } from '@/ui/inline-text';
import { Section } from '@/ui/pieces';
import { ScorePicker } from '@/ui/score-picker';
import { sayIfRefused, useAct, usePartner } from './partner-context';
import { RecommendationChip } from './recommendation-chip';

/**
 * The partner's qualification row and a way to edit it. The row is made on the first edit of a note, a question or a
 * CASO answer (`add`, then `update`), so a partner nobody qualified has none. A patch names only what changed (e.g.
 * `{ deskNotes: { credibility } }`): the rest of the row, including hand edits in the sheet, stays as it is.
 */
export function useQualification() {
  const { partner, book, dispatch } = usePartner();
  const qualification = book.qualifications.find((q) => q.partnerId === partner.id) ?? null;
  const edit = (patch: Record<string, unknown>, label: string = COPY.QUALIFICATION_UPDATED): CommitOutcome => {
    let id = qualification?.id;
    if (!id) {
      const added = dispatch({ kind: 'add', entity: 'qualification', values: { partnerId: partner.id } });
      if (!added.ok) return added;
      id = added.value.qualifications.find((q) => q.id === added.entityId)?.id;
      if (!id) return { ok: false, message: COPY.QUALIFICATION_NOT_ADDED };
    }
    return dispatch({ kind: 'update', entity: 'qualification', id, patch }, { label });
  };
  return { qualification, edit };
}

/** The live advice under a set of scores: color and words, never color alone. */
function Advice({ recommendation, empty }: { recommendation: Recommendation | null; empty: string }) {
  return (
    <div aria-live="polite" className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium text-ink-2">{COPY.RECOMMENDATION}</span>
      {recommendation ? <RecommendationChip recommendation={recommendation} /> : <span className="text-ink-3">{empty}</span>}
    </div>
  );
}

/**
 * Four 0 to 3 pickers with the level descriptions as help, a short evidence note per C, and the recommendation as it
 * stands. The desk check and the confirmed check both use it.
 */
export function FourCCheck({ scores, notes, notesKey, onScore, onNote, recommendation, empty }: {
  scores: Scores;
  notes: Record<FourC, string>;
  /** Where the notes sit in the qualification row, for field errors. */
  notesKey: 'deskNotes' | 'confirmedNotes';
  /** Called with the one score that changed. */
  onScore: (c: FourC, score: Score | null) => void;
  onNote: (c: FourC, note: string) => CommitOutcome;
  recommendation: Recommendation | null;
  /** Shown in place of the recommendation while there is none. */
  empty: string;
}) {
  const { readOnly } = usePartner();
  return (
    <div className="grid gap-4">
      <ul className="grid gap-4 lg:grid-cols-2">
        {FOUR_C.map((c) => (
          <li key={c} className="grid min-w-0 content-start gap-2 rounded-lg border border-line p-3">
            <p className="text-sm font-medium">{FOUR_C_LEVELS[c].label}</p>
            <ScorePicker label={FOUR_C_LEVELS[c].label} value={scores[c]} levels={FOUR_C_LEVELS[c].levels} disabled={readOnly}
              onChange={(score) => onScore(c, score)} />
            <InlineText value={notes[c]} label={COPY.EVIDENCE_FOR(FOUR_C_LEVELS[c].label)} field={`${notesKey}.${c}`} disabled={readOnly}
              placeholder={COPY.EVIDENCE_PLACEHOLDER} className="text-sm" onCommit={(note) => onNote(c, note)} />
          </li>
        ))}
      </ul>
      <Advice recommendation={recommendation} empty={empty} />
    </div>
  );
}

export const EMPTY_NOTES: Record<FourC, string> = { customerBase: '', credibility: '', capability: '', commitment: '' };

/** An agent's 4C proposals for the open partner type, above the scores they would set (agent proposals spec 10.2). */
function DeskProposals() {
  const { partner, book, readOnly, proposals } = usePartner();
  if (!proposals) return null;
  const cards = cardsFor(proposals.views, partner.id, 'desk');
  if (cards.length === 0) return null;
  return (
    <div className="mb-3 grid gap-2">
      {cards.map((view) => (
        <ProposalCard key={view.head.id} view={view} readOnly={readOnly} timeZone={proposals.timeZone} now={proposals.now}
          onAccept={() => sayIfRefused(proposals.accept(view))}
          onAcceptSome={(pick) => sayIfRefused(proposals.accept(view, {
            letters: (pick?.itemIds ?? []).flatMap((id) => letterOf(book, id) ?? []), note: pick?.note ?? '',
          }))}
          onReject={(note) => sayIfRefused(proposals.reject(view, note))} />
      ))}
    </div>
  );
}

/** The desk check: scored from public information before any call. Empty scores are fine. An agent's proposal sits on top. */
export function DeskCheck() {
  const { partner } = usePartner();
  const act = useAct();
  const { qualification, edit } = useQualification();
  return (
    <Section title={COPY.DESK_TITLE} description={COPY.DESK_TEXT}>
      <DeskProposals />
      <FourCCheck scores={partner.desk} notes={qualification?.deskNotes ?? EMPTY_NOTES} notesKey="deskNotes"
        onScore={(c, score) => act({ kind: 'update', entity: 'partner', id: partner.id, patch: { desk: { [c]: score } } }, { label: COPY.DESK_UPDATED })}
        onNote={(c, note) => edit({ deskNotes: { [c]: note } }, COPY.DESK_UPDATED)}
        recommendation={deskRecommendation(partner.desk)} empty={COPY.DESK_EMPTY} />
    </Section>
  );
}
