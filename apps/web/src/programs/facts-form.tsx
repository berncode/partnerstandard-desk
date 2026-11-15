'use client';

import type { CompanyFacts } from '@partner-desk/core';
import { companyFactsSave } from '@/app/(signed-in)/actions/programs';
import { CompanyFactsForm } from './company-facts-form';

/** Company facts, saving through the `companyFactsSave` server action. */
export function FactsForm(props: { initial: CompanyFacts; companyName: string; fileUrl: string | null }) {
  return <CompanyFactsForm {...props} save={companyFactsSave} />;
}
