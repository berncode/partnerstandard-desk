// @vitest-environment jsdom
import { COPY } from '@partner-desk/copy';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GoogleConnectionsLine } from '@/app/google-connections';
import { SettingsConnectionsLine } from './google-connections';

describe('the Google connections line', () => {
  it('keeps no leading space in the copy', () => {
    expect(COPY.SETTINGS_ALSO_SIGNS_OUT).not.toMatch(/^\s/);
  });

  it('reads as one sentence after the link in Settings', () => {
    const { container } = render(<SettingsConnectionsLine />);
    expect(container.textContent).toBe(`${COPY.GOOGLE_CONNECTIONS_BEFORE}${COPY.GOOGLE_CONNECTIONS_LINK}. This also signs you out of the other PartnerStandard tools.`);
  });

  it('ends at the full stop where nothing follows', () => {
    const { container } = render(<GoogleConnectionsLine />);
    expect(container.textContent).toBe(`${COPY.GOOGLE_CONNECTIONS_BEFORE}${COPY.GOOGLE_CONNECTIONS_LINK}.`);
  });
});
