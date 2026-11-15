'use client';

// Core's prompt also reads the Partner book: this market's partners are left out, and a hypothesis's linked partners are its examples. Words from COPY.
import { buildSearchPrompt } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { Download } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Button } from '@/ui/button';
import { CopyButton } from '@/ui/copy-button';
import { searchPromptFileName } from './import-model';
import { useMarket } from './market-context';

/** Saves `text` as a file in the browser; nothing goes to the server. */
function downloadText(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * *Copy search prompt* and *Download*: the prompt from the market hypothesis (`hypothesisId` null) or from a partner
 * hypothesis. When the browser blocks the clipboard, the prompt shows in a text box to copy by hand.
 */
export function SearchPrompt({ hypothesisId }: { hypothesisId: string | null }) {
  const { market, book, companyName } = useMarket();
  const prompt = useMemo(() => buildSearchPrompt({ market, book, companyName, hypothesisId }), [market, book, companyName, hypothesisId]);
  const [blocked, setBlocked] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <CopyButton text={prompt} onCopyFailed={() => setBlocked(true)}>{COPY.COPY_SEARCH_PROMPT}</CopyButton>
        <Button onClick={() => downloadText(prompt, searchPromptFileName(market.info.marketName))}>
          <Download className="h-4 w-4" aria-hidden />
          {COPY.DOWNLOAD}
        </Button>
      </div>
      {blocked && (
        <div className="grid gap-2">
          <p className="text-sm text-ink-2">{COPY.COPY_BLOCKED}</p>
          <textarea ref={box} readOnly rows={8} aria-label={COPY.SEARCH_PROMPT} value={prompt}
            className="w-full min-w-0 rounded-lg border border-line bg-surface-2/60 px-2.5 py-2 font-mono text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30" />
          <div>
            <Button size="sm" onClick={() => { box.current?.focus(); box.current?.select(); }}>{COPY.SELECT_ALL}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
