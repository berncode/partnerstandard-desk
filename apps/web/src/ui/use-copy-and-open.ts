'use client';

import { COPY } from '@partner-desk/copy';
import { useRouter } from 'next/navigation';
import { useLayoutEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { RemoteOutcome } from '@/editor/remote';

/**
 * A card's Copy: makes the copy, reads the page again (so Back shows it too) and opens it. Once copied, nothing may
 * make another while the new page loads (push doesn't wait); a refusal shows as a toast. Next keeps the page hidden
 * while the person is away (Cache Components): coming back, Copy works again. Used by the program and case cards.
 */
export function useCopyAndOpen<V extends object>(copy: () => Promise<RemoteOutcome<V>>, pathOf: (made: V) => string) {
  const router = useRouter();
  const [copying, startCopy] = useTransition();
  const done = useRef(false);
  const [finished, setFinished] = useState(false);
  useLayoutEffect(() => () => {
    done.current = false;
    setFinished(false);
  }, []);

  const run = () => startCopy(async () => {
    if (done.current) return;
    let result: RemoteOutcome<V>;
    try {
      result = await copy();
    } catch {
      result = { ok: false, error: 'unavailable', message: COPY.ACTION_FAILED };
    }
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    done.current = true;
    setFinished(true);
    router.refresh();
    router.push(pathOf(result));
  });

  return { run, busy: copying || finished };
}
