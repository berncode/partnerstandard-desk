import { Button, Text } from 'react-email';
import type { Side } from '@partner-desk/core';
import { possessive } from '@/maps/format';
import { EmailLayout, buttonStyle, mutedStyle, textStyle } from './layout';
import { renderEmail, type RenderedEmail } from './render';

export interface MagicLinkInput {
  ownerName: string; partnerName: string; personName: string; side: Side; url: string;
  /** The owner's company (Settings): a colleague on our side edits "{company}’s side". */
  ourName?: string | null;
}

/** The email that carries a magic link (Share, and a new link asked for). Transactional: no unsubscribe. */
export function MagicLinkEmail({ ownerName, partnerName, personName, side, url, ourName = null }: MagicLinkInput) {
  const yourSide = side === 'partner' ? 'your side' : `${possessive(ourName?.trim() || ownerName)} side`;
  return (
    <EmailLayout
      preview={`${ownerName} shared the mutual action plan for ${partnerName} with you`}
      note={`Sent by PartnerStandard Desk for ${ownerName}. Reply to this email to reach them.`}
    >
      <Text style={textStyle}>{`Hi ${personName},`}</Text>
      <Text style={textStyle}>
        {`${ownerName} shared the mutual action plan for `}<strong>{partnerName}</strong>
        {` with you. You can see the whole plan and update the activities and objectives on ${yourSide}. No account needed.`}
      </Text>
      <Button href={url} style={buttonStyle}>Open the plan</Button>
      <Text style={{ ...mutedStyle, marginTop: '16px' }}>
        This link is just for you: anyone with it can edit your side of the plan, so please don’t forward it. It stops working after 90 days without use; you can then ask for a new one.
      </Text>
    </EmailLayout>
  );
}

export function magicLinkEmail(input: MagicLinkInput): Promise<RenderedEmail> {
  return renderEmail(<MagicLinkEmail {...input} />, `${input.ownerName} shared a mutual action plan with you: ${input.partnerName}`);
}
