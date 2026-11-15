'use client';

// New for PartnerStandard Desk (landing sample week): the landing page's sample. The real sidebar and This week, in a
// preview (links are plain text), with Brookvale Software's made-up week. Mark done, Accept and Reject change this
// browser tab only: their stand-ins answer yes and nothing reaches the server.
import { COPY } from '@partner-desk/copy';
import type { IsoDate } from '@partner-desk/core';
import { CircleUser } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { SidebarPreview } from '@/frame/sidebar';
import { ProposalsWaiting } from '@/frame/nav-items';
import type { RemoteResult } from '@/maps/remote';
import { PreviewProvider } from '@/ui/preview';
import { ThisWeekView, type ProposalAnswers } from '@/week/this-week-view';
import { SAMPLE_ACCOUNT, SAMPLE_COMPANY, sampleWeek } from './sample-week';

const PATH = '/this-week';

/** Mark done and Undo: yes, at once. This week reads only `snapshot.value?.activities`, so an empty snapshot will do. */
const changeInTab = async (): Promise<RemoteResult> => ({ ok: true, snapshot: { value: null }, entityId: null } as unknown as RemoteResult);
const ANSWERS_IN_TAB: ProposalAnswers = { accept: async () => ({ ok: true }), reject: async () => ({ ok: true }) };

/** The visitor's today and time zone. Read in the browser only: the landing page is built once, opened any day. */
interface Clock { today: IsoDate; timeZone: string; now: string }
const noSubscribe = () => () => {};
const localToday = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function Account() {
  return (
    <span className="flex items-center gap-2 px-2.5 py-1 text-[13.5px] font-medium text-ink-2">
      <CircleUser className="h-4 w-4 shrink-0" aria-hidden />
      <span className="truncate">{SAMPLE_ACCOUNT}</span>
    </span>
  );
}

function SampleScreen({ clock }: { clock: Clock }) {
  const [week] = useState(() => sampleWeek(clock.today));
  return (
    <PreviewProvider pathname={PATH}>
      <div className="flex min-h-[44rem] overflow-hidden rounded-xl border border-line bg-canvas shadow-sm">
        <SidebarPreview
          company={SAMPLE_COMPANY}
          account={<Account />}
          proposalsWaiting={<ProposalsWaiting count={week.proposals.length} readAt="landing-sample" />}
        />
        <div className="grid min-w-0 flex-1 content-start gap-4 px-4 py-6 sm:px-6">
          <div className="min-w-0">
            <p className="text-xl font-semibold tracking-tight">{COPY.NAV_THIS_WEEK}</p>
            <p className="mt-1 text-sm text-ink-3">{COPY.WEEK_SUBTITLE}</p>
          </div>
          <ThisWeekView week={week} today={clock.today} timeZone={clock.timeZone} now={clock.now} change={changeInTab} answers={ANSWERS_IN_TAB} />
        </div>
      </div>
    </PreviewProvider>
  );
}

/** The band under the hero: its words, then the sample screen once the browser knows today. */
export function SampleWeekSection() {
  const today = useSyncExternalStore(noSubscribe, localToday, () => null);
  const [clock, setClock] = useState<Clock | null>(null);
  if (today !== null && clock === null) {
    setClock({ today, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, now: new Date().toISOString() });
  }
  return (
    <section aria-labelledby="sample-heading" className="flex-1 border-t border-line bg-surface-2/50">
      <div className="mx-auto max-w-6xl px-4 pt-10 pb-14">
        <h2 id="sample-heading" className="text-2xl font-semibold tracking-tight">{COPY.LANDING_SAMPLE_TITLE}</h2>
        <p className="mt-1 max-w-2xl text-ink-2">{COPY.LANDING_SAMPLE_TEXT}</p>
        <div className="mt-6">
          {clock ? <SampleScreen clock={clock} /> : <div aria-hidden className="min-h-[44rem] rounded-xl border border-line bg-canvas" />}
        </div>
      </div>
    </section>
  );
}
