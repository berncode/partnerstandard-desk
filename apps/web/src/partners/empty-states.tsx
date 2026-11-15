'use client';

// The dashed box follows the Recruitment app's empty list.
import { type View } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { Plus, Sparkles } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button, buttonVariants } from '@/ui/button';

const EMPTY_VIEW: Record<View, string> = { potential: COPY.EMPTY_POTENTIAL, active: COPY.EMPTY_ACTIVE, closed: COPY.EMPTY_CLOSED };

function Box({ title, text, children }: { title?: string; text: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center">
      {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
      <p className={title ? 'mx-auto mt-1 max-w-md text-sm text-ink-3' : 'mx-auto max-w-md text-sm text-ink-3'}>{text}</p>
      {children && <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

export const FIND_PARTNERS_HREF = '/markets?find=partners';

export function FindPartnersLink({ variant = 'secondary' }: { variant?: 'primary' | 'secondary' }) {
  return (
    <Link href={FIND_PARTNERS_HREF} className={buttonVariants({ variant })}>
      <Sparkles className="h-4 w-4" aria-hidden />
      {COPY.FIND_PARTNERS}
    </Link>
  );
}

/** A new account: no partner at all. Two ways to start. */
export function NoPartnersYet({ onAdd, canAdd }: { onAdd: () => void; canAdd: boolean }) {
  return (
    <Box title={COPY.EMPTY_PARTNERS_TITLE} text={COPY.EMPTY_PARTNERS_TEXT}>
      {canAdd && (
        <Button variant="primary" onClick={onAdd}>
          <Plus className="h-4 w-4" aria-hidden />
          {COPY.ADD_PARTNER}
        </Button>
      )}
      <FindPartnersLink />
    </Box>
  );
}

/** A view with nothing in it, and no filter to blame. */
export function EmptyView({ view, onAdd, canAdd }: { view: View; onAdd: () => void; canAdd: boolean }) {
  return (
    <Box text={EMPTY_VIEW[view]}>
      {view === 'potential' && (
        <>
          {canAdd && <Button variant="primary" onClick={onAdd}>{COPY.ADD_PARTNER}</Button>}
          <FindPartnersLink />
        </>
      )}
    </Box>
  );
}

/** Filters that let nothing through. */
export function EmptyFilter({ onClear }: { onClear: () => void }) {
  return (
    <Box title={COPY.EMPTY_FILTER_TITLE} text={COPY.EMPTY_FILTER_TEXT}>
      <Button onClick={onClear}>{COPY.CLEAR_FILTERS}</Button>
    </Box>
  );
}
