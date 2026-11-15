import { COPY } from '@partner-desk/copy';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ProgramStep } from '@/programs/program-step';
import { isStep, programPath } from '@/programs/steps';
import { requireOwner } from '@/server/runtime';
import { BlockLoading } from '@/ui/loading';

export const metadata = { title: COPY.PROG_PAGE_TITLE };
// Saving to Google can take a while (Recruitment's rule for every page that saves).
export const maxDuration = 60;

/** One step of a program (PD spec §3, §4.3 to §4.7). The program's layout holds the program; an unknown step is a 404. */
export default function StepPage({ params }: PageProps<'/programs/[programId]/[step]'>) {
  return (
    <Suspense fallback={<BlockLoading />}>
      <StepScreen params={params} />
    </Suspense>
  );
}

async function StepScreen({ params }: Pick<PageProps<'/programs/[programId]/[step]'>, 'params'>) {
  const { programId, step } = await params;
  // The layout reads the program for the signed-in person; a signed-out visit is sent to sign in from here too.
  await requireOwner(isStep(step) ? programPath(programId, step) : '/company-facts');
  if (!isStep(step)) notFound();
  return <ProgramStep step={step} />;
}
