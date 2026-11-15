import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { NewProgramLoader } from './new-program-loader';
import { BlockLoading } from '@/ui/loading';
import { WithStorage } from '@/with-storage';

export const metadata = { title: COPY.NAV_ADD_PROGRAM };
// Making a program writes a file to Google, which can take a while (Recruitment's rule for every page that saves).
export const maxDuration = 60;

/** Add a program. The session is read only inside the Suspense child, so the page stays a static shell. */
export default function NewProgramPage() {
  return (
    <Suspense fallback={<BlockLoading className="mx-auto w-full max-w-3xl" />}>
      <WithStorage><NewProgramLoader /></WithStorage>
    </Suspense>
  );
}
