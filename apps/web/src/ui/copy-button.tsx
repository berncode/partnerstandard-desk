'use client';

import { COPY } from '@partner-desk/copy';
import { Check, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from './button';

/**
 * Copies `text` to the clipboard; the label says "Copied" for two seconds. When the browser blocks the clipboard,
 * `onCopyFailed` lets the caller show the text to copy by hand.
 */
export function CopyButton({ text, children, onCopyFailed, variant, size }: {
  text: string; children: ReactNode; onCopyFailed?: () => void; variant?: 'primary' | 'secondary'; size?: 'sm' | 'md';
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant={variant}
      size={size}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
          onCopyFailed?.();
        }
      }}
    >
      {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      {copied ? COPY.COPIED : children}
    </Button>
  );
}
