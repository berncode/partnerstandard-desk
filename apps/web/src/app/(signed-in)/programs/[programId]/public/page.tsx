import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { PublicPageScreen } from '@/programs/public-page';
import { programPath } from '@/programs/steps';
import { requireOwner } from '@/server/runtime';
import { BlockLoading } from '@/ui/loading';

export const metadata = { title: COPY.PROG_PUBLIC_TITLE };
// Opening the page saves what isn't saved yet (Recruitment's rule for every page that saves).
export const maxDuration = 60;

/** The program's Public page (PD spec §4.10). The program's layout holds the program. */
export default function PublicPage({ params }: PageProps<'/programs/[programId]/public'>) {
  return (
    <Suspense fallback={<BlockLoading />}>
      <Screen params={params} />
    </Suspense>
  );
}

/** The layout reads the program for the signed-in person; a signed-out visit is sent to sign in from here too. */
async function Screen({ params }: Pick<PageProps<'/programs/[programId]/public'>, 'params'>) {
  const { programId } = await params;
  await requireOwner(programPath(programId, 'public'));
  return <PublicPageScreen />;
}
