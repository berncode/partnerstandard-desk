'use client';

// The case's own offer only: PartnerStandard Desk has no standard offer (spec 5.2), so there are no type tabs, no adding or
// removing a type and no company name. The partner type is fixed for a case (spec 5.2), so its name is shown, not edited.
// The level names are the case's own (`offer.levels`, from its program) where the Business Case app wrote Registered and
// Preferred. It uses PartnerStandard Desk's number inputs.
import {
  earningsWord, parseOffer, type CaseIssue as Issue, type CaseOffer as Offer, type CaseRates as Rates, type Currency, type PreferredConditions,
  type PreferredRule, type ProductLine, type Roles, type Support, type Tier,
} from '@partner-desk/core';
import { X } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { Field, fieldControl } from '@/programs/field';
import { MoneyInput } from '@/programs/money-input';
import { NumberInput } from '@/programs/number-input';
import { PercentInput } from '@/programs/percent-input';
import { useViewer } from '@/storage-context';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { ClosedForViewer } from '@/viewer-read-only';
import { Card } from './card';
import { issueAt as issueIn, messagesUnder, settleHidden, useLastValid } from './issues';
import { describeTypicalCustomer } from './result-summary';

const MAX_PRODUCTS = 20;

const CURRENCIES: Currency[] = ['EUR', 'USD', 'GBP', 'CHF'];
/** `label` shows; `name` names the inputs when the row reads only under its sub-heading (`heading`). */
const RATE_ROWS: { key: keyof Rates; label: string; name?: string; heading?: string }[] = [
  { key: 'first', label: 'First year of yearly products' },
  { key: 'renewal', label: 'Each renewal year' },
  { key: 'once', label: 'One-off products' },
  // Only for a type that delivers services (`rateRows`).
  { key: 'servicesShare', label: 'Your share', name: 'Your share of partner services', heading: 'Of the partner’s services, you take' },
];
/** The rows of the rates table: the share of the partner's services only for a type that delivers services. */
const rateRows = (roles: Roles) => RATE_ROWS.filter((row) => row.key !== 'servicesShare' || roles.services);
const SUPPORT: { value: Support; label: string }[] = [
  { value: 'none', label: 'You provide it' },
  { value: 'level1', label: 'Partner: level 1' },
  { value: 'level12', label: 'Partner: level 1 and 2' },
];
const ROLE_TICKS: { key: 'closes' | 'services'; label: string }[] = [
  { key: 'closes', label: 'Closes the deal and invoices the customer' },
  { key: 'services', label: 'Delivers implementation and services' },
];
const YEARS: PreferredConditions['year'][] = [2, 3, 4, 5];

/** Text inputs and selects: the height of the number inputs, so a row lines up. */
const control = cn(fieldControl, 'h-9 py-0 aria-invalid:border-danger');
const heading = 'whitespace-nowrap text-xs text-ink-3';
const note = 'rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink-2';
const tickBox = 'size-4 shrink-0 accent-brand-strong';
/** The product grid where it fits: every row's columns line up with the headings (the prototype's `.prow`). */
const PRODUCT_COLUMNS = 'grid-cols-[minmax(150px,1.6fr)_104px_118px_100px_82px_28px] items-center gap-1.5';
// PRODUCT_ROW repeats these columns after @min-[620px]: (Tailwind only sees classes written out in full).
/**
 * A product row. Where the grid doesn't fit (a phone), the row stacks: the name with Remove, then Paid and Price, then
 * Per and Amount, each with its own label, so nothing is cut off or scrolls sideways.
 */
const PRODUCT_ROW =
  'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] items-end gap-x-1.5 gap-y-2 '
  + '@min-[620px]:grid-cols-[minmax(150px,1.6fr)_104px_118px_100px_82px_28px] @min-[620px]:items-center @min-[620px]:gap-1.5';

/** One cell of a product row; its label shows only when the row stacks (the grid has column headings). */
function ProductCell({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('grid min-w-0 gap-1', className)}>
      <span aria-hidden data-label className={cn(heading, '@min-[620px]:hidden')}>{label}</span>
      {children}
    </div>
  );
}

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "A typical customer is worth €24,000 a year plus €4,000 once." A product still being typed counts as 0. */
function typicalCustomer(offer: Offer): string {
  const worth = (paid: ProductLine['paid']) =>
    offer.products.filter((p) => p.paid === paid).reduce((sum, p) => sum + (Number.isFinite(p.price * p.amount) ? p.price * p.amount : 0), 0);
  return describeTypicalCustomer({ yearly: worth('yearly'), once: worth('once') }, offer.currency);
}

