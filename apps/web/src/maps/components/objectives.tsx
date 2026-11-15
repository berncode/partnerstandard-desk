'use client';

// The objectives, in COPY's words.
import type { Objective, Side } from '@partner-desk/core';
import { exampleObjectives } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { Trash2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { SideDot } from '../badges';
import { objectivesTitle } from '../format';
import { AddInline, Section, Suggestions } from '../pieces';
import { InlineText } from './inline-text';
import { usePlan } from './plan-context';

export function ObjectivesSection() {
  const { names } = usePlan();
  return (
    <Section title={COPY.MAP_OBJECTIVES} description={COPY.MAP_OBJECTIVES_TEXT}>
      <div className="grid gap-3 md:grid-cols-2">
        <ObjectiveColumn side="us" title={objectivesTitle('us', names)} />
        <ObjectiveColumn side="partner" title={objectivesTitle('partner', names)} />
      </div>
    </Section>
  );
}

function ObjectiveColumn({ side, title }: { side: Side; title: string }) {
  const { plan, dispatch, allowed } = usePlan();
  const objectives = plan.objectives.filter((o) => o.side === side);
  const canAdd = allowed({ kind: 'add', entity: 'objective', values: { side, statement: '' } });
  const add = (statement: string) => dispatch({ kind: 'add', entity: 'objective', values: { side, statement } }, { label: COPY.MAP_CHANGED.objectiveAdded });

  return (
    <div className="min-w-0 rounded-xl bg-surface-2/60 p-3" data-testid={`objectives-${side}`}>
      <h3 className="mb-2 flex min-w-0 items-center gap-2 text-sm font-semibold">
        <SideDot side={side} />
        <span className="truncate">{title}</span>
      </h3>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface empty:hidden">
        {objectives.map((objective) => <ObjectiveItem key={objective.id} objective={objective} />)}
      </ul>
      {objectives.length === 0 && (
        canAdd
          ? <Suggestions title={COPY.MAP_START_FROM_EXAMPLE} items={exampleObjectives(plan.info.partnerType)[side]} onPick={add} />
          : <p className="text-sm text-ink-3">{COPY.MAP_NO_OBJECTIVES}</p>
      )}
      {canAdd && <AddInline label={COPY.MAP_ADD_OBJECTIVE} placeholder={COPY.MAP_OBJECTIVE_PLACEHOLDER} field="statement" onAdd={add} />}
    </div>
  );
}

function ObjectiveItem({ objective }: { objective: Objective }) {
  const { dispatch, allowed } = usePlan();
  const editable = allowed({ kind: 'update', entity: 'objective', id: objective.id, patch: { statement: '' } });
  const deletable = allowed({ kind: 'delete', entity: 'objective', id: objective.id });
  const update = (patch: Partial<Objective>) =>
    dispatch({ kind: 'update', entity: 'objective', id: objective.id, patch }, { label: COPY.MAP_CHANGED.objectiveUpdated });

  return (
    <li className="px-3 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <InlineText value={objective.statement} label={COPY.MAP_OBJECTIVE} field="statement" multiline disabled={!editable}
            className="text-sm font-medium" onCommit={(statement) => update({ statement })} />
          <InlineText value={objective.successMeasure} label={COPY.MAP_SUCCESS_MEASURE} field="successMeasure" placeholder={COPY.MAP_SUCCESS_PLACEHOLDER}
            multiline disabled={!editable} className="mt-1 text-sm text-ink-2" onCommit={(successMeasure) => update({ successMeasure })} />
        </div>
        {deletable && (
          <Button variant="ghost" size="icon" aria-label={COPY.MAP_DELETE_OBJECTIVE}
            onClick={() => dispatch({ kind: 'delete', entity: 'objective', id: objective.id }, { label: COPY.MAP_CHANGED.objectiveDeleted })}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    </li>
  );
}
