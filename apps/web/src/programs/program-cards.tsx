'use client';

import { programCreate, programDelete } from '@/app/(signed-in)/actions/programs';
import type { ProgramRow } from './links';
import { ProgramCard } from './program-card';

/** The Programs page's cards, copying and deleting through the `programCreate` and `programDelete` server actions. */
export function ProgramCards({ rows }: { rows: ProgramRow[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => (
        <li key={row.programId} className="min-w-0">
          <ProgramCard row={row} create={programCreate} remove={programDelete} />
        </li>
      ))}
    </ul>
  );
}
