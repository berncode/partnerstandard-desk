// The footer's legal links as this deployment serves them, read at request time (plan 13, task 12). Its own module, so
// a screen's test (jsdom renders no async server component) can put the hosted links in its place.
import { connection } from 'next/server';
import { legalLinks } from '@/server/legal';
import { LegalLinks } from './legal-links';

export async function ServedLegalLinks() {
  await connection();
  return <LegalLinks links={legalLinks()} />;
}
