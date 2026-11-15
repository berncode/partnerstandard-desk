// Test support for other packages' tests (the contract's hand edits on the database edition's rows). In the app, only
// the e2e test seed imports it (apps/web/src/app/api/test-seed/edits.ts, test sign-in only); like `./contract`, it
// lives apart from index.ts.
export { workbookRawAccess, workbookSettingsRawAccess } from './hand-edits';
export type { HandEditTarget } from './hand-edits';
export { workFilesTarget } from './database/hand-edit-target';
export { MARKET_LAYOUT, PARTNERS_LAYOUT } from './sheet-codec/layouts';
export { MAP_LAYOUT } from './sheet-codec/map-layout';
