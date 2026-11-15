'use client';

// The company, once: its name, website and country. The partner type lives on the tabs below.
import { safeHref, type PartnerAccount } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { InlineText } from '@/ui/inline-text';
import { sayIfRefused, usePartner } from './partner-context';

/** The website as a link only when it starts with http:// or https://; otherwise as plain text. */
function Website({ website }: { website: string }) {
  if (!website.trim()) return null;
  const href = safeHref(website);
  if (!href) return <span className="break-all text-ink-2">{website}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="rounded break-all text-brand-strong underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand">
      {website}
    </a>
  );
}

/** Name, website and country for the company, each edited in place. The name can't be left empty (core refuses it). */
export function AccountHeader() {
  const { account, dispatch, readOnly } = usePartner();
  const update = (patch: Partial<PartnerAccount>) =>
    sayIfRefused(dispatch({ kind: 'update', entity: 'account', id: account.id, patch }, { label: COPY.PARTNER_UPDATED }));
  return (
    <header className="grid gap-1">
      <h1 className="text-xl font-semibold tracking-tight break-words">
        {readOnly ? account.company : (
          <InlineText value={account.company} label={COPY.FIELD_COMPANY} field="company"
            onCommit={(company) => update({ company: company.trim() })} />
        )}
      </h1>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {readOnly ? <Website website={account.website} /> : (
          <InlineText value={account.website} label={COPY.FIELD_WEBSITE} field="website" placeholder="https://"
            onCommit={(website) => update({ website: website.trim() })} />
        )}
        {(account.website.trim() || !readOnly) && account.country.trim() && <span aria-hidden className="text-ink-3">·</span>}
        {readOnly ? (
          account.country.trim() && <span className="text-ink-2">{account.country}</span>
        ) : (
          <InlineText value={account.country} label={COPY.FIELD_COUNTRY} field="country" placeholder={COPY.CLICK_TO_WRITE}
            onCommit={(country) => update({ country })} />
        )}
      </div>
    </header>
  );
}
