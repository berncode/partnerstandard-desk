'use client';

// The Recruitment app's Section, LearnMore, CheckAgain and ExampleLine, and its advice box. Headings: a page's name is its h1, so a section is an h2.
import { COPY } from '@partner-desk/copy';
import { ExternalLink, Lightbulb, TriangleAlert } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Button } from './button';
import { Chip } from './chip';
import { cn } from './cn';

/** A card with its heading, a line of explanation and optional actions. */
export function Section({ title, description, actions, children, className }: {
  title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn('min-w-0 rounded-xl border border-line bg-surface p-4', className)}>
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 id={id} className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Rows of facts with thin lines between them (FieldRow). */
export const FIELD_ROWS = 'divide-y divide-line';

/**
 * One fact in FIELD_ROWS: its label beside its value from 640 px, above it on a phone. With `htmlFor` the label names
 * the field it sits beside.
 */
export function FieldRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  const labelClass = 'text-[13px] text-ink-3 sm:pt-1.5';
  return (
    <div className="grid min-w-0 gap-1 py-2 first:pt-0 last:pb-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
      {htmlFor ? <label htmlFor={htmlFor} className={labelClass}>{label}</label> : <p className={labelClass}>{label}</p>}
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

/** A select sized to its options, not to the row it sits in. */
export const NARROW_SELECT = 'w-auto max-w-full sm:min-w-56';

/** A link out to a PartnerStandard guide or tool, in a new tab. */
export function LearnMore({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer"
      className="inline-flex items-center gap-1 rounded text-sm font-medium text-brand-strong underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand">
      {children}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
    </a>
  );
}

/** Advice before a move: it never blocks. *Go ahead anyway* makes the move, *Cancel* drops it. */
export function AdviceBox({ text, onGoAhead, onCancel, className }: {
  text: string; onGoAhead: () => void; onCancel: () => void; className?: string;
}) {
  return (
    <div role="alert" className={cn('flex flex-wrap items-start gap-2 rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm text-warn', className)}>
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 basis-56">{text}</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={onGoAhead}>{COPY.GO_AHEAD_ANYWAY}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{COPY.CANCEL}</Button>
      </div>
    </div>
  );
}

/** Why a button can't be used, as text under it (never only a tooltip). */
export function DisabledReason({ id, children }: { id: string; children: ReactNode }) {
  return <p id={id} className="text-xs text-ink-3">{children}</p>;
}

/** A method tip: a short hint in a soft green box (Recruitment's `Tip`). */
export function Tip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex gap-3 rounded-xl border border-brand/20 bg-brand-soft/60 p-3 text-sm text-ink-2', className)}>
      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-brand-strong" aria-hidden />
      <p>{children}</p>
    </div>
  );
}

/**
 * The "check again" marker a copied market puts on a field or row. *Checked* clears it; so does any edit. `what` names
 * the field or row for screen readers, e.g. "Statement".
 */
export function CheckAgain({ what, readOnly, onChecked }: { what: string; readOnly: boolean; onChecked: () => void }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Chip tone="warn">{COPY.CHECK_AGAIN}</Chip>
      {!readOnly && (
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" aria-label={COPY.CHECKED_NAMED(what)} onClick={onChecked}>
          {COPY.CHECKED}
        </Button>
      )}
    </span>
  );
}

/** A filled-in example from the sample market (Halden Security), next to an empty field. */
export function ExampleLine({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cn('mt-1 text-xs break-words whitespace-pre-line text-ink-3', className)}>
      <span className="font-medium">{COPY.EXAMPLE}:</span> {text}
    </p>
  );
}

/**
 * A row whose add isn't saved yet: its name and "Saving…", with no link. Until the save lands the row has only a local
 * id, which no page knows, so a link would open "not found".
 */
export function SavingName({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('block break-words', className)}>
      {children} <span className="text-xs font-normal text-ink-3">{COPY.SAVING}</span>
    </span>
  );
}
