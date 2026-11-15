import { applyMarketChange, applyMarketChanges, type Market, type MarketChange } from '@partner-desk/core';
import type { CreatedFile, MarketStore, OwnerContext } from '../types';
import { MemoryFileStore } from './file-store';

class MemoryMarketStore extends MemoryFileStore<Market, MarketChange> implements MarketStore {
  constructor() {
    super({ apply: applyMarketChange, applyMany: applyMarketChanges });
  }

  async create(_owner: OwnerContext, market: Market): Promise<CreatedFile> {
    return this.put(market);
  }
}

/** A Market store in memory: for development, the demo and tests. */
export const createMemoryMarketStore = (): MarketStore => new MemoryMarketStore();
