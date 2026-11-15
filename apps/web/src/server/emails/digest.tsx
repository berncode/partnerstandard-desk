import { Link, Section, Text } from 'react-email';
import { TYPE_LABEL } from '@partner-desk/core';
import { EmailLayout, linkStyle, listItemStyle, mutedStyle, sectionStyle, textStyle, titleStyle } from './layout';
import { renderEmail, type RenderedEmail } from './render';

/** One MAP's part of the digest, already in words. `planUrl` is null in a partner's copy. */
export interface DigestEmailSection {
  partnerName: string;
  planUrl: string | null;
  health: string;
  healthChange: string | null;
  done: string[];
  dueThisWeek: string[];
  overdue: string[];
  blocked: string[];
}
export type DigestAudience = { kind: 'owner' } | { kind: 'partner'; ownerName: string };
export interface DigestEmailInput { recipientName: string; audience: DigestAudience; sections: DigestEmailSection[]; unsubscribeUrl: string }

function digestSubject({ audience, sections }: Pick<DigestEmailInput, 'audience' | 'sections'>): string {
  if (audience.kind === 'partner') return `${audience.ownerName}: your mutual action plan this week`;
  return sections.length === 1 ? `Your MAP with ${sections[0]!.partnerName} this week` : `Your ${sections.length} MAPs this week`;
}

function Lines({ label, lines }: { label: string; lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <>
      <Text style={{ ...mutedStyle, fontWeight: 600, margin: '8px 0 4px' }}>{label}</Text>
      {lines.map((line, i) => <Text key={i} style={listItemStyle}>{`• ${line}`}</Text>)}
    </>
  );
}

/** Monday's digest: to the owner, or a partner's copy of one MAP. */
export function DigestEmail({ recipientName, audience, sections, unsubscribeUrl }: DigestEmailInput) {
  const intro = audience.kind === 'owner'
    ? 'Here’s how your MAPs moved last week, and what’s coming up.'
    : `${audience.ownerName} shares this weekly summary of your mutual action plan.`;
  const note = audience.kind === 'owner'
    ? 'You get this weekly digest because you own these MAPs.'
    : `Sent by PartnerStandard Desk for ${audience.ownerName}. Reply to this email to reach them.`;
  return (
    <EmailLayout preview={intro} note={note} unsubscribe={{ url: unsubscribeUrl, label: `Unsubscribe from ${TYPE_LABEL.digest}` }}>
      <Text style={textStyle}>{`Hi ${recipientName},`}</Text>
      <Text style={textStyle}>{intro}</Text>
      {sections.map((section, i) => (
        <Section key={i} style={sectionStyle}>
          <Text style={titleStyle}>{section.partnerName}</Text>
          <Text style={mutedStyle}>{`Health: ${section.healthChange ?? section.health}`}</Text>
          <Lines label="Done last week" lines={section.done} />
          <Lines label="Due this week" lines={section.dueThisWeek} />
          <Lines label="Overdue" lines={section.overdue} />
          <Lines label="Blocked" lines={section.blocked} />
          {section.planUrl && <Link href={section.planUrl} style={linkStyle}>Open the MAP</Link>}
        </Section>
      ))}
    </EmailLayout>
  );
}

export function digestEmail(input: DigestEmailInput): Promise<RenderedEmail> {
  return renderEmail(<DigestEmail {...input} />, digestSubject(input));
}
