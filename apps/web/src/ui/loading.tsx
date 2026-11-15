import { COPY } from '@partner-desk/copy';
import type { ReactNode } from 'react';
import { cn } from './cn';

/**
 * Loading screens. While any of them shows, a green bar moves along the top of the window, and the page's outline
 * shimmers where its content will be (globals.css: `.skeleton`, `.loading-bar`). With reduced motion both stand still.
 */

/** One gray shape of the page that is loading. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton rounded-md', className)} />;
}

/** A page or part of one that is loading: the bar at the top, the outline, and "Loading…" for screen readers. */
export function Loading({ label = COPY.LOADING, className, children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden print:hidden">
        <div className="loading-bar h-full w-1/4 bg-brand" />
      </div>
      {children}
    </div>
  );
}

/** A white card with a heading and a few lines, as a Section looks while it loads. */
export function CardSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cn('rounded-xl border border-line bg-surface p-4', className)}>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2 h-3 w-64 max-w-full" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className={cn('h-3', i % 3 === 2 ? 'w-2/3' : 'w-full')} />)}
      </div>
    </div>
  );
}

/** A page's title and its line of explanation. */
function TitleSkeleton() {
  return (
    <div aria-hidden>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="mt-2 h-3.5 w-72 max-w-full" />
    </div>
  );
}

/** A list page (Partners): its title, the filters and a table of rows. `title` keeps the real heading in place. */
export function ListLoading({ title }: { title?: ReactNode }) {
  // The real heading stands outside the busy region, so screen readers still read it.
  return (
    <div className="space-y-5">
      {title}
      <Loading className="space-y-5">
        {!title && <TitleSkeleton />}
        <div aria-hidden className="flex flex-wrap gap-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-36 rounded-lg" />)}
        </div>
        <div aria-hidden className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="border-b border-line px-4 py-3"><Skeleton className="h-3 w-1/3" /></div>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-4 border-b border-line px-4 py-3.5 last:border-b-0">
              <Skeleton className="h-3.5 w-1/4" />
              <Skeleton className="h-3 w-1/6" />
              <Skeleton className="h-3 w-1/6" />
              <Skeleton className="ml-auto h-3 w-16" />
            </div>
          ))}
        </div>
      </Loading>
    </div>
  );
}

/** A grid of cards (Markets, Programs, Business cases, Plans), below a title the page already shows. */
export function CardsLoading({ count = 3 }: { count?: number }) {
  return (
    <Loading className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => <CardSkeleton key={i} lines={2} />)}
    </Loading>
  );
}

/** Cards one under the other (This week, Reviews, Settings), below a title the page already shows. */
export function StackLoading({ count = 3 }: { count?: number }) {
  return (
    <Loading className="space-y-4">
      {Array.from({ length: count }, (_, i) => <CardSkeleton key={i} />)}
    </Loading>
  );
}

/** One page about one thing (a partner): the way back, its name, and its sections. */
export function DetailLoading() {
  return (
    <Loading className="space-y-5">
      <Skeleton className="h-3.5 w-32" />
      <TitleSkeleton />
      <CardSkeleton lines={4} />
      <CardSkeleton lines={3} />
    </Loading>
  );
}

/** One large block (a form, a presentation, a shared page), `className` sizing it. */
export function BlockLoading({ className, label }: { className?: string; label?: string }) {
  return (
    <Loading label={label}>
      <CardSkeleton lines={6} className={className} />
    </Loading>
  );
}
