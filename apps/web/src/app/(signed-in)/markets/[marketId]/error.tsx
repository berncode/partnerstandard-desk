'use client';

// The words come from COPY.
import { COPY } from '@partner-desk/copy';
import { Button } from '@/ui/button';

export default function MarketError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">{COPY.MARKET_ERROR_TITLE}</h1>
      <p className="mt-2 text-ink-2">{COPY.MARKET_ERROR_TEXT}</p>
      <Button variant="primary" className="mt-6" onClick={retry}>{COPY.TRY_AGAIN}</Button>
    </div>
  );
}
