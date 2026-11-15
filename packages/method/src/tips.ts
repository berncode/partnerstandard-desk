// Short tips, keyed by the screen or step id the UI uses. Plain words.
// Source: the PartnerStandard method (https://pro.partnerstandard.com).

export const TIPS: Record<string, string> = {
  'newMarket.market':
    'A market is one country or region and one partner type, for example "Austria · Reseller". Hypotheses are written per market.',
  'newMarket.why':
    'Say why this partner route works for your product. If you cannot say it in a sentence or two, the route may not be right yet.',
  'newMarket.mustHaves':
    'Must-haves are what a partner needs to have to be worth a call. Keep the list short, so it filters rather than describes.',
  'newMarket.firstCandidates':
    'Add the names and websites you already know. You can also search with AI, and import the results after you check them.',
  copyMarket:
    'Hypotheses do not transfer across markets. A copy is only a draft: check every field again for the new market.',
  'marketHypothesis.candidates':
    'Between 1 and 5 partners is normal. An empty list is a useful result: it tells you the market is not ready. One partner per market is also a valid result.',
  'partnerHypothesis.evidence':
    'A sentence without evidence is an assumption. Write it down, then test it with the partner.',
  discoveryCall:
    'The discovery call is for learning, not for selling or qualifying. Ask about their business, and keep qualification for afterwards.',
  'qualification.decision':
    'The tool gives recommendations, and they are advice. You decide: go on, not now, or no.',
};

// The partner hypothesis's two sentences, as templates to fill in. Source: the PartnerStandard method, "Partner hypothesis".
export const SENTENCE_TEMPLATES = {
  theirSide:
    '[Partner] will [resell / implement / run] [product] because it lets them [grow / defend / extend] [their business] with [their customers], earning [how they make money with or around our product].',
  ourSide:
    'We partner with [partner] because their [access / relationships / capability] opens [market segment] that we [cannot / will not] serve directly.',
};
