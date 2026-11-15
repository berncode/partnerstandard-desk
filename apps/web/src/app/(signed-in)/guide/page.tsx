import { COPY, GUIDE_INTRO, GUIDE_SECTIONS, guideFor } from '@partner-desk/copy';
import { Suspense } from 'react';
import { builtStorage } from '@/server/edition';
import { Diagram } from '@/guide/diagrams';
import { GuideBody } from '@/guide/guide-body';
import { ServedGuide } from '@/guide/served-guide';
import { PrintButton } from '@/ui/print-button';
import { shownName } from '@/ui/brand';

export const metadata = { title: COPY.GUIDE_TITLE };

const LABEL = 'text-xs font-semibold tracking-wider text-ink-3 uppercase';

/**
 * The How it works guide: the whole journey in one
 * page, its text from packages/copy. Public and static like the Call guide: no sign-in, no session, no Google call.
 * A Vercel build is hosted and holds the whole guide in its static HTML; elsewhere the sections come as the page is
 * served, in the words of where the work lives (a company server's own; plan 13, task 13). The contents' titles are the
 * same on both.
 */
export default function GuidePage() {
  const built = builtStorage();
  return (
    <div className="mx-auto w-full max-w-5xl print:max-w-none">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1 basis-72">
          <p className="text-sm font-medium text-brand-strong">{shownName()}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{COPY.GUIDE_TITLE}</h1>
        </div>
        <PrintButton />
      </div>
      <p className="mt-4 max-w-3xl text-ink-2">{GUIDE_INTRO}</p>

      <div className="mt-6">
        {/* The journey is wider than a phone: it scrolls inside this frame, never the page. Printed, it gets a page of
            its own, turned sideways (the `journey` page in globals.css), and shrinks to fit it. */}
        <div data-testid="journey-frame" className="overflow-x-auto rounded-lg border border-line bg-surface p-3 print:overflow-visible print:border-0 print:p-0 print:[page:journey]">
          <Diagram id="journey" />
        </div>
        <p className="mt-1 text-xs text-ink-3 xl:hidden print:hidden">{COPY.GUIDE_SCROLL_HINT}</p>
      </div>

      <div className="mt-8 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10 print:block">
        <nav aria-label={COPY.GUIDE_CONTENTS} className="print:hidden lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:self-start lg:overflow-y-auto">
          <p className={LABEL}>{COPY.GUIDE_CONTENTS}</p>
          <ol className="mt-2 columns-1 gap-6 text-sm sm:columns-2 lg:columns-1">
            {GUIDE_SECTIONS.map((section) => (
              <li key={section.id} className="break-inside-avoid">
                <a href={`#${section.id}`} className="block py-1 text-ink-2 hover:text-ink">{section.title}</a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="mt-8 min-w-0 lg:mt-0">
          {built ? <GuideBody guide={guideFor(built)} /> : (
            <Suspense fallback={null}>
              <ServedGuide />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
