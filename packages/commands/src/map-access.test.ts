import { describeMapAccessContract, describeRateLimiterContract } from './map-access.contract';
import { createMemoryMapAccess } from './testing';

describeMapAccessContract('memory', async () => createMemoryMapAccess());
describeRateLimiterContract('memory', () => createMemoryMapAccess().limiter);
