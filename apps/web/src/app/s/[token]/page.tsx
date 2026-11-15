import { COPY } from '@partner-desk/copy';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SharedCase } from './shared-case';
import { SharedFrame } from './shared-frame';
import { BlockLoading } from '@/ui/loading';

// The title names the PDF the browser saves. next.config.ts adds Referrer-Policy: no-referrer and X-Robots-Tag.
export const metadata: Metadata = { title: COPY.CASE_SHARE_TITLE, robots: { index: false, follow: false } };

/**
 * What a share link shows (spec 6), to anyone who has it, no account needed, outside the app frame. It reads the
 * request's token, so it renders per request and is never cached across tokens; only the header and footer around it
 * are static. The link is always on APP_URL (the Share tab makes it).
 */
export default function SharedCasePage({ params }: PageProps<'/s/[token]'>) {
  return (
    <SharedFrame>
      <Suspense fallback={<BlockLoading className="mx-auto mt-6 min-h-[600px] max-w-[840px]" />}>
        <SharedCase params={params} />
      </Suspense>
    </SharedFrame>
  );
}
