'use client';

import { COPY } from '@partner-desk/copy';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProgramLevels } from '@/programs/links';

/**
 * The level names of the programs the partner page shows, by program id. The server hands over those it read with
 * the page; a program picked later is read here once (one Google read). `initial` must be referentially stable: a
 * new object (a fresh server render) replaces what the page has.
 */
export function useProgramLevels(
  initial: Readonly<Record<string, ProgramLevels>>, programIds: readonly string[],
  read: (programIds: string[]) => Promise<Record<string, ProgramLevels>>,
): (programId: string) => ProgramLevels {
  const [levels, setLevels] = useState<Record<string, ProgramLevels>>(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setLevels((current) => ({ ...current, ...initial }));
  }

  const requested = useRef(new Set(Object.keys(initial)));
  // Ids hold no spaces: the missing ones as one string, so the effect runs when it changes.
  const missingKey = [...new Set(programIds)].filter((id) => !(id in levels)).join(' ');
  useEffect(() => {
    if (!missingKey) return;
    const ids = missingKey.split(' ').filter((id) => !requested.current.has(id));
    if (ids.length === 0) return;
    for (const id of ids) requested.current.add(id);
    read(ids)
      .then((answer) => setLevels((current) => ({ ...current, ...answer })))
      .catch(() => setLevels((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, { status: 'failed', message: COPY.SAVE_OFFLINE }])) })));
  }, [missingKey, read]);

  return useCallback((programId: string) => levels[programId] ?? { status: 'loading' }, [levels]);
}
