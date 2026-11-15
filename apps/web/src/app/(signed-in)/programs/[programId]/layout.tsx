import { Suspense } from 'react';
import { ProgramLoader } from './program-loader';
import { CardSkeleton, Loading, Skeleton } from '@/ui/loading';
import { WithStorage } from '@/with-storage';

/**
 * Around every screen of a program: reads it once and keeps one editor (one autosave, one save at a time) while the
 * screens change, so a screen only shows and changes the program.
 */
export default function ProgramLayout({ params, children }: LayoutProps<'/programs/[programId]'>) {
  return (
    <Suspense fallback={<ProgramSkeleton />}>
      <WithStorage><ProgramLoader params={params}>{children}</ProgramLoader></WithStorage>
    </Suspense>
  );
}

function ProgramSkeleton() {
  return (
    <Loading className="grid gap-4">
      <Skeleton className="h-10 rounded-xl" />
      {[0, 1, 2].map((i) => <CardSkeleton key={i} className="mx-auto w-full max-w-3xl" />)}
    </Loading>
  );
}
