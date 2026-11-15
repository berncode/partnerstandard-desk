// Where a person's files live, and the two questions screens ask of it (plan 13, task 10). Shared by the server and the
// screens, so it imports nothing from the server.

/** Google Drive (hosted), this server's memory (test sign-in), or this server's database (self-hosted). */
export type StorageKind = 'google' | 'memory' | 'database';

/** Whether the person can lose Google's access to their files, so a screen offers "Reconnect Google". */
export const canReconnectGoogle = (storage: StorageKind): boolean => storage === 'google';

/** Whether a file has a link to show: Google Sheets for Drive, the spreadsheet download for the database; none in memory. */
export const hasFileLink = (storage: StorageKind): boolean => storage === 'google' || storage === 'database';
