// @vitest-environment jsdom
// The file links of every page (case, program, Company facts, market, MAP) take these: a Drive file opens in a new tab,
// a company server's file is downloaded in place (plan 13, task 12's review).
import { COPY, copyFor } from '@partner-desk/copy';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FileLinkIcon, StorageProvider, useCopy, useFileLinkProps } from './storage-context';
import type { StorageKind } from './storage-kind';

function FileLink() {
  const words = useCopy();
  return <a href="/file" {...useFileLinkProps()}>{words.OPEN_IN_SHEETS}<FileLinkIcon /></a>;
}

const show = (storage?: StorageKind) =>
  render(storage ? <StorageProvider storage={storage}><FileLink /></StorageProvider> : <FileLink />);

describe('a file link', () => {
  it('opens a Drive file in a new tab, as before, with no provider too', () => {
    for (const storage of [undefined, 'google', 'memory'] as const) {
      const view = show(storage);
      const link = screen.getByRole('link', { name: COPY.OPEN_IN_SHEETS });
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noreferrer');
      expect(link).not.toHaveAttribute('download');
      expect(link.querySelector('svg')).toHaveClass('lucide-external-link');
      view.unmount();
    }
  });

  it('downloads a company server’s file in place, with a download icon', () => {
    show('database');
    const link = screen.getByRole('link', { name: copyFor('database').OPEN_IN_SHEETS });
    expect(link).toHaveAttribute('download', '');
    expect(link).not.toHaveAttribute('target');
    expect(link.querySelector('svg')).toHaveClass('lucide-download');
  });
});
