import type { Market, MarketChange, MarketEntity, MarketInfo } from '@partner-desk/core';
import { PARTNER_TYPE_LABELS } from '@partner-desk/method';
import { SHEET_COPY } from '@partner-desk/copy';
import { encodeMarket } from '../sheet-codec/encode';
import type { CreatedFile, MarketStore, OwnerContext } from '../types';
import { GoogleWorkbookStore, type GoogleStoreOptions } from './workbook-store';
import { MARKET_SPEC } from '../workbook/writer';

/** "PartnerStandard Desk – Austria · Reseller". */
export const marketFileName = (info: Pick<MarketInfo, 'marketName' | 'partnerType'>) =>
  SHEET_COPY.DRIVE.marketFile(info.marketName, PARTNER_TYPE_LABELS[info.partnerType]);

/** The market workbook, one per market. The market's id comes with the market (the command makes it). */
class GoogleMarketStore extends GoogleWorkbookStore<Market, MarketChange, MarketEntity> implements MarketStore {
  constructor(options: GoogleStoreOptions) {
    super(MARKET_SPEC, options);
  }

  create(owner: OwnerContext, market: Market): Promise<CreatedFile> {
    const appUrl = `${this.appBaseUrl}/markets/${market.info.marketId}`;
    return this.createFile(owner, marketFileName(market.info), encodeMarket(market, { appUrl }));
  }
}

/** A Market store on the person's Google Drive. Wrap it in `cacheReads(serializeApplies(...))` in the app. */
export const createGoogleMarketStore = (options: GoogleStoreOptions): MarketStore => new GoogleMarketStore(options);
