'use client';

// The company facts and the partner-type facts. The type is fixed once chosen: it is named on the tab, not edited here.
import { SOURCES, TARGET_CUSTOMER_TYPES, type Partner, type PartnerAccount } from '@partner-desk/core';
import { PARTNER_TYPE_LABELS } from '@partner-desk/method';
import { COPY, SOURCE_LABELS, TARGET_CUSTOMER_TYPE_LABELS } from '@partner-desk/copy';
import { cn } from '@/ui/cn';
import { controlClass } from '@/ui/control';
import { InlineText } from '@/ui/inline-text';
import { FIELD_ROWS, FieldRow, NARROW_SELECT, Section } from '@/ui/pieces';
import { sayIfRefused, usePartner } from './partner-context';
import { usedValues } from './partner-model';

const selectClass = cn(controlClass, 'px-2 disabled:opacity-70');

/** The company's facts, entered once: vertical, sub-vertical, who it sells to, and comments. */
export function AccountDetails() {
  const { account, book, dispatch, readOnly } = usePartner();
  const update = (patch: Partial<PartnerAccount>) =>
    sayIfRefused(dispatch({ kind: 'update', entity: 'account', id: account.id, patch }, { label: COPY.PARTNER_UPDATED }));
  const text = (key: 'vertical' | 'subVertical' | 'comments', options: { multiline?: boolean; suggestions?: string[] } = {}) => (
    <InlineText value={account[key]} label={key === 'vertical' ? COPY.FIELD_VERTICAL : key === 'subVertical' ? COPY.FIELD_SUB_VERTICAL : COPY.FIELD_COMMENTS}
      field={key} disabled={readOnly} multiline={options.multiline} placeholder={COPY.CLICK_TO_WRITE} suggestions={options.suggestions}
      onCommit={(value) => update({ [key]: value })} />
  );
  return (
    <Section title={COPY.DETAILS_TITLE} description={COPY.DETAILS_TEXT}>
      <div className={FIELD_ROWS}>
        <FieldRow label={COPY.FIELD_VERTICAL}>{text('vertical', { suggestions: usedValues(book, 'vertical') })}</FieldRow>
        <FieldRow label={COPY.FIELD_SUB_VERTICAL}>{text('subVertical', { suggestions: usedValues(book, 'subVertical') })}</FieldRow>
        <FieldRow label={COPY.FIELD_TARGET_CUSTOMER_TYPE}>
          {readOnly ? TARGET_CUSTOMER_TYPE_LABELS[account.targetCustomerType] : (
            <select aria-label={COPY.FIELD_TARGET_CUSTOMER_TYPE} className={cn(selectClass, NARROW_SELECT)} value={account.targetCustomerType}
              onChange={(e) => update({ targetCustomerType: e.target.value as PartnerAccount['targetCustomerType'] })}>
              {TARGET_CUSTOMER_TYPES.map((value) => <option key={value} value={value}>{TARGET_CUSTOMER_TYPE_LABELS[value]}</option>)}
            </select>
          )}
        </FieldRow>
        <FieldRow label={COPY.FIELD_COMMENTS}>{text('comments', { multiline: true })}</FieldRow>
      </div>
    </Section>
  );
}

/** Where this partner type came from, and why it fits. The type itself is the tab, and it does not change. */
export function SectionFacts() {
  const { partner, dispatch, readOnly } = usePartner();
  const update = (patch: Partial<Partner>) =>
    sayIfRefused(dispatch({ kind: 'update', entity: 'partner', id: partner.id, patch }, { label: COPY.PARTNER_UPDATED }));
  const text = (key: 'sourceDetail' | 'whyItFits', options: { multiline?: boolean; placeholder?: string } = {}) => (
    <InlineText value={partner[key]} label={key === 'sourceDetail' ? COPY.FIELD_SOURCE_DETAIL : COPY.FIELD_WHY_IT_FITS}
      field={key} disabled={readOnly} multiline={options.multiline} placeholder={options.placeholder ?? COPY.CLICK_TO_WRITE}
      onCommit={(value) => update({ [key]: value })} />
  );
  return (
    <Section title={COPY.FIELD_SOURCE}>
      <div className={FIELD_ROWS}>
        <FieldRow label={COPY.FIELD_PARTNER_TYPE}>
          <p>{PARTNER_TYPE_LABELS[partner.partnerType]}</p>
        </FieldRow>
        <FieldRow label={COPY.FIELD_SOURCE}>
          <div className="grid gap-1">
            {readOnly ? SOURCE_LABELS[partner.source] : (
              <select aria-label={COPY.FIELD_SOURCE} className={cn(selectClass, NARROW_SELECT)} value={partner.source}
                onChange={(e) => update({ source: e.target.value as Partner['source'] })}>
                {SOURCES.map((value) => <option key={value} value={value}>{SOURCE_LABELS[value]}</option>)}
              </select>
            )}
            {text('sourceDetail', { placeholder: COPY.SOURCE_DETAIL_PLACEHOLDER })}
          </div>
        </FieldRow>
        <FieldRow label={COPY.FIELD_WHY_IT_FITS}>{text('whyItFits', { multiline: true })}</FieldRow>
      </div>
    </Section>
  );
}
