'use client';

// The words come from COPY. The crumb names the program as the Programs page does: by its label ("Reseller · DACH
// program"), plus its name when another program has the same label (`programCrumb`).
import type { CompanyFacts, Program } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import type { ComponentType } from 'react';
import { ClosedForViewer } from '@/viewer-read-only';
import { AtAGlance } from './at-a-glance';
import { useProgramEditor } from './program-editor';
import { SaveStatusLine } from './save-status';
import { StepFooter } from './step-footer';
import { programCrumb } from './title';
import { BasicsStep } from './steps/basics-step';
import { MoneyStep } from './steps/money-step';
import { PreferredStep } from './steps/preferred-step';
import { RegisteredStep } from './steps/registered-step';
import type { StepProps } from './steps/step-props';
import { WhyStep } from './steps/why-step';
import { stepName, STEPS, type Step } from './steps';

/** Each step's screen. */
const BODY: Record<Step, ComponentType<StepProps>> = {
  why: WhyStep,
  basics: BasicsStep,
  registered: RegisteredStep,
  preferred: PreferredStep,
  money: MoneyStep,
};

/** A card beside a step's inputs: Money's At a glance (PD spec §4.7). */
const ASIDE: Partial<Record<Step, ComponentType<{ company: CompanyFacts; program: Program }>>> = { money: AtAGlance };

/**
 * One step of the program on screen (PD spec §3): the crumb ("Reseller · DACH program · step 3 of 5"), the step's
 * name as the heading, what the autosave is doing, the step, and Back / Next at the bottom.
 */
export function ProgramStep({ step }: { step: Step }) {
  const editor = useProgramEditor();
  const { program: p, facts, errors, change, status } = editor;
  const Body = BODY[step];
  const Aside = ASIDE[step];
  const crumb = programCrumb(p, editor.others);
  const head = (
    <>
      <div className="mb-1">
        <p className="truncate text-sm text-ink-3" title={crumb}>{COPY.PROG_STEP_OF(crumb, STEPS.indexOf(step) + 1, STEPS.length)}</p>
        <h1 className="text-xl font-semibold tracking-tight break-words">{stepName(p, step)}</h1>
      </div>
      <SaveStatusLine className="mb-2" status={status} retry={editor.retry} reload={editor.reload} />
    </>
  );
  // A company server's viewer reads the step's fields, closed; Back and Next stay (owner, 2026-11-14).
  const body = <ClosedForViewer><Body company={facts} program={p} errors={errors} onChange={change} /></ClosedForViewer>;
  const footer = <StepFooter program={p} step={step} />;
  if (!Aside) return <div className="mx-auto w-full max-w-3xl">{head}{body}{footer}</div>;
  // Two columns once the step's column is 880 px wide: the card stays in view beside the inputs. Narrower, it comes
  // after the inputs and before Back / Next.
  return (
    <div className="@container">
      {head}
      <div className="grid grid-cols-1 items-start @min-[880px]:grid-cols-[minmax(0,1fr)_380px] @min-[880px]:gap-x-5">
        <div className="min-w-0 @min-[880px]:col-start-1 @min-[880px]:row-start-1">{body}</div>
        <div className="mt-4 min-w-0 @min-[880px]:sticky @min-[880px]:top-4 @min-[880px]:col-start-2 @min-[880px]:row-span-2 @min-[880px]:row-start-1 @min-[880px]:mt-0">
          <Aside company={facts} program={p} />
        </div>
        <div className="min-w-0 @min-[880px]:col-start-1 @min-[880px]:row-start-2">{footer}</div>
      </div>
    </div>
  );
}
