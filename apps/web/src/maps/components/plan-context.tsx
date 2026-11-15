'use client';

import type { IsoDate, MapActor } from '@partner-desk/core';
import { createContext, useContext } from 'react';
import type { SideNames } from '../format';
import type { PlanEditor } from '../use-plan-editor';

export interface PlanContextValue extends PlanEditor {
  actor: MapActor;
  today: IsoDate;
  /** Where Present opens, or null where there is none. */
  presentHref: string | null;
  /** The owner's review page for this MAP; null for a person with a link, who never sees reviews. */
  reviewHref: string | null;
  /** Both sides by company name, for every viewer alike: the screens never say "Us". */
  names: SideNames;
}

export const PlanContext = createContext<PlanContextValue | null>(null);

export function usePlan(): PlanContextValue {
  const value = useContext(PlanContext);
  if (!value) throw new Error('usePlan must be used inside <PlanWorkspace>');
  return value;
}
