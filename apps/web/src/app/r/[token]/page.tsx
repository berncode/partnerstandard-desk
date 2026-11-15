// The summary for the partner (reviews spec 5.6), in the place of the business case's shared page (src/app/s/[token]/page.tsx).
import { COPY } from '@partner-desk/copy';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SharedFrame } from '@/app/s/[token]/shared-frame';
import { SharedSummary } from './summary-view';
import { BlockLoading } from '@/ui/loading';

// The title names the PDF the browser saves. next.config.ts adds Referrer-Policy: no-referrer and X-Robots-Tag.
export const metadata: Metadata = { title: COPY.SUMMARY_TITLE, robots: { index: false, follow: false } };

/**
 * What a review's summary link shows, to anyone who has it, no account needed, outside the app frame, with the Partner
 * Desk logo and no link into the app. It reads the request's token, so it renders per request and is never cached
 * across tokens; only the header and footer around it are static. A GET only reads: nothing is written or sent. The
 * link is always on APP_URL (the Send summary dialog makes it).
 */
export default function SummaryLinkPage({ params }: PageProps<'/r/[token]'>) {
  return (
    <SharedFrame>
      <Suspense fallback={<BlockLoading className="mx-auto mt-6 min-h-[600px] max-w-3xl" />}>
        <SharedSummary params={params} />
      </Suspense>
    </SharedFrame>
  );
}
