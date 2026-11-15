// Types for third-party-licenses-lib.mjs, for its test.
export type ListedPackage = { name: string; versions: string[]; paths: string[]; license: string; homepage?: string };
export const NOTICE_FILE: RegExp;
export function noticesFrom(
  listing: Record<string, ListedPackage[]>,
  io: { list: (dir: string) => string[]; read: (path: string) => string },
): string;
