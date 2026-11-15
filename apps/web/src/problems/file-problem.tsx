'use client';

import { COPY, copyFor } from '@partner-desk/copy';
import { FilePlus, FileWarning } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { caseList } from '@/app/(signed-in)/actions/cases';
import { mapCount } from '@/app/(signed-in)/actions/maps';
import { recreatePartners } from '@/app/(signed-in)/actions/partners';
import { CasesChoice, type CasesFate } from '@/cases/cases-choice';
import { Button } from '@/ui/button';
import { Dialog, DialogContent } from '@/ui/dialog';
import { ReconnectButton } from './reconnect';
import type { StorageKind } from '@/storage-kind';
import { useViewer } from '@/storage-context';

/** The heading for each problem, in the words of where the work lives (plan 13, task 12). */
const headings = (storage: StorageKind): Record<string, string> => ({
  file_not_found: COPY.PARTNERS_PROBLEM_GONE,
  structure: COPY.PARTNERS_PROBLEM_STRUCTURE,
  auth: COPY.PROBLEM_AUTH,
  unavailable: copyFor(storage).PROBLEM_UNAVAILABLE,
});

/**
 * The Partners file can't be read (the Partners screen and a partner's page): why, and what the person can do. Gone
 * (trashed or lost) offers a new file, which the page reloads into; an expired Google sign-in offers Reconnect Google.
 * The market page's counterpart is MarketProblem.
 */
export function FileProblem({ failure, next, storage }: {
  failure: { error: string; message: string }; next: string; storage: StorageKind;
}) {
  const { error, message } = failure;
  const gone = error === 'file_not_found';
  // An earlier test version is not read. The same button makes a new file and moves the old one to the trash.
  const old = error === 'old_version';
  // A company server's viewer can't make a new Partners file: no button for it (owner, 2026-11-14).
  const viewer = useViewer();
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16 text-center">
      <FileWarning className="mx-auto h-10 w-10 text-warn" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold">{old ? message : (headings(storage)[error] ?? COPY.PARTNERS_PROBLEM_OTHER)}</h1>
      <p className="mt-2 text-ink-2">{old ? copyFor(storage).OLD_PARTNERS_FILE_TEXT : gone ? copyFor(storage).PARTNERS_PROBLEM_GONE_TEXT : message}</p>
      {error === 'unavailable' && <p className="mt-1 text-sm text-ink-3">{COPY.PROBLEM_WAIT}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {error === 'auth' && <ReconnectButton next={next} storage={storage} />}
        {(gone || old) && !viewer && <StartNewButton next={next} />}
      </div>
    </div>
  );
}

/** What the new-file dialog asks about: how many cases and MAPs, and the command's own words when the MAPs can't be counted. */
interface Asking { cases: number; maps: number; text: string }

/**
 * How many business cases and MAPs a new Partners file leaves behind. The MAPs are counted in the directory alone
 * (`mapCount`), since the Partners file can't be read here. When they can't be counted, the command's own sentence
 * (it counts them in the directory) stands in, and the answers say "the files": never "the file" for what may be more.
 */
async function itemsLeft(said: string): Promise<Asking> {
  const [cases, maps] = await Promise.all([caseList({}), mapCount({})]);
  const caseCount = cases.ok ? cases.cases.length : 0;
  if (maps.ok) {
    const count = maps.count;
    // The count, or one case when nothing can be counted: the question is the same.
    if (count === 0) return { cases: Math.max(caseCount, 1), maps: 0, text: COPY.NEW_PARTNERS_CASES_TEXT(Math.max(caseCount, 1)) };
    return { cases: caseCount, maps: count, text: COPY.NEW_PARTNERS_ITEMS_TEXT(caseCount, count) };
  }
  const withMaps = said !== COPY.CASES_CHOOSE(caseCount);
  if (!withMaps) return { cases: Math.max(caseCount, 1), maps: 0, text: COPY.NEW_PARTNERS_CASES_TEXT(Math.max(caseCount, 1)) };
  // Unknown: counted as more than one, so the question and the answers are plural.
  return { cases: caseCount, maps: 2, text: said };
}

/**
 * Makes a new Partners file through the command (nothing happens while the old one still reads), then reloads (or goes
 * to Partners from a partner's page). When the company has business cases or MAPs, the command asks first what happens
 * to them (spec 5.5, MAP spec 5.6): the dialog says how many, and the choice goes with the second try.
 */
function StartNewButton({ next }: { next: string }) {
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState<Asking | null>(null);
  const router = useRouter();

  const start = (fate?: CasesFate) => startTransition(async () => {
    try {
      const result = await recreatePartners(fate ? { items: fate } : {});
      if (!result.ok) {
        if (!fate && result.fieldErrors?.items) {
          setAsking(await itemsLeft(result.fieldErrors.items));
          return;
        }
        return void toast.error(result.message);
      }
      setAsking(null);
      // A partner's page can't come back (the new file has no partners), so go to the list.
      if (next === '/partners') router.refresh();
      else router.push('/partners');
    } catch {
      toast.error(COPY.ACTION_FAILED);
    }
  });

  return (
    <>
      <Button variant="primary" aria-busy={pending} disabled={pending} onClick={() => start()}>
        <FilePlus className="h-4 w-4" aria-hidden />
        {pending ? COPY.STARTING_NEW_PARTNERS_FILE : COPY.START_NEW_PARTNERS_FILE}
      </Button>
      <Dialog open={asking !== null} onOpenChange={(open) => { if (!open && !pending) setAsking(null); }}>
        {asking !== null && (
          <DialogContent title={COPY.NEW_PARTNERS_CASES_TITLE} description={asking.text}>
            <CasesChoice count={asking.cases} maps={asking.maps} busy={pending} onChoose={(fate) => start(fate)} onCancel={() => setAsking(null)} />
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
