import type { MarketEntity } from '../markets/types';
import type { IsoDateTime, PartnerEntity } from '../partners/types';

/** What every applied change is stamped with: when, by whom, and (for tests and previews) how new ids are made. */
export interface ChangeStamp {
  now: IsoDateTime;
  /** The actor's label, for example "Desk Agent for Ruth". */
  actor: string;
  newId?: (kind: PartnerEntity | MarketEntity) => string;
}
