// The made-up market the new market flow shows as its example.
import type { PartnerType } from './partner-types';

export const EXAMPLE_MARKET = {
  marketName: 'Austria',
  partnerType: 'reseller' as PartnerType,
  ourProduct: 'Halden Security Endpoint: endpoint security and patching in one small agent',
  ourTargetCustomers: 'Companies with 20–500 staff and no security team of their own',
  whyPartnerRoute:
    'Small and mid-size Austrian companies buy their IT from a local IT service company they have trusted for years. They want support in German, on site. A direct sales team can’t reach thousands of 50-person companies at a profit.',
  mustHaves: [
    'Sells into companies with 20–500 staff',
    'Has engineers who can roll out an endpoint agent',
    'Reaches the IT lead or the managing director',
    'Runs a support desk in German',
  ],
  howMarketBuys: 'Customer first. Most resellers add a product when a customer asks for it. Few build a security practice first.',
  firstPartners: ['Donau Systemhaus, donau-systemhaus.example', 'Alpenblick IT, alpenblick-it.example', 'Tirol Netzwerk, tirol-netzwerk.example'],
  /** The market page's Example lines (Recruitment's sample market, "candidates" is "partners"). */
  howMarketBuysNote: 'Most resellers add a product when a customer asks for it. Few build a security practice first.',
  statement:
    'In Austria, IT service companies with 10–80 staff will resell Halden Security Endpoint because their customers ask for security they can run without a security team. We expect 15 partners.',
  expectedPartners: '15',
  status: 'Partly validated',
  statusNote: 'Two of three calls back the “customer first” view.',
  /** One value point per kind, by core's value kinds. */
  valuePoints: {
    margin_or_fees: '25% margin on licenses, 30% from the tenth customer',
    services_revenue: 'Rollout and a monthly patch review they can bill as a service',
    portfolio: 'Fills the security gap next to their Microsoft 365 offer',
    non_financial: 'Fewer emergency calls after a ransomware scare',
  },
  hypothesis: {
    name: 'Managed IT providers for small companies',
    theirSide:
      'Donau Systemhaus will resell Halden Security Endpoint because it lets them extend their managed IT contracts with their 300 small business customers, earning license margin and a monthly patch-review fee.',
    ourSide:
      'We partner with Donau Systemhaus because their long-standing customer relationships open small Austrian companies that we cannot serve directly.',
    lookalike:
      'IT service companies with 10–80 staff, selling managed IT contracts to small companies in one region, with a German-speaking support desk.',
  },
  /** A line of the change log: its date, what it is about, and what changed. */
  change: { date: '2026-10-08', about: 'Partner hypothesis', what: 'Narrowed to managed IT providers after the Donau Systemhaus call' },
} as const;
