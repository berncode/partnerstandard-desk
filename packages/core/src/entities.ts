import { MARKET_ENTITY_SCHEMAS } from './markets/schemas';
import { PARTNER_ENTITY_SCHEMAS } from './partners/schemas';

/** Row schemas for both aggregates, by entity kind. */
export const ENTITY_SCHEMAS = { ...PARTNER_ENTITY_SCHEMAS, ...MARKET_ENTITY_SCHEMAS };
