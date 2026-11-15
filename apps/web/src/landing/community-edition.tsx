// Hosted's landing page, below the sample week: the Community Edition, the open source code for a company's own server
// (owner, 2026-11-14).
import { COPY } from '@partner-desk/copy';
import { ArrowUpRight, Container, Users, Webhook, type LucideIcon } from 'lucide-react';
import { buttonVariants } from '@/ui/button';

/** The public repository. */
export const COMMUNITY_EDITION_URL = 'https://github.com/berncode/partnerstandard-desk';

/** On: the repository is public, so the link leads to a page anyone can open. */
export const COMMUNITY_EDITION_LIVE = true;

/** One icon per point, in COPY.COMMUNITY_POINTS' order: teams, agents, Docker. */
const POINT_ICONS: readonly LucideIcon[] = [Users, Webhook, Container];

/** A card: what it is and the link on the left, the three points as rows on the right (owner, 2026-11-15). */
export function CommunityEdition({ live = COMMUNITY_EDITION_LIVE }: { live?: boolean }) {
  if (!live) return null;
  return (
    <section aria-labelledby="community-heading" className="mx-auto w-full max-w-6xl px-4 pb-16">
      <div className="grid gap-8 rounded-xl border border-line bg-surface p-6 shadow-sm sm:p-8 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:items-center">
        <div className="min-w-0">
          <h2 id="community-heading" className="text-2xl font-semibold tracking-tight text-balance">{COPY.COMMUNITY_TITLE}</h2>
          <p className="mt-3 text-ink-2">{COPY.COMMUNITY_TEXT}</p>
          <p className="mt-3 text-sm text-ink-3">{COPY.COMMUNITY_LICENSE}</p>
          <a href={COMMUNITY_EDITION_URL} className={`${buttonVariants({ variant: 'secondary' })} mt-6 gap-1.5`}>
            {COPY.COMMUNITY_LINK}
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </a>
        </div>
        <ul className="grid gap-2">
          {COPY.COMMUNITY_POINTS.map((point, i) => {
            const Icon = POINT_ICONS[i] ?? Users;
            return (
              <li key={point} className="flex items-center gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm font-medium text-ink-2">
                <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md bg-brand-soft text-brand-strong"><Icon className="h-4 w-4" /></span>
                {point}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
