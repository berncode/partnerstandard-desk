'use client';

import { programCreate, programStartMarkets } from '@/app/(signed-in)/actions/programs';
import { AddProgram } from './add-program';
import type { ProgramOption } from './title';

/** Add a program, making it through the `programCreate` server action; the markets to start from come from `programStartMarkets`. */
export function AddProgramForm(props: { companyName: string; programs: ProgramOption[] }) {
  return <AddProgram {...props} create={programCreate} marketsFor={(partnerType) => programStartMarkets({ partnerType })} />;
}
