import { Button, Text } from 'react-email';
import { TYPE_LABEL } from '@partner-desk/core';
import { EmailLayout, buttonStyle, listItemStyle, textStyle } from './layout';
import { renderEmail, type RenderedEmail } from './render';

export interface PartnerAlertEmailInput { partnerName: string; lines: string[]; planUrl: string; unsubscribeUrl: string }

/** What people with a link changed since the last alert, one line per item. */
export function PartnerAlertEmail({ partnerName, lines, planUrl, unsubscribeUrl }: PartnerAlertEmailInput) {
  return (
    <EmailLayout
      preview={lines[0] ?? `Changes to your MAP with ${partnerName}`}
      note="You get these alerts because you own this MAP. Change how often under Notifications on the MAP."
      unsubscribe={{ url: unsubscribeUrl, label: `Unsubscribe from ${TYPE_LABEL.partner_alerts}` }}
    >
      <Text style={textStyle}>{`Here’s what changed in your MAP with ${partnerName}:`}</Text>
      {lines.map((line, i) => <Text key={i} style={listItemStyle}>{`• ${line}`}</Text>)}
      <Button href={planUrl} style={{ ...buttonStyle, marginTop: '12px' }}>Open the MAP</Button>
    </EmailLayout>
  );
}

export function partnerAlertEmail(input: PartnerAlertEmailInput): Promise<RenderedEmail> {
  return renderEmail(<PartnerAlertEmail {...input} />, `Changes to your MAP with ${input.partnerName}`);
}
