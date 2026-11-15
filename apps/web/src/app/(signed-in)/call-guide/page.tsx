import { CALL_GUIDE, TIPS, TOPICS } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { PrintButton } from '@/ui/print-button';
import { shownName } from '@/ui/brand';

export const metadata = { title: COPY.CALL_GUIDE_TITLE };

/**
 * The discovery call guide, to print or keep open during the call. The six topics, each with what to learn, suggested
 * questions and a note prompt. Public and static: no sign-in, no data; it sits in the app frame, where a signed-out visit
 * just shows no name.
 */
export default function CallGuidePage() {
  return (
    <div className="mx-auto w-full max-w-3xl print:max-w-none">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1 basis-72">
            <p className="text-sm font-medium text-brand-strong">{shownName()}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{COPY.CALL_GUIDE_TITLE}</h1>
          </div>
          <PrintButton />
        </div>
        <div className="mt-4 grid gap-2 text-ink-2">
          <p>{TIPS.discoveryCall}</p>
          <p>{COPY.CALL_GUIDE_INTRO_2}</p>
        </div>
        <ol className="mt-6 grid gap-4">
          {TOPICS.map((topic, index) => {
            const { title, learn, questions, notePrompt } = CALL_GUIDE[topic];
            return (
              <li key={topic} className="break-inside-avoid rounded-xl border border-line bg-surface p-5 print:rounded-none print:border-x-0 print:border-b-0 print:p-0 print:pt-4">
                <h2 className="text-base font-semibold tracking-tight">
                  <span className="mr-2 text-ink-3" aria-hidden>{index + 1}.</span>{title}
                </h2>
                <p className="mt-2"><span className="font-medium">{COPY.CALL_GUIDE_LEARN}</span> {learn}</p>
                <p className="mt-3 text-sm font-medium">{COPY.CALL_GUIDE_QUESTIONS}</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {questions.map((question) => <li key={question}>{question}</li>)}
                </ul>
                <p className="mt-3 text-sm"><span className="font-medium">{COPY.CALL_GUIDE_NOTES}</span> {notePrompt}</p>
              </li>
            );
          })}
        </ol>
    </div>
  );
}
