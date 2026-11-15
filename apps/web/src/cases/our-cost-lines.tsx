'use client';

import { X } from 'lucide-react';
import { useId } from 'react';
import type { CaseIssue as Issue, CostLine, Currency, OurCostLine } from '@partner-desk/core';
import { fieldControl } from '@/programs/field';
import { MoneyInput } from '@/programs/money-input';
import { useViewer } from '@/storage-context';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { issueAt, messagesUnder } from './issues';
import { SourceOptions } from './source-select';

const newCostId = () => `cost_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;

type When = CostLine['when'];

const MAX_LINES = 20;

/** The group texts. PartnerStandard Desk names the higher level as the case does (`offer.levels.preferred`), where the app wrote Preferred. */
const groupTexts = (higher: string): Record<When, { title: string; caption: string; add: string }> => ({
  start: { title: 'To get started', caption: 'Paid once, in year 1', add: 'Add a cost to get started' },
  yearly: { title: 'Every year', caption: 'From year 1 on', add: 'Add a cost every year' },
  preferred: { title: `When ${higher}`, caption: `Every year as a ${higher} partner`, add: `Add a cost when ${higher}` },
});

/** The cost groups shown: When Preferred only while the offer has Preferred conditions. */
export const costGroups = (preferredOn: boolean): When[] => (preferredOn ? ['start', 'yearly', 'preferred'] : ['start', 'yearly']);

/** The paths of the When Preferred lines in `lines`, a list at `prefix` (`costs.3`): hidden when Preferred goes off. */
export const preferredLinePaths = (lines: CostLine[], prefix: string): string[] =>
  lines.flatMap((line, i) => (line.when === 'preferred' ? [`${prefix}.${i}`] : []));

/** Text inputs and selects: the height of the number inputs, so a row lines up. */
const control = cn(fieldControl, 'h-9 py-0 aria-invalid:border-danger');
/**
 * A cost line: name, amount, source and Remove side by side where a name like "Free licences for the partner’s own use"
 * fits (the prototype's `.crow.src`). In a narrower card (a phone, our case's input column) the name gets the whole line
 * with Remove, and the amount and source go under it.
 */
const ROW = 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] items-center gap-1.5 @min-[440px]:grid-cols-[minmax(0,1fr)_112px_104px_28px]';

/**
 * Our cost lines, each with where its amount comes from, in their groups (`groups`, in order). Lines of a group not
 * shown are kept as they are. `issues` are relative to the list (`0.name`). Used for the standard offer's default cost
 * lines and, in our case, for our costs and the costs of doing it alone.
 */
export function OurCostLinesForm({ lines, onChange, issues, groups, currency, higher = 'Preferred' }: {
  lines: OurCostLine[]; onChange: (lines: OurCostLine[]) => void; issues: Issue[]; groups: When[]; currency: Currency;
  /** The name of the higher level. */
  higher?: string;
}) {
  const id = useId();
  // A company server's viewer reads the lines, with no Add a cost or Remove (owner, 2026-11-14).
  const viewer = useViewer();
  const GROUP = groupTexts(higher);
  const setLine = (lineId: string, patch: Partial<OurCostLine>) => onChange(lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)));
  const add = (when: When) => onChange([...lines, { id: newCostId(), name: 'New cost', when, amount: 1000, source: 'assumption' }]);
  const remove = (lineId: string) => onChange(lines.filter((l) => l.id !== lineId));

  return (
    <div className="@container">
      {groups.map((when) => {
        const { title, caption, add: addLabel } = GROUP[when];
        const headingId = `${id}-${when}`;
        const shown = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.when === when);
        return (
          <div key={when} role="group" aria-labelledby={headingId} className="mt-3.5 first:mt-0">
            <h3 className="mb-1.5 text-[12.5px] font-semibold text-ink-2">
              <span id={headingId}>{title}</span>
              <span className="font-normal text-ink-3">{` · ${caption}`}</span>
            </h3>
            {shown.map(({ line, index }, n) => {
              const name = `${title}, line ${n + 1}`;
              const rowIssues = messagesUnder(issues, String(index));
              const issueId = rowIssues.length > 0 ? `${id}-${line.id}-issues` : undefined;
              return (
                <div key={line.id} className="mb-1.5">
                  <div className={ROW}>
                    <input id={`${id}-${line.id}-name`} aria-label={name} className={cn(control, 'col-span-2 @min-[440px]:col-span-1')} value={line.name}
                      maxLength={80} aria-invalid={issueAt(issues, `${index}.name`) ? true : undefined} aria-describedby={issueId}
                      onChange={(e) => setLine(line.id, { name: e.target.value })} />
                    <MoneyInput id={`${id}-${line.id}-amount`} label={`${name} amount`} labelHidden currency={currency} value={line.amount}
                      className="row-start-2 @min-[440px]:row-start-auto"
                      invalid={Boolean(issueAt(issues, `${index}.amount`))} describedBy={issueId} onChange={(amount) => setLine(line.id, { amount })} />
                    <select id={`${id}-${line.id}-source`} aria-label={`${name} source`} className={cn(control, 'row-start-2 text-[12.5px] @min-[440px]:row-start-auto')}
                      value={line.source} onChange={(e) => setLine(line.id, { source: e.target.value as OurCostLine['source'] })}>
                      <SourceOptions />
                    </select>
                    {!viewer && (
                      <Button variant="ghost" size="icon"
                        className="col-start-3 row-start-1 h-9 w-7 text-ink-3 hover:bg-transparent hover:text-danger @min-[440px]:col-start-auto @min-[440px]:row-start-auto"
                        aria-label={`Remove ${line.name.trim() || `line ${n + 1}`}`} onClick={() => remove(line.id)}>
                        <X aria-hidden className="size-4" />
                      </Button>
                    )}
                  </div>
                  {issueId && <p id={issueId} className="mt-1 text-xs text-danger">{rowIssues.join(' ')}</p>}
                </div>
              );
            })}
            {!viewer && <Button size="sm" aria-label={addLabel} disabled={lines.length >= MAX_LINES} onClick={() => add(when)}>Add a cost</Button>}
          </div>
        );
      })}
      {issueAt(issues, '') && <p className="mt-1 text-xs text-danger">{issueAt(issues, '')}</p>}
    </div>
  );
}
