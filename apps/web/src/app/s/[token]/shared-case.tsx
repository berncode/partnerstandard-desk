import { openSharedCase } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import { notFound } from 'next/navigation';
import { DownloadPdfButton } from '@/cases/download-pdf-button';
import { OnePageCase } from '@/cases/one-page-case';
import { shareDeps } from '@/server/runtime';
import { SharedMessage } from './shared-frame';

/**
 * The case behind a share link: the partner's one-pager of the case as it is now (BC v2 §5), read from the owner's
 * storage with the owner's connection; "can't be shown right now" when that storage fails; not found (not-found.tsx)
 * when the link doesn't work. The command gives only the partner's side of the case (`PartnerCaseView`), and the
 * one-pager renders here on the server, so the page sends only what it shows, and nothing of our case (the hard rule).
 * Download PDF is the only client part, and it is given nothing.
 */
export async function SharedCase({ params }: Pick<PageProps<'/s/[token]'>, 'params'>) {
  const { token } = await params;
  const shared = await openSharedCase(shareDeps(), token);
  if (shared.kind === 'gone') notFound();
  if (shared.kind === 'unavailable') return <SharedMessage>{COPY.SHARE_UNAVAILABLE}</SharedMessage>;
  return (
    <>
      <OnePageCase view={shared.view} />
      <div className="mx-auto mt-3.5 flex max-w-[840px] justify-end print:hidden">
        <DownloadPdfButton />
      </div>
    </>
  );
}