/** Only a type that delivers services and doesn't close the deal has a lead share; every other type brings every lead. */
const hasLeadShare = (roles: Roles) => roles.services && !roles.closes;

/** What the roles mean for how the type earns (BC v2 section 4), e.g. "Earns a margin on everything it sells." */
export function earnsNote(roles: Roles): string {
  const on = roles.closes ? ' on everything it sells' : roles.services ? ' on the customers it finds itself' : ' on the customers it introduces';
  const services = roles.services ? ', plus fees from the customer for its own services' : '';
  return `Earns a ${earningsWord(roles)}${on}${services}.`;
}

/**
 * A case's own offer, controlled (BC v1's offer editor, by role and with Preferred optional): the currency and
 * renewals (the company's name is shown, from Settings), what a typical customer buys, the case's partner type (`typeId`)
 * with its roles and rates, and the Preferred conditions when they are on. Every change goes to `onChange` as the whole
 * offer; `issues` (paths relative to the offer, `types.0.name`) show under their fields. Values that are hidden (the
 * lead share of a type that closes, the Preferred rates and rule while Preferred is off) are kept; one with a mistake in
 * it goes back to its last right value (else 0) as it is hidden, so it can't stop every save.
 */
export function OfferForm({ offer, onChange, issues, typeId }: {
  offer: Offer; onChange: (o: Offer) => void; issues: Issue[]; typeId: string;
}) {
  const lastValid = useLastValid(offer, issues.length === 0);
  // A company server's viewer reads the offer, closed, with no Add a product or Remove (owner, 2026-11-14).
  const viewer = useViewer();
  const set = (patch: Partial<Offer>) => onChange({ ...offer, ...patch });
  /** A change that hides fields (`hidden`, paths in the offer): a mistake left in them would stop every save. */
  const setHiding = (patch: Partial<Offer>, hidden: string[]) => {
    const next = { ...offer, ...patch };
    const parsed = parseOffer(next);
    onChange(parsed.ok || hidden.length === 0 ? next : settleHidden(next, hidden, parsed.issues, lastValid.current));
  };
  const issueAt = (path: string) => issueIn(issues, path);
  const { registered: regName, preferred: prefName } = offer.levels;
  const TIERS: { key: Tier; label: string }[] = [{ key: 'registered', label: regName }, { key: 'preferred', label: prefName }];
  const RULES: { value: PreferredRule; label: string }[] = [
    { value: 'deals', label: 'After a number of deals a year' },
    { value: 'revenue', label: 'After an amount of revenue a year' },
    { value: 'year', label: 'From a set year' },
  ];

  // Products
  const setProduct = (id: string, patch: Partial<ProductLine>) =>
    set({ products: offer.products.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const addProduct = () =>
    set({ products: [...offer.products, { id: newId('prod'), name: 'New product', paid: 'yearly', price: 100, per: 'user', amount: 10 }] });
  const removeProduct = (id: string) => set({ products: offer.products.filter((p) => p.id !== id) });

  // The case's own partner type: the only one in its offer.
  const typeIndex = Math.max(0, offer.types.findIndex((t) => t.id === typeId));
  const type = offer.types[typeIndex];
  if (!type) return null;
  const setType = (patch: Partial<typeof type>) => set({ types: offer.types.map((t) => (t.id === type.id ? { ...t, ...patch } : t)) });
  const setRoles = (patch: Partial<Roles>) => {
    const roles = { ...type.roles, ...patch };
    const hidden = [
      ...(hasLeadShare(type.roles) && !hasLeadShare(roles) ? [`types.${typeIndex}.roles.lead`] : []),
      ...(type.roles.services && !roles.services ? TIERS.map((tier) => `types.${typeIndex}.${tier.key}.servicesShare`) : []),
    ];
    setHiding({ types: offer.types.map((t) => (t.id === type.id ? { ...t, roles } : t)) }, hidden);
  };
  const setRate = (tier: Tier, key: keyof Rates, n: number) => setType({ [tier]: { ...type[tier], [key]: n } });

  const preferred = offer.preferred;
  /** Switching Preferred off hides every Preferred rate and the rule; another rule hides the value of the one before. */
  const setPreferred = (patch: Partial<PreferredConditions>) => {
    const next = { ...preferred, ...patch };
    const ruleValue = (rule: PreferredRule) => (rule === 'year' ? [] : [`preferred.${rule}`]);
    const hidden = preferred.on && !next.on
      ? [...offer.types.map((_, i) => `types.${i}.preferred`), 'preferred.deals', 'preferred.revenue']
      : next.on && next.rule !== preferred.rule ? ruleValue(preferred.rule) : [];
    setHiding({ preferred: next }, hidden);
  };
  const tiers = preferred.on ? TIERS : TIERS.slice(0, 1);
  const word = earningsWord(type.roles);

  const typePanel = (
    <>
      <div className="max-w-md">
        <Field label="Type name">
          {() => <input id="type-name" readOnly className={cn(control, 'bg-surface-2 text-ink-2')} value={type.name} />}
        </Field>
      </div>

      <div className="mt-4 grid items-start gap-x-8 gap-y-4 border-t border-line pt-3.5 @min-[936px]:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-2.5 text-xs text-ink-3">What this partner type does. It decides how the partner earns and what you still do yourself.</p>
          <div className="grid grid-cols-2 items-start gap-3">
            {hasLeadShare(type.roles) && (
              <PercentInput key={`${type.id}-lead`} id="type-lead" label="Customers it finds itself" caption="Of the customers this partner serves, the share it found itself. It earns its referral fee on these."
                value={type.roles.lead} error={issueAt(`types.${typeIndex}.roles.lead`)} onChange={(lead) => setRoles({ lead })} />
            )}
            <Field label="Customer support">
              {() => (
                <select id="type-support" className={control} value={type.roles.support} onChange={(e) => setRoles({ support: e.target.value as Support })}>
                  {SUPPORT.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              )}
            </Field>
          </div>
          <div className="mt-3 grid gap-2">
            {ROLE_TICKS.map((tick) => (
              <label key={tick.key} className="flex items-center gap-2 text-[13px] text-ink">
                <input type="checkbox" id={`type-${tick.key}`} className={tickBox} checked={type.roles[tick.key]}
                  onChange={(e) => setRoles({ [tick.key]: e.target.checked })} />
                <span>{tick.label}</span>
              </label>
            ))}
          </div>
          <p className={cn(note, 'mt-3')}>{earnsNote(type.roles)}</p>
        </div>

        <div className="min-w-0">
          <div className={cn('grid items-center gap-x-2.5 gap-y-2 text-[13px]', preferred.on
            ? 'grid-cols-[minmax(0,1fr)_88px_88px] sm:grid-cols-[minmax(0,1fr)_120px_120px]'
            : 'grid-cols-[minmax(0,1fr)_88px] sm:grid-cols-[minmax(0,1fr)_120px]')}>
            <span data-label className={heading}>{`${capitalize(word)} on`}</span>
            {preferred.on
              ? tiers.map((tier) => <span key={tier.key} data-label className={cn(heading, 'truncate pr-2.5 text-right')}>{tier.label}</span>)
              : <span data-label className={cn(heading, 'pr-2.5 text-right')}>Rate</span>}
            {rateRows(type.roles).map((row) => {
              const rowIssues = tiers.map((tier) => issueAt(`types.${typeIndex}.${tier.key}.${row.key}`)).filter((m): m is string => Boolean(m));
              const issueId = rowIssues.length > 0 ? `rate-${row.key}-issues` : undefined;
              return (
                <Fragment key={row.key}>
                  {row.heading && <span data-label className={cn(heading, 'col-span-full pt-1.5 whitespace-normal')}>{row.heading}</span>}
                  <span className="text-ink">{row.label}</span>
                  {tiers.map((tier) => (
                    <PercentInput key={`${type.id}-${tier.key}`} id={`rate-${tier.key}-${row.key}`} label={preferred.on ? `${row.name ?? row.label}, ${tier.label}` : (row.name ?? row.label)}
                      labelHidden value={type[tier.key][row.key]} error={issueAt(`types.${typeIndex}.${tier.key}.${row.key}`)} describedBy={issueId}
                      onChange={(n) => setRate(tier.key, row.key, n)} />
                  ))}
                  {issueId && <p id={issueId} className={cn('-mt-1 text-xs text-danger', preferred.on ? 'col-span-3' : 'col-span-2')}>{rowIssues.join(' ')}</p>}
                </Fragment>
              );
            })}
          </div>

          <div className="mt-3.5 grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
            <MoneyInput key={`${type.id}-fee`} id="type-fee" label="Partner fee a year"
              caption="What the partner pays you every year, for example a program or partner license fee" currency={offer.currency}
              value={type.fee} error={issueAt(`types.${typeIndex}.fee`)} onChange={(fee) => setType({ fee })} />
          </div>
        </div>
      </div>
    </>
  );

  return (
    <ClosedForViewer>
    <div className="grid min-w-0 gap-5">
      {/* A viewer can't change the company name: they read who offers it, without the pointer to Settings (owner, 2026-11-14). */}
      <Card id="this-offer" title="This offer" hint={`Offered by ${offer.company.trim() || 'your company'}.${viewer ? '' : ' Change the company name in Settings.'}`}>
        <div data-company-row className="grid max-w-lg grid-cols-1 items-start gap-3 sm:grid-cols-2">
          <Field label="Currency">
            {() => (
              <select id="offer-currency" className={control} value={offer.currency} onChange={(e) => set({ currency: e.target.value as Currency })}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </Field>
          <PercentInput id="offer-renewal" label="Customers who renew" unit="% a year" value={offer.renewal}
            error={issueAt('renewal')} onChange={(n) => set({ renewal: n })} />
        </div>
      </Card>

      <Card id="products" title="Your portfolio" hint="What a typical customer buys from you, at list prices. Yearly items are paid again every year the customer stays.">
        <div className="@container">
          <div className={cn(PRODUCT_COLUMNS, 'mb-1 hidden @min-[620px]:grid')}>
            <span data-label className={heading}>Product</span>
            <span data-label className={heading}>Paid</span>
            <span data-label className={cn(heading, 'pr-2 text-right')}>Price</span>
            <span data-label className={heading}>Per</span>
            <span data-label className={cn(heading, 'pr-2 text-right')}>Amount</span>
            <span />
          </div>
          {offer.products.length === 0 && <p className="py-2 text-sm text-ink-3">No products yet.</p>}
          {offer.products.map((p, i) => {
            const n = i + 1;
            const at = `products.${i}`;
            const rowIssues = messagesUnder(issues, at);
            const issueId = rowIssues.length > 0 ? `product-${p.id}-issues` : undefined;
            return (
              <div key={p.id} className="mb-3 border-b border-line pb-3 @min-[620px]:mb-1.5 @min-[620px]:border-0 @min-[620px]:pb-0">
                <div className={PRODUCT_ROW}>
                  <ProductCell label="Product" className="col-span-2 @min-[620px]:col-span-1">
                    <input id={`product-${p.id}-name`} aria-label={`Product ${n} name`} className={control} value={p.name} maxLength={80}
                      aria-invalid={issueAt(`${at}.name`) ? true : undefined} aria-describedby={issueId}
                      onChange={(e) => setProduct(p.id, { name: e.target.value })} />
                  </ProductCell>
                  <ProductCell label="Paid">
                    <select id={`product-${p.id}-paid`} aria-label={`Product ${n} paid`} className={control} value={p.paid}
                      onChange={(e) => setProduct(p.id, { paid: e.target.value as ProductLine['paid'] })}>
                      <option value="yearly">Yearly</option>
                      <option value="once">Once</option>
                    </select>
                  </ProductCell>
                  <ProductCell label="Price" className="col-span-2 @min-[620px]:col-span-1">
                    <MoneyInput id={`product-${p.id}-price`} label={`Product ${n} price`} labelHidden currency={offer.currency} value={p.price}
                      invalid={Boolean(issueAt(`${at}.price`))} describedBy={issueId} onChange={(price) => setProduct(p.id, { price })} />
                  </ProductCell>
                  <ProductCell label="Per">
                    <select id={`product-${p.id}-per`} aria-label={`Product ${n} per`} className={control} value={p.per}
                      onChange={(e) => setProduct(p.id, { per: e.target.value as ProductLine['per'] })}>
                      <option value="user">user</option>
                      <option value="site">site</option>
                      <option value="account">account</option>
                    </select>
                  </ProductCell>
                  <ProductCell label="Amount" className="col-span-2 @min-[620px]:col-span-1">
                    <NumberInput id={`product-${p.id}-amount`} label={`Product ${n} amount`} labelHidden value={p.amount}
                      invalid={Boolean(issueAt(`${at}.amount`))} describedBy={issueId} onChange={(amount) => setProduct(p.id, { amount })} />
                  </ProductCell>
                  {!viewer && (
                    <Button variant="ghost" size="icon"
                      className="col-start-3 row-start-1 h-9 w-7 text-ink-3 hover:bg-transparent hover:text-danger @min-[620px]:col-start-auto @min-[620px]:row-start-auto"
                      aria-label={`Remove ${p.name.trim() || `product ${n}`}`} onClick={() => removeProduct(p.id)}>
                      <X aria-hidden className="size-4" />
                    </Button>
                  )}
                </div>
                {issueId && <p id={issueId} className="mt-1 text-xs text-danger">{rowIssues.join(' ')}</p>}
              </div>
            );
          })}
        </div>
        {!viewer && <Button size="sm" className="mt-1" disabled={offer.products.length >= MAX_PRODUCTS} onClick={addProduct}>Add a product</Button>}
        {issueAt('products') && <p className="mt-1 text-xs text-danger">{issueAt('products')}</p>}
        <p className={cn(note, 'mt-3')}>{typicalCustomer(offer)}</p>
      </Card>

      <Card id="terms" title="Partner type" hint="What this partner type does and what it earns.">
        {/* Two columns from the card's width in the Business Case app at its 1000 px (PartnerStandard Desk has a sidebar). */}
        <div id="type-panel" className="@container">{typePanel}</div>

        <div className="mt-5 border-t border-line pt-3.5" data-preferred-section>
          <h3 className="text-[13.5px] font-semibold">{`${prefName} level`}</h3>
          <div className="mt-2">
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <input type="checkbox" id="offer-preferred-on" className={tickBox} checked={preferred.on} onChange={(e) => setPreferred({ on: e.target.checked })} />
              <span>{`Include ${prefName} partner conditions`}</span>
            </label>
            <p className="mt-0.5 ml-6 text-xs text-ink-3">{`Leave this off if you don’t have a ${prefName} level, or don’t want it in the case yet.`}</p>
          </div>

          {preferred.on && (
            <div className="mt-3.5 max-w-2xl">
              <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                <Field label={`A partner becomes ${prefName}`}>
                  {() => (
                    <select id="preferred-rule" className={control} value={preferred.rule} onChange={(e) => setPreferred({ rule: e.target.value as PreferredRule })}>
                      {RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  )}
                </Field>
                {preferred.rule === 'deals' && (
                  <NumberInput id="preferred-deals" label="Deals in a year" unit="deals" value={preferred.deals}
                    error={issueAt('preferred.deals')} onChange={(deals) => setPreferred({ deals })} />
                )}
                {preferred.rule === 'revenue' && (
                  <MoneyInput id="preferred-revenue" label="Revenue in a year" currency={offer.currency} value={preferred.revenue}
                    error={issueAt('preferred.revenue')} onChange={(revenue) => setPreferred({ revenue })} />
                )}
                {preferred.rule === 'year' && (
                  <Field label="From">
                    {() => (
                      <select id="preferred-year" className={control} value={preferred.year}
                        onChange={(e) => setPreferred({ year: Number(e.target.value) as PreferredConditions['year'] })}>
                        {YEARS.map((y) => <option key={y} value={y}>{`Year ${y}`}</option>)}
                      </select>
                    )}
                  </Field>
                )}
              </div>
              <p className="mt-1.5 text-xs text-ink-3">
                {`Deals and revenue are counted in the year before. Use “From a set year” for anything the tool can’t count, such as services
                delivered or certifications. Extra costs of being ${prefName} go in the costs on the Partner case tab.`.replace(/\s+/g, ' ')}
              </p>
            </div>
          )}
        </div>
      </Card>
    </div>
    </ClosedForViewer>
  );
}
