/** PartnerStandard's partner types, grouped by category in category order, then Other (outside every category). */
export const PARTNER_TYPES = [
  'technology', 'data', 'integration',
  'referral', 'co-seller', 'reseller', 'distributor', 'oem', 'var', 'vad', 'broker',
  'affiliate', 'content', 'ambassador',
  'managed', 'fulfillment', 'solution', 'system-integrator',
  'other',
] as const;
export const PARTNER_CATEGORIES = ['product', 'channel', 'marketing', 'service'] as const;

export type PartnerType = (typeof PARTNER_TYPES)[number];
export type PartnerCategory = (typeof PARTNER_CATEGORIES)[number];

/** Each partner type's category. Only the type is stored; its category is always derived from this. */
const PARTNER_CATEGORY_OF: Record<Exclude<PartnerType, 'other'>, PartnerCategory> = {
  technology: 'product', data: 'product', integration: 'product',
  referral: 'channel', 'co-seller': 'channel', reseller: 'channel', distributor: 'channel', oem: 'channel', var: 'channel', vad: 'channel', broker: 'channel',
  affiliate: 'marketing', content: 'marketing', ambassador: 'marketing',
  managed: 'service', fulfillment: 'service', solution: 'service', 'system-integrator': 'service',
};

/** The type's category, or null for Other. */
export function categoryOf(type: PartnerType): PartnerCategory | null {
  return type === 'other' ? null : PARTNER_CATEGORY_OF[type];
}

/** The types Recruitment offers: the channel and service types. */
export const RECRUITMENT_PARTNER_TYPES = [
  'referral', 'co-seller', 'reseller', 'distributor', 'oem', 'var', 'vad', 'broker',
  'managed', 'fulfillment', 'solution', 'system-integrator',
] as const satisfies readonly PartnerType[];
export type RecruitmentPartnerType = (typeof RECRUITMENT_PARTNER_TYPES)[number];

export interface PartnerCategoryInfo {
  name: string;
  /** For compact display, such as the plan header. */
  shortName: string;
  description: string;
}

export interface PartnerTypeInfo {
  name: string;
  description: string;
}

export const PARTNER_CATEGORY_INFO: Record<PartnerCategory, PartnerCategoryInfo> = {
  product: {
    name: 'Product Partner',
    shortName: 'Product Partner',
    description: 'Enhances product through co-development, feature or data integration to speed roadmap and add core value.',
  },
  channel: {
    name: 'Channel Partner',
    shortName: 'Channel Partner',
    description: 'Drives revenue by promoting, reselling or distributing; expands market reach and sales capacity.',
  },
  marketing: {
    name: 'Marketing Partner',
    shortName: 'Marketing Partner',
    description: 'Boosts brand awareness, education and lead generation via content, campaigns or events.',
  },
  service: {
    name: 'Service Partner (Operations Partner)',
    shortName: 'Service Partner',
    description: 'Delivers or supports operational functions such as logistics, deployment, IT, HR, customer support.',
  },
};

export const PARTNER_TYPE_INFO: Record<PartnerType, PartnerTypeInfo> = {
  technology: { name: 'Technology Partner', description: 'Partners providing complementary core technology.' },
  data: { name: 'Data Partner', description: 'Partners providing data that enhances or complements your product offering.' },
  integration: { name: 'Integration/IPaaS Partner', description: 'Partners offering integration platforms or services connecting systems.' },
  referral: { name: 'Referral Partner', description: 'Partners who refer potential customers or leads to your business.' },
  'co-seller': { name: 'Co-Seller', description: 'Partners who actively sell your product alongside their own offerings.' },
  reseller: { name: 'Reseller', description: 'Partners who purchase your product and sell it directly to end customers.' },
  distributor: { name: 'Distributor', description: 'Partners who purchase large quantities and sell to resellers or retailers.' },
  oem: { name: 'OEM Partner', description: 'Original Equipment Manufacturer partners who integrate your product into their own.' },
  var: { name: 'Value Added Reseller', description: 'Value-Added Resellers who add features or services to your product before selling.' },
  vad: { name: 'Value Added Distributor', description: 'Value-Added Distributors who provide additional services beyond distribution.' },
  broker: { name: 'Broker', description: 'Partners who act as intermediaries connecting buyers and sellers.' },
  affiliate: {
    name: 'Affiliate Partner',
    description: 'Publishes trackable links or codes that drive visitors to your site. Paid purely on performance (a fee per sale or a share of revenue).',
  },
  content: {
    name: 'Content Partner',
    description: 'Co-creates and syndicates blogs, webinars, white papers, podcasts or research that position your product as the solution to a shared audience problem.',
  },
  ambassador: {
    name: 'Brand Ambassador/Influencer',
    description: 'Uses personal credibility and social reach to endorse your product, speak at events and surface customer stories. Often rewarded with access, status and limited edition perks rather than cash.',
  },
  managed: {
    name: 'Managed Service Provider',
    description: 'Partners that manage, maintain, and optimize the operation of your SaaS product for clients, including tasks like monitoring, updates, security, and user support.',
  },
  fulfillment: {
    name: 'Fulfillment Partner',
    description: 'Partners that facilitate the delivery and activation of your SaaS product for clients, handling tasks like subscription provisioning, software implementation, integration, or enabling client access to the service.',
  },
  solution: {
    name: 'Solution Partner',
    description: 'Partners that bundle your SaaS product with additional services, such as consulting, customization, integration, or complementary technologies, to deliver tailored, end-to-end solutions for clients.',
  },
  'system-integrator': {
    name: 'System Integrator (SI)',
    description: 'Partners that design, build and deploy tailored solutions around your product for clients, combining it with other systems and their own services.',
  },
  other: { name: 'Other', description: 'A partnership that doesn’t fit one of the types above.' },
};

/** The category's types, in PARTNER_TYPES order. */
export function partnerTypesIn(category: PartnerCategory): PartnerType[] {
  return PARTNER_TYPES.filter((type) => categoryOf(type) === category);
}

/** "Channel Partner · Reseller"; "Other partner" for Other. */
export function partnerTypeLine(type: PartnerType): string {
  const category = categoryOf(type);
  return category ? `${PARTNER_CATEGORY_INFO[category].shortName} · ${PARTNER_TYPE_INFO[type].name}` : 'Other partner';
}

/** The type's name with its article, as written ("an OEM Partner", "a Reseller"); "a partner" for Other. */
export function partnerTypePhrase(type: PartnerType): string {
  if (type === 'other') return 'a partner';
  const { name } = PARTNER_TYPE_INFO[type];
  return `${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}`;
}

export const PARTNER_TYPE_LABELS: Record<PartnerType, string> = Object.fromEntries(
  PARTNER_TYPES.map((t) => [t, PARTNER_TYPE_INFO[t].name]),
) as Record<PartnerType, string>;
