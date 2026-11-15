/** A server log line: an event name and ids. Never partner, market, call or person content, never a token. */
export type Log = (event: string, ids: Record<string, string>) => void;

export const log: Log = (event, ids) => console.warn(`[desk] ${event}`, ids);
