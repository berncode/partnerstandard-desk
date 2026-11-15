// The program catalog (owner, 2026-11-10: method content, CC BY 4.0): the partner types a program can be for, what
// each does, who invoices, how each kind is paid, and the benefits and requirements of the levels. From the hub's
// Preferred Partner Program guide and the Partner Program Sheet. packages/core builds programs on it.

/** What each partner type a program can be for does. */
export const PROGRAM_TYPE_DESCRIPTIONS = {
  referral: 'Refers potential customers or leads to your business.', 'co-seller': 'Actively sells your product alongside their own offerings.',
  reseller: 'Buys your product and sells it directly to end customers.', distributor: 'Buys large quantities and sells to resellers or retailers.',
  var: 'Adds features or services to your product before selling.', vad: 'Distributes and provides additional services.', broker: 'Connects buyers and sellers.',
  affiliate: 'Drives visitors through trackable links or codes; paid on performance.', content: 'Co-creates content that positions your product.',
  ambassador: 'Endorses your product with personal credibility and reach.', managed: 'Runs and maintains your product for their clients.',
  fulfillment: 'Delivers and activates your product for clients.', solution: 'Bundles your product with services into a full solution.',
  'system-integrator': 'Designs, builds and deploys solutions around your product.',
} as const;

/** Each covered type in the plural, for "The usual starting answers for Resellers." and the performance bars. */
export const PROGRAM_TYPE_PLURALS = {
  referral: 'Referral Partners', 'co-seller': 'Co-Sellers', broker: 'Brokers', reseller: 'Resellers', var: 'Value Added Resellers',
  distributor: 'Distributors', vad: 'Value Added Distributors', managed: 'Managed Service Providers', fulfillment: 'Fulfillment Partners',
  solution: 'Solution Partners', 'system-integrator': 'System Integrators', affiliate: 'Affiliate Partners', content: 'Content Partners',
  ambassador: 'Brand Ambassadors and Influencers',
} as const;

/** The partner types in their four groups, as the program's first step shows them. */
export const PROGRAM_TYPE_GROUPS = [
  { name: 'Channel Partner', types: ['referral', 'co-seller', 'broker', 'reseller', 'var', 'distributor', 'vad', 'oem'] },
  { name: 'Service Partner', types: ['managed', 'fulfillment', 'solution', 'system-integrator'] },
  { name: 'Marketing Partner', types: ['affiliate', 'content', 'ambassador'] },
  { name: 'Product Partner', types: ['technology', 'data', 'integration'] },
] as const;

/** Why a type has no standard program. */
export const PROGRAM_NOT_COVERED = {
  oem: 'Not covered: OEM deals are negotiated one by one, not run as a standard program.',
  technology: 'Not covered: usually negotiated one by one. May come later for app marketplaces.',
  data: 'Not covered: usually negotiated one by one.',
  integration: 'Not covered: usually negotiated one by one. May come later for app marketplaces.',
} as const;

/** The kind of partnership each covered type is. */
export const PROGRAM_KINDS = {
  referral: 'referral', 'co-seller': 'referral', broker: 'referral', reseller: 'resale', var: 'resale', distributor: 'resale', vad: 'resale',
  managed: 'services', fulfillment: 'services', solution: 'services', 'system-integrator': 'services', affiliate: 'affiliate', content: 'reward', ambassador: 'reward',
} as const;

/** Who invoices the customer, by kind. */
export const WHO_INVOICES = {
  referral: 'You invoice the customer and own the relationship. The partner introduces the customer and is paid a commission.',
  resale: 'The partner buys from you and invoices the customer. You stay the maker; the partner holds the customer contract.',
  services: 'The partner delivers services around your product. You invoice the customer for your product unless the partner resells it.',
  affiliate: 'You invoice the customer. The partner sends people to you through a link or code and is paid per customer.',
  reward: 'You invoice the customer. The partner creates reach and trust and is rewarded mostly with access, status and visibility.',
} as const;

/** How each kind can be paid: the model and its name. */
export const PAYMENT_MODELS = {
  referral: [['commission', 'Commission'], ['fee', 'Flat fee per new customer']],
  resale: [['margin', 'Margin off your suggested price']],
  services: [['commission', 'Referral fee'], ['margin', 'Margin, when they resell'], ['none', 'No payment, services only']],
  affiliate: [['commission', 'Commission'], ['fee', 'Flat fee per new customer']],
  reward: [['none', 'No cash, rewards only'], ['fee', 'Flat fee per new customer']],
} as const;

/** The standard benefits, by group: key and name. */
export const PROGRAM_BENEFITS = [
  { g: 'Selling', items: [['dealreg', 'Deal registration'], ['dealprio', 'First in line on deal registration'], ['playbook', 'Sales playbook and battle cards'], ['demo', 'Demo account'], ['leads', 'Leads passed on from you']] },
  { g: 'Marketing', items: [['listing', 'Listing in your partner directory'], ['toplisting', 'Top spot in your partner directory'], ['comarketing', 'Joint marketing: webinars, case studies, events'], ['funds', 'Funds for partner marketing'], ['badge', 'Certificate and badge']] },
  { g: 'Product and training', items: [['training', 'Product training and certification'], ['docs', 'Technical documentation'], ['early', 'Early access to new features'], ['roadmap', 'A say in the roadmap']] },
  { g: 'Support', items: [['portal', 'Partner portal and community'], ['manager', 'A dedicated partner manager'], ['escalation', 'Faster escalation'], ['sponsor', 'An executive sponsor'], ['board', 'A seat on the partner advisory board']] },
] as const;

/** The Preferred level's requirements: key, label, and 'people' when the row also asks for a number. */
export const PREFERRED_REQUIREMENTS = [
  ['certified', 'Certified people working on your product', 'people'],
  ['contact', 'A named contact for the partnership'],
  ['register', 'Registers every deal it works on'],
  ['pipeline', 'Joint pipeline review every quarter'],
  ['qbr', 'Quarterly business review'],
  ['brand', 'Represents your brand correctly'],
] as const;

/** Free Canva templates from the hub for the certificate and the badge. */
export const CERTIFICATE_URL = 'https://www.canva.com/design/DAFrWX9_CmU/7lvx3UFmBBkPYLtXcytXeQ/view';
export const BADGE_URL = 'https://www.canva.com/design/DAFrWTjYlX0/uipBAHqg1E0KUMR8cVsCyg/view';
