// Types for public-check-lib.mjs, for its test.
export function isSafeAddress(address: string): boolean;
export const CHECKS: Array<[string, RegExp, ((match: string) => boolean)?]>;
export function isPrivateFile(path: string, text: string): boolean;
export function isSkipped(path: string): boolean;
export function parsePatterns(text: string, where: string): RegExp[];
export function findingsIn(path: string, text: string, options?: { privatePatterns?: RegExp[]; allowed?: RegExp[] }): string[];
