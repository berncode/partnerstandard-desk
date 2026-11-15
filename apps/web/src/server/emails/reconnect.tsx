// The reconnect email: Google only.
import { Button, Text } from 'react-email';
import { EmailLayout, buttonStyle, textStyle } from './layout';
import { renderEmail, type RenderedEmail } from './render';

export interface ReconnectEmailInput { ownerName: string; signInUrl: string }

/** Transactional: no unsubscribe. Sent at most once a day per owner. */
export function ReconnectEmail({ ownerName, signInUrl }: ReconnectEmailInput) {
  return (
    <EmailLayout preview="Your MAP emails are paused" note="You get this because you own MAPs whose files we can’t reach. We send it at most once a day.">
      <Text style={textStyle}>{`Hi ${ownerName},`}</Text>
      <Text style={textStyle}>
        PartnerStandard Desk can’t open your MAPs in Google Drive any more. Reminders, digests and partner alerts for them are paused, and the people you shared them with can’t open them for now.
      </Text>
      <Text style={textStyle}>Sign in again to reconnect. Everything picks up where it left off.</Text>
      <Button href={signInUrl} style={buttonStyle}>Sign in again</Button>
    </EmailLayout>
  );
}

export function reconnectEmail(input: ReconnectEmailInput): Promise<RenderedEmail> {
  return renderEmail(<ReconnectEmail {...input} />, 'Reconnect your Google account to keep your MAPs running');
}
