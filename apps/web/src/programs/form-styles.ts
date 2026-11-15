import { cn } from '@/ui/cn';
import { fieldControl } from './field';

/** Text inputs and selects: the height of the number inputs, so a row lines up on its controls. */
export const control = cn(fieldControl, 'h-9 py-0 aria-invalid:border-danger');
/** Multi-line text. */
export const textarea = cn(fieldControl, 'block min-h-[58px] resize-y leading-[1.4] aria-invalid:border-danger');
/** Fields side by side from 561 px; one per line on a phone. */
export const ROW2 = 'grid items-start gap-3 min-[561px]:grid-cols-2';
export const ROW3 = 'grid items-start gap-3 min-[561px]:grid-cols-3';
/** A tick box in a list row or beside a field. */
export const checkbox = 'h-4 w-4 shrink-0 accent-brand-strong';
/** The × that removes a row. */
export const removeButton = 'h-9 w-7 shrink-0 cursor-pointer rounded-md text-lg leading-none text-ink-3 outline-none hover:text-danger focus-visible:ring-2 focus-visible:ring-brand';
