// The summary email (reviews spec 5.6), in the shape of the MAP's magic link email (magic-link.tsx): sent to a
// partner-side person of the MAP on the owner's behalf. It says who sent it and when the review was held, and carries
// the link; never the summary itself.
import { COPY } from '@partner-desk/copy';
import { Button, Text } from 'react-email';
import type { IsoDate } from '@partner-desk/core';
import { formatMapDate } from '@/maps/format';
import { EmailLayout, buttonStyle, mutedStyle, textStyle } from './layout';
import { renderEmail, type RenderedEmail } from './render';

export interface ReviewSummaryInput {
  ownerName: string;
  /** The owner's company (Settings), or null until it has a name. */
  ourName: string | null;
  personName: string;
  heldOn: IsoDate;
  url: string;
}

/** A date with its year: an email is read later, and may be read the next year. */
const dated = (date: IsoDate) => formatMapDate(date, '');

/** Transactional: no unsubscribe. */
export function ReviewSummaryEmail({ ownerName, ourName, personName, heldOn, url }: ReviewSummaryInput) {
  const sender = COPY.REVIEW_SUMMARY_MAIL_SENDER(ownerName, ourName?.trim() || null);
  return (
    <EmailLayout preview={COPY.REVIEW_SUMMARY_MAIL_SUBJECT(ownerName, dated(heldOn))} note={COPY.REVIEW_SUMMARY_MAIL_NOTE(ownerName)}>
      <Text style={textStyle}>{COPY.REVIEW_SUMMARY_MAIL_HI(personName)}</Text>
      <Text style={textStyle}>{COPY.REVIEW_SUMMARY_MAIL_BODY(sender, dated(heldOn))}</Text>
      <Button href={url} style={buttonStyle}>{COPY.REVIEW_SUMMARY_MAIL_BUTTON}</Button>
      <Text style={{ ...mutedStyle, marginTop: '16px' }}>{COPY.REVIEW_SUMMARY_MAIL_PRIVATE}</Text>
    </EmailLayout>
  );
}

export function reviewSummaryEmail(input: ReviewSummaryInput): Promise<RenderedEmail> {
  return renderEmail(<ReviewSummaryEmail {...input} />, COPY.REVIEW_SUMMARY_MAIL_SUBJECT(input.ownerName, dated(input.heldOn)));
}
