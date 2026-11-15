// The guide's sections as this deployment serves them, read at request time (plan 13, task 13). Its own module, so the
// page's test (jsdom renders no async server component) can put the hosted guide in its place.
import { guideFor } from '@partner-desk/copy';
import { connection } from 'next/server';
import { servedStorage } from '@/server/edition';
import { GuideBody } from './guide-body';
import { ScrollToHash } from './scroll-to-hash';

export async function ServedGuide() {
  await connection();
  return (
    <>
      <GuideBody guide={guideFor(servedStorage())} />
      <ScrollToHash />
    </>
  );
}
