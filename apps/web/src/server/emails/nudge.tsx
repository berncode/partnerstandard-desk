import { Button, Link, Section, Text } from 'react-email';
import { TYPE_LABEL } from '@partner-desk/core';
import { DANGER, EmailLayout, buttonStyle, linkStyle, mutedStyle, secondaryButtonStyle, sectionStyle, textStyle, titleStyle } from './layout';
import { renderEmail, singleLine, type RenderedEmail } from './render';

/** One reminder line; the service formats `when` in the owner's calendar and signs the three action URLs. */
export interface NudgeEmailItem { planName: string; title: string; when: string; overdue: boolean; urls: { done: string; inProgress: string; update: string } }
export interface NudgeEmailInput { personName: string; items: NudgeEmailItem[]; unsubscribeUrl: string }

const SUBJECT_TITLE_MAX = 80;

export function nudgeSubject(items: NudgeEmailItem[]): string {
  if (items.length === 1) return `${items[0]!.overdue ? 'Overdue' : 'Coming up'}: ${singleLine(items[0]!.title, SUBJECT_TITLE_MAX)}`;
  return `${items.length} activities need your attention`;
}

/** Due and overdue reminders. Each button opens a confirmation page; nothing acts on the click itself. */
export function NudgeEmail({ personName, items, unsubscribeUrl }: NudgeEmailInput) {
  return (
    <EmailLayout
      preview={items.length === 1 ? `${items[0]!.title}: ${items[0]!.when}` : `${items.length} of your activities need attention`}
      note="You get this because you own these activities in a mutual action plan."
      unsubscribe={{ url: unsubscribeUrl, label: `Unsubscribe from ${TYPE_LABEL.nudges}` }}
    >
      <Text style={textStyle}>{`Hi ${personName},`}</Text>
      <Text style={textStyle}>{items.length === 1 ? 'One of your activities needs attention:' : `${items.length} of your activities need attention:`}</Text>
      {items.map((item) => (
        <Section key={item.urls.done} style={sectionStyle}>
          <Text style={titleStyle}>{item.title}</Text>
          <Text style={item.overdue ? { ...mutedStyle, color: DANGER } : mutedStyle}>{`${item.planName} · ${item.when}`}</Text>
          <Button href={item.urls.done} style={buttonStyle}>Mark done</Button>
          {' '}
          <Button href={item.urls.inProgress} style={secondaryButtonStyle}>In progress</Button>
          {' '}
          <Link href={item.urls.update} style={linkStyle}>Update…</Link>
        </Section>
      ))}
    </EmailLayout>
  );
}

export function nudgeEmail(input: NudgeEmailInput): Promise<RenderedEmail> {
  return renderEmail(<NudgeEmail {...input} />, nudgeSubject(input.items));
}
