'use client';

import { Button } from '@/ui/button';

/** Opens the browser's print dialog, where a one-pager prints on one page or saves as a PDF. */
export function DownloadPdfButton({ variant = 'secondary', disabled = false }: { variant?: 'primary' | 'secondary'; disabled?: boolean }) {
  return <Button variant={variant} disabled={disabled} aria-busy={disabled || undefined} onClick={() => window.print()}>Download PDF</Button>;
}
