'use client';

// The words come from COPY.
import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import { buttonVariants } from '@/ui/button';
import { programPath, stepName, STEPS, type Step } from './steps';

/** Moving to another step starts at the top of it (PD spec §3). */
const toTop = () => window.scrollTo(0, 0);

/**
 * Back and `Next: <step>` under a step (PD spec §3), named with the program's level names. The first step has no
 * Back; Money's next is the Program Sheet.
 */
export function StepFooter({ program, step }: { program: { id: string; regName: string; prefName: string }; step: Step }) {
  const i = STEPS.indexOf(step);
  const back = STEPS[i - 1];
  const next = STEPS[i + 1];
  return (
    <nav aria-label={COPY.PROG_STEPS_FOOTER} className="mt-5 flex flex-wrap justify-between gap-2">
      {back ? (
        <Link href={programPath(program.id, back)} onClick={toTop} className={buttonVariants()}>{COPY.BACK}</Link>
      ) : <span />}
      <Link href={programPath(program.id, next ?? 'sheet')} onClick={toTop} className={buttonVariants({ variant: 'primary' })}>
        {COPY.PROG_NEXT_TO(next ? stepName(program, next) : COPY.PROG_SHEET_TITLE)}
      </Link>
    </nav>
  );
}
