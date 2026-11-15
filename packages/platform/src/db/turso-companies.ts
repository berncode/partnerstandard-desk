import { eq } from 'drizzle-orm';
import { newCompanyId } from '@partner-desk/core';
import type { Companies } from '@partner-desk/commands';
import type { Db } from './client';
import { guarded } from './guarded';
import { companies } from './schema';

/** One company per account. The unique key on the owner makes two calls at once end with one row. */
export class TursoCompanies implements Companies {
  constructor(private readonly db: Db, private readonly now: () => string = () => new Date().toISOString()) {}

  async forUser(userId: string): Promise<{ companyId: string; name: string }> {
    return guarded('companies_read_failed', async () => {
      // A few tries: the insert ignores a taken owner (the other caller won) and a taken id (a rare clash).
      for (let attempt = 0; attempt < 3; attempt++) {
        const existing = await this.find(userId);
        if (existing) return existing;
        await this.db.insert(companies).values({ id: newCompanyId(), ownerUserId: userId, name: '', createdAt: this.now() }).onConflictDoNothing();
      }
      const made = await this.find(userId);
      if (!made) throw new Error('company_missing');
      return made;
    });
  }

  /** The user's company name, or null when the user has none. Read only: nothing is made (the partner's page). */
  async nameOf(userId: string): Promise<string | null> {
    return guarded('companies_read_failed', async () => (await this.find(userId))?.name ?? null);
  }

  async rename(userId: string, name: string): Promise<void> {
    await guarded('companies_rename_failed', () => this.db.update(companies).set({ name }).where(eq(companies.ownerUserId, userId)));
  }

  /** The owner's timezone as chosen in Settings, or null. */
  async timeZoneOf(userId: string): Promise<string | null> {
    return guarded('companies_read_failed', async () => {
      const [row] = await this.db.select({ timezone: companies.timezone }).from(companies).where(eq(companies.ownerUserId, userId)).limit(1);
      return row?.timezone ?? null;
    });
  }

  /** Saves the owner's timezone on their company, made on first use. */
  async setTimeZone(userId: string, timeZone: string): Promise<void> {
    await this.forUser(userId);
    await guarded('companies_update_failed', () => this.db.update(companies).set({ timezone: timeZone }).where(eq(companies.ownerUserId, userId)));
  }

  /** Account deletion: removes this user's company record. */
  async deleteForUser(userId: string): Promise<void> {
    await guarded('companies_delete_failed', () => this.db.delete(companies).where(eq(companies.ownerUserId, userId)));
  }

  private async find(userId: string): Promise<{ companyId: string; name: string } | null> {
    const [row] = await this.db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.ownerUserId, userId)).limit(1);
    return row ? { companyId: row.id, name: row.name } : null;
  }
}
