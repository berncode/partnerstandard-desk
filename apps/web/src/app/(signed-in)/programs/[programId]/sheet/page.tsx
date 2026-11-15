import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { ProgramSheetScreen } from '@/programs/program-sheet';
import { programPath } from '@/programs/steps';
import { requireOwner } from '@/server/runtime';
import { BlockLoading } from '@/ui/loading';

export const metadata = { title: COPY.PROG_SHEET_TITLE };
// Opening the sheet saves what isn't saved yet (Recruitment's rule for every page that saves).
export const maxDuration = 60;

/** The program's Program Sheet (PD spec §4.9). The program's layout holds the program. */
export default function SheetPage({ params }: PageProps<'/programs/[programId]/sheet'>) {
  return (
    <Suspense fallback={<BlockLoading />}>
      <Screen params={params} />
    </Suspense>
  );
}

/** The layout reads the program for the signed-in person; a signed-out visit is sent to sign in from here too. */
async function Screen({ params }: Pick<PageProps<'/programs/[programId]/sheet'>, 'params'>) {
  const { programId } = await params;
  await requireOwner(programPath(programId, 'sheet'));
  return <ProgramSheetScreen />;
}
