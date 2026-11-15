// The invite to a company server (plan 15, task 6): sent as an invited address's first sign-in link, so its button opens
// our confirm page, and only that page's button signs in (AGENTS.md: emails never act on a GET). Transactional.
import { Button, Text } from 'react-email';
import { EmailLayout, buttonStyle, mutedStyle, textStyle } from './layout';
import { renderEmail, type RenderedEmail } from './render';

export interface InviteEmailInput {
  /** The admin who invited the address, or '' when their account is gone. */
  inviterName: string;
  /** The confirm page, with the token and where it goes on to. */
  url: string;
}

export const inviteSubject = (inviterName: string): string =>
  (inviterName ? `${inviterName} invited you to PartnerStandard Desk` : 'You’re invited to PartnerStandard Desk');

export function InviteEmail({ inviterName, url }: InviteEmailInput) {
  return (
    <EmailLayout preview={inviteSubject(inviterName)} note="Sent by PartnerStandard Desk because an admin of your company invited this address.">
      <Text style={textStyle}>
        {inviterName ? `${inviterName} invited you` : 'You’re invited'} to work on your company’s partners in PartnerStandard Desk.
      </Text>
      <Button href={url} style={buttonStyle}>Sign in to PartnerStandard Desk</Button>
      <Text style={{ ...mutedStyle, marginTop: '16px' }}>
        This button works once, for 15 minutes. After that, ask for a new link on the sign-in page with this address,
        for 7 days. If you don’t know why you got this, you can ignore it.
      </Text>
    </EmailLayout>
  );
}

export function inviteEmail(input: InviteEmailInput): Promise<RenderedEmail> {
  return renderEmail(<InviteEmail {...input} />, inviteSubject(input.inviterName));
}
