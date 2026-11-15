import type { Market, MarketChange, MarketEntity } from '@partner-desk/core';
import { encodeMarket } from '../sheet-codec/encode';
import type { CreatedFile, MarketStore, OwnerContext } from '../types';
import { MARKET_SPEC } from '../workbook/writer';
import { DatabaseWorkbookStore, type DatabaseStoreOptions } from './workbook-store';

/** The market workbook in the database, one per market. The market's id comes with the market (the command makes it). */
class DatabaseMarketStore extends DatabaseWorkbookStore<Market, MarketChange, MarketEntity> implements MarketStore {
  constructor(options: DatabaseStoreOptions) {
    super(MARKET_SPEC, 'market', options);
  }

  create(_owner: OwnerContext, market: Market): Promise<CreatedFile> {
    return this.createFile(market.info.companyId, encodeMarket(market, { appUrl: `${this.appBaseUrl}/markets/${market.info.marketId}` }));
  }
}

/** A Market store in the database. Wrap it in `serializeApplies(...)` in the app; no read cache. */
export const createDatabaseMarketStore = (options: DatabaseStoreOptions): MarketStore => new DatabaseMarketStore(options);
