import { COPY } from '@partner-desk/copy';
import Image from 'next/image';
import { cn } from './cn';

/** PartnerStandard wordmark: black on light backgrounds, white on dark (follows the theme, see theme.ts). Hosted only (brand.ts). */
export function Logo({ className }: { className?: string }) {
  return (
    <>
      <Image src="/brand/logo-light.svg" alt="PartnerStandard" width={125} height={50} unoptimized priority className={cn('dark:hidden', className)} />
      <Image src="/brand/logo-dark.svg" alt="PartnerStandard" width={125} height={50} unoptimized priority className={cn('hidden dark:block', className)} />
    </>
  );
}

/** The Community Edition's square: a plain D, in the text's own colors, so it never reads as the PartnerStandard logo. */
export function CommunitySquare({ className }: { className?: string }) {
  return <span aria-hidden className={cn('grid shrink-0 place-items-center rounded-md bg-ink font-bold text-canvas', className)}>D</span>;
}

/** The Community Edition's mark: the square and the word Desk. Read aloud as the full name. */
export function CommunityLogo({ className }: { className?: string }) {
  return (
    <span role="img" aria-label={COPY.COMMUNITY_APP_NAME} className={cn('inline-flex items-center gap-1.5', className)}>
      <CommunitySquare className="size-6 text-xs" />
      <span aria-hidden className="text-base font-semibold tracking-tight text-ink">{COPY.APP_BADGE}</span>
    </span>
  );
}

/** The badge beside the mark: Desk in the brand's green on hosted, Community in plain grey elsewhere. */
export const BADGE_PARTNERSTANDARD = 'rounded-md bg-brand-soft whitespace-nowrap px-1.5 py-0.5 font-semibold tracking-wide text-brand-strong';
export const BADGE_COMMUNITY = 'rounded-md border border-line whitespace-nowrap px-1.5 py-0.5 font-medium tracking-wide text-ink-3';
