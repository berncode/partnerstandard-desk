import type { GuideDiagramId } from '@partner-desk/copy';
import { Account } from './account';
import { AgentsMap } from './agents-map';
import { HowItEnds } from './how-it-ends';
import { Journey } from './journey';
import { MapOverTime } from './map-over-time';
import { MarketsFeedProgram } from './markets-feed-program';
import { ProposalPath } from './proposal-path';

/** One of the guide's seven pictures, by id. Each has a text alternative in GUIDE_DIAGRAMS, and its section says the same. */
export function Diagram({ id }: { id: GuideDiagramId }) {
  switch (id) {
    case 'journey': return <Journey />;
    case 'account': return <Account />;
    case 'marketsFeedProgram': return <MarketsFeedProgram />;
    case 'mapOverTime': return <MapOverTime />;
    case 'howItEnds': return <HowItEnds />;
    case 'agentsMap': return <AgentsMap />;
    case 'proposalPath': return <ProposalPath />;
  }
}
