// Hosted's landing page, below the sample week: the Community Edition, the open source code for a company's own server
// (owner, 2026-11-14).
import { COPY } from '@partner-desk/copy';
import { buttonVariants } from '@/ui/button';

/** The public repository. */
export const COMMUNITY_EDITION_URL = 'https://github.com/berncode/partnerstandard-desk';

/** On: the repository is public, so the link leads to a page anyone can open. */
export const COMMUNITY_EDITION_LIVE = true;

export function CommunityEdition({ live = COMMUNITY_EDITION_LIVE }: { live?: boolean }) {
  if (!live) return null;
  return (
    <section aria-labelledby="community-heading" className="border-t border-line">
      <div className="mx-auto w-full max-w-6xl px-4 py-12">
        <h2 id="community-heading" className="text-2xl font-semibold tracking-tight">{COPY.COMMUNITY_TITLE}</h2>
        <p className="mt-3 max-w-2xl text-ink-2">{COPY.COMMUNITY_TEXT}</p>
        <ul className="mt-4 grid max-w-2xl list-disc gap-1 pl-5 text-ink-2">
          {COPY.COMMUNITY_POINTS.map((point) => <li key={point}>{point}</li>)}
        </ul>
        <p className="mt-4 max-w-2xl text-sm text-ink-3">{COPY.COMMUNITY_LICENSE}</p>
        <a href={COMMUNITY_EDITION_URL} className={`${buttonVariants({ variant: 'secondary' })} mt-6`}>{COPY.COMMUNITY_LINK}</a>
      </div>
    </section>
  );
}
