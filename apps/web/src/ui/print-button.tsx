'use client';

import { COPY } from '@partner-desk/copy';
import { Printer } from 'lucide-react';
import { Button } from '@/ui/button';

/** Opens the browser's print dialog. Hidden on paper. */
export function PrintButton() {
  return (
    <Button className="print:hidden" onClick={() => window.print()}>
      <Printer className="h-4 w-4" aria-hidden />
      {COPY.PRINT}
    </Button>
  );
}
