// Uses core's `randomSuffix`, with Map names where core's clash.
import { randomSuffix } from '../ids';
import type { EntityKind } from './types';

const PREFIX: Record<EntityKind, string> = {
  objective: 'o',
  activity: 'a',
  person: 'p',
  milestone: 'm',
  exitTrigger: 'x',
  review: 'rv',
  reviewNumber: 'rn',
  reviewItem: 'ri',
};

export function newMapEntityId(kind: EntityKind): string {
  return `${PREFIX[kind]}_${randomSuffix()}`;
}

export function newMapId(): string {
  return `map_${randomSuffix(10)}`;
}
