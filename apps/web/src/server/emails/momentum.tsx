import { Button, Text } from 'react-email';
import { TYPE_LABEL } from '@partner-desk/core';
import { EmailLayout, buttonStyle, textStyle, titleStyle } from './layout';
import { renderEmail, type RenderedEmail } from './render';

export interface MomentumEmailInput { partnerName: string; state: 'at_risk' | 'off_track'; days: number; suggestion: string; planUrl: string; unsubscribeUrl: string }

/** One warning per change for the worse, with a next step from the method content. */
export function MomentumEmail({ partnerName, state, days, suggestion, planUrl, unsubscribeUrl }: MomentumEmailInput) {
  const now = state === 'at_risk' ? 'at risk' : 'off track';
  return (
    <EmailLayout
      preview={`No progress for ${days} days`}
      note="You get this because you own this MAP. Any update in PartnerStandard Desk counts as progress."
      unsubscribe={{ url: unsubscribeUrl, label: `Unsubscribe from ${TYPE_LABEL.momentum}` }}
    >
      <Text style={textStyle}>{`Nothing has moved in your MAP with ${partnerName} for ${days} days, so it’s now ${now}.`}</Text>
      <Text style={textStyle}>A next step that often helps:</Text>
      <Text style={titleStyle}>{suggestion}</Text>
      <Button href={planUrl} style={{ ...buttonStyle, marginTop: '12px' }}>Open the MAP</Button>
    </EmailLayout>
  );
}

export function momentumEmail(input: MomentumEmailInput): Promise<RenderedEmail> {
  return renderEmail(<MomentumEmail {...input} />, `${input.partnerName}: no progress for ${input.days} days`);
}
