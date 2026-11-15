'use client';

import { Toaster as Sonner } from 'sonner';
import { useResolvedTheme } from './theme-toggle';

export function Toaster() {
  const theme = useResolvedTheme();
  return (
    <Sonner
      theme={theme}
      position="bottom-center"
      toastOptions={{ classNames: { toast: 'font-sans', actionButton: 'font-medium' } }}
    />
  );
}
