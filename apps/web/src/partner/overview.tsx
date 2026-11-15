'use client';

import { AccountDetails, SectionFacts } from './details';
import { MarketLinks } from './market-links';
import { People } from './people';

/** The company facts, this partner type's source, its markets and its people. The page shows these together. */
export function Overview() {
  return (
    <div className="grid gap-4">
      <AccountDetails />
      <SectionFacts />
      <MarketLinks />
      <People />
    </div>
  );
}
