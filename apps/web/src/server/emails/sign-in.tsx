// The email a company server sends to sign in (plan 14, task 3). Its link opens our confirm page, never Better Auth's
// own link: only the page's button signs in (AGENTS.md: emails never act on a GET). Transactional: no unsubscribe.
import { Button, Text } from 'react-email';
import { EmailLayout, buttonStyle, mutedStyle, textStyle } from './layout';
import { renderEmail, type RenderedEmail } from './render';

export interface SignInEmailInput {
  /** The confirm page, with the token and where it goes on to. */
  url: string;
}

export function SignInEmail({ url }: SignInEmailInput) {
  return (
    <EmailLayout preview="Your link to sign in to PartnerStandard Desk" note="Sent by PartnerStandard Desk because someone asked to sign in with this address.">
      <Text style={textStyle}>Click the button to sign in to PartnerStandard Desk.</Text>
      <Button href={url} style={buttonStyle}>Sign in to PartnerStandard Desk</Button>
      <Text style={{ ...mutedStyle, marginTop: '16px' }}>
        This link works once, for 15 minutes. If you didn’t ask for it, you can ignore this email.
      </Text>
    </EmailLayout>
  );
}

export function signInEmail(input: SignInEmailInput): Promise<RenderedEmail> {
  return renderEmail(<SignInEmail {...input} />, 'Sign in to PartnerStandard Desk');
}

/** The confirm page's address for a token: on this app, never Better Auth's own link. */
export function signInConfirmUrl(appUrl: string, token: string, next: string): string {
  const url = new URL('/sign-in/confirm', appUrl);
  url.searchParams.set('token', token);
  if (next !== '/this-week') url.searchParams.set('next', next);
  return url.toString();
}
