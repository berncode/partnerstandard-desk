// Types for legal-pages-lib.mjs, for its test.
export const SETTINGS: string[];
export function prepareLegalPages(options: {
  env: Record<string, string | undefined>;
  fetcher?: typeof fetch;
  write: (name: string, json: string) => Promise<void> | void;
}): Promise<'stand-ins' | 'fetched'>;
