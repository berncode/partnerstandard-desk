import { Body, Container, Head, Hr, Html, Link, Preview, Text } from 'react-email';
import type { CSSProperties, ReactNode } from 'react';

/** The app's light-theme tokens (apps/web/src/app/globals.css) written out as hex: email clients don't read CSS variables. */
export const BRAND = '#197c49'; // --brand-strong: white text on it stays readable
export const INK = '#121614';
export const MUTED = '#646d67'; // --ink-3
export const DANGER = '#be3d0c';
const CANVAS = '#f6f7f5';
const SURFACE = '#ffffff';
const LINE = '#e1e5e1';

const bodyStyle: CSSProperties = {
  backgroundColor: CANVAS, color: INK, margin: 0, padding: '24px 0',
  fontFamily: '"Inter Tight", Inter, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};
const cardStyle: CSSProperties = { backgroundColor: SURFACE, borderRadius: '12px', padding: '24px', maxWidth: '560px' };
const brandStyle: CSSProperties = { fontSize: '13px', fontWeight: 600, color: BRAND, margin: '0 0 16px' };
const footerStyle: CSSProperties = { fontSize: '12px', lineHeight: '18px', color: MUTED, margin: '0 0 4px' };

export const textStyle: CSSProperties = { fontSize: '15px', lineHeight: '22px', margin: '0 0 12px' };
export const mutedStyle: CSSProperties = { ...textStyle, fontSize: '13px', color: MUTED };
export const titleStyle: CSSProperties = { ...textStyle, fontSize: '15px', fontWeight: 600, margin: '0 0 4px' };
export const sectionStyle: CSSProperties = { borderTop: `1px solid ${LINE}`, padding: '12px 0 4px' };
export const listItemStyle: CSSProperties = { ...textStyle, margin: '0 0 4px' };
export const buttonStyle: CSSProperties = {
  backgroundColor: BRAND, color: SURFACE, borderRadius: '8px', padding: '10px 16px', fontSize: '14px', fontWeight: 600, textDecoration: 'none',
};
export const secondaryButtonStyle: CSSProperties = { ...buttonStyle, backgroundColor: SURFACE, color: BRAND, border: `1px solid ${BRAND}` };
export const linkStyle: CSSProperties = { color: BRAND, fontSize: '14px', fontWeight: 600, textDecoration: 'underline' };

/**
 * Every email's frame: the brand line, the content, a note saying why the reader got it and, for non-transactional
 * emails, the one-click unsubscribe link.
 */
export function EmailLayout({ preview, note, unsubscribe, children }: {
  preview: string; note: string; unsubscribe?: { url: string; label: string }; children: ReactNode;
}) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={bodyStyle}>
        <Container style={cardStyle}>
          <Text style={brandStyle}>PartnerStandard Desk</Text>
          {children}
          <Hr style={{ borderTop: `1px solid ${LINE}`, margin: '24px 0 12px' }} />
          <Text style={footerStyle}>{note}</Text>
          {unsubscribe && (
            <Text style={footerStyle}>
              <Link href={unsubscribe.url} style={{ color: MUTED, textDecoration: 'underline' }}>{unsubscribe.label}</Link>
            </Text>
          )}
        </Container>
      </Body>
    </Html>
  );
}
