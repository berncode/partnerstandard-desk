// The words come from COPY.
import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import { buttonVariants } from '@/ui/button';

export default function MarketNotFound() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">{COPY.MARKET_NOT_FOUND}</h1>
      <p className="mt-2 text-ink-2">{COPY.MARKET_NOT_FOUND_TEXT}</p>
      <Link href="/markets" className={buttonVariants({ className: 'mt-6' })}>{COPY.BACK_TO_MARKETS}</Link>
    </div>
  );
}
