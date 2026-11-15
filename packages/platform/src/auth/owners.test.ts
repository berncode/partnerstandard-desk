import { describe, expect, it } from 'vitest';
import { user } from '../db/schema';
import { createTestDb } from '../db/test-db';
import { TursoCompanies } from '../db/turso-companies';
import { TursoWorkspace } from '../db/turso-workspace';
import { ownerContact, ownerDisplayName, ownerExists } from './owners';

async function setUp() {
  const db = await createTestDb();
  await db.insert(user).values([
    { id: 'u_anna', name: 'Anna Keller', email: 'anna@halden.example' },
    { id: 'u_ben', name: '', email: 'ben@halden.example' },
  ]);
  const ws = new TursoWorkspace(db);
  return { db, ws, key: await ws.key() };
}

describe('the owner of a company’s work (plan 15)', () => {
  it('is a person on hosted: there as long as their account is, named by it', async () => {
    const { db } = await setUp();
    expect(await ownerExists(db, 'u_anna')).toBe(true);
    expect(await ownerDisplayName(db, 'u_anna')).toBe('Anna Keller');
    expect(await ownerContact(db, 'u_anna')).toEqual({
      name: 'Anna Keller', email: 'anna@halden.example', recipients: [{ name: 'Anna Keller', email: 'anna@halden.example' }], team: false,
    });
    expect(await ownerExists(db, 'u_gone')).toBe(false);
    expect(await ownerDisplayName(db, 'u_gone')).toBeNull();
    expect(await ownerContact(db, 'u_gone')).toBeNull();
  });

  it('is the workspace on a company server: there with no user row, named by its company, else by its first admin', async () => {
    const { db, ws, key } = await setUp();
    expect(await ownerExists(db, key)).toBe(true);
    expect(await ownerExists(db, 'ws_notthisone')).toBe(false);
    // No member yet, no company name: there, with no name and no one to write to.
    expect(await ownerDisplayName(db, key)).toBe('');
    expect(await ownerContact(db, key)).toEqual({ name: '', email: null, recipients: [], team: true });
    await ws.addMember({ personId: 'u_ben', role: 'viewer', addedBy: null });
    await ws.addMember({ personId: 'u_anna', role: 'admin', addedBy: null });
    expect(await ownerDisplayName(db, key)).toBe('Anna Keller');
    const companies = new TursoCompanies(db);
    await companies.forUser(key);
    await companies.rename(key, '  Halden  ');
    expect(await ownerDisplayName(db, key)).toBe('Halden');
  });

  it('writes to every admin and partner manager with an account, the earliest added first, never a viewer; replies go to no one', async () => {
    const { db, ws, key } = await setUp();
    await db.insert(user).values({ id: 'u_cleo', name: 'Cleo', email: 'cleo@halden.example' });
    await ws.addMember({ personId: 'u_anna', role: 'admin', addedBy: null });
    await ws.addMember({ personId: 'u_deleted', role: 'admin', addedBy: null });
    await ws.addMember({ personId: 'u_ben', role: 'partnerManager', addedBy: 'u_anna' });
    await ws.addMember({ personId: 'u_cleo', role: 'viewer', addedBy: 'u_anna' });
    expect(await ownerContact(db, key)).toEqual({
      name: 'Anna Keller', email: null, team: true,
      recipients: [{ name: 'Anna Keller', email: 'anna@halden.example' }, { name: 'ben@halden.example', email: 'ben@halden.example' }],
    });
  });
});
