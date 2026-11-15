// The decode cases for the Partners workbook. The market workbook's cases are in decode-market.test.ts.
import { describe, expect, it } from 'vitest';
import type { PartnerBook } from '@partner-desk/core';
import { anAccount, aPartner } from '@partner-desk/core/test-builders';
import { decodePartnerBook } from './decode';
import { encodePartnerBook, encodeRow } from './encode';
import type { Cell, Workbook } from './grid';
import { PARTNERS_LAYOUT } from './layouts';
import { asPartnersVersion2, asPartnersVersion3, asPartnersVersion4, bookWithProposals, PARTNERS_META, richBook } from './test-fixtures';

const T = PARTNERS_LAYOUT.tabs;
const PROPOSALS_HEADER = [
  'ID', 'Proposal ID', 'Kind', 'Partner account', 'Partner', 'Market', 'Partner hypothesis', 'About', 'What', 'Proposed', 'Details',
  'Evidence or reason', 'Proposed by', 'Status', 'Answer note', 'Proposed on', 'Answered on', 'Expires on', 'Target updated', 'Updated',
  'Updated by',
];
/** The cells the version 4 to 5 upgrade writes: the Proposals tab's header row. */
const PROPOSALS_UPGRADE = PROPOSALS_HEADER.map((value, col) => ({ tab: 'Proposals', row: 1, col, value, anchorCol: null }));
const encoded = (book: PartnerBook = richBook()) => encodePartnerBook(book, PARTNERS_META);

function decodeOk(wb: Workbook) {
  const result = decodePartnerBook(wb);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function decodeError(wb: Workbook) {
  const result = decodePartnerBook(wb);
  if (result.ok) throw new Error('expected a decode error');
  return result.error;
}

/** Sets a cell by header name. `row` is the array index (0 = header). */
function setCell(wb: Workbook, tab: string, row: number, header: string, value: Cell) {
  const grid = wb[tab]!;
  const col = grid[0]!.indexOf(header);
  if (col === -1) throw new Error(`no column ${header}`);
  grid[row]![col] = value;
}

describe('decodePartnerBook: structure', () => {
  it('round-trips the book without issues', () => {
    const decoded = decodeOk(encoded());
    expect(decoded.value).toEqual(richBook());
    expect(decoded.issues).toEqual([]);
    expect(decoded.missingIds).toEqual([]);
    expect(decoded.unreadable).toEqual(new Map());
  });

  it('round-trips formula-looking text unchanged', () => {
    const book = {
      ...richBook(), accounts: [anAccount({ company: '+43 Acme', website: '=HYPERLINK("x")', comments: '@acme\n-x' })],
      partners: [aPartner({ whyItFits: '=HYPERLINK("x")', sourceDetail: '-x' })], people: [], calls: [], qualifications: [], marketLinks: [],
    };
    expect(decodeOk(encoded(book)).value).toEqual(book);
  });

  it('round-trips companies, their partner types and their people', () => {
    const decoded = decodeOk(encoded());
    expect(decoded.value.accounts.map((a) => a.id)).toEqual(['a_1', 'a_2', 'a_4']);
    expect(decoded.value.accounts[1]).toEqual(richBook().accounts[1]);
    expect(decoded.value.partners.map((p) => [p.id, p.accountId, p.partnerType])).toEqual([
      ['p_1', 'a_1', 'reseller'], ['p_2', 'a_2', 'var'], ['p_3', 'a_1', 'managed'], ['p_4', 'a_4', 'reseller'],
    ]);
    expect(decoded.value.people.map((e) => [e.id, e.accountId])).toEqual([['e_1', 'a_1'], ['e_2', 'a_2']]);
    expect(decoded.value.partners[3]!.source).toBe('existing_partner');
  });

  it('takes the company id from _meta for the book and every partner', () => {
    const wb = encoded();
    wb['_meta']![2]![1] = 'co_other00001';
    const decoded = decodeOk(wb);
    expect(decoded.value.companyId).toBe('co_other00001');
    expect(decoded.value.partners.every((p) => p.companyId === 'co_other00001')).toBe(true);
  });

  it('records where each row sits and where each column is', () => {
    const decoded = decodeOk(encoded());
    expect(decoded.locations.get('a_2')).toEqual({ entity: 'account', tab: 'Accounts', row: 3 });
    expect(decoded.locations.get('p_3')).toEqual({ entity: 'partner', tab: 'Partners', row: 4 });
    expect(decoded.locations.get('l_2')).toEqual({ entity: 'marketLink', tab: 'Market links', row: 3 });
    expect(decoded.columns.account).toMatchObject({ id: 0, company: 1, targetCustomerType: 6, comments: 7, updatedBy: 9 });
    expect(decoded.columns.partner).toMatchObject({
      id: 0, accountId: 1, partnerType: 2, stage: 3, step: 4, 'desk.credibility': 11, programId: 23, level: 24, mapHealth: 25,
      mapNextMilestone: 26, updatedBy: 28,
    });
    expect(decoded.columns.person).toMatchObject({ id: 0, accountId: 1, name: 2 });
    expect(decoded.columns.qualification['caso.culture.answer']).toBe(13);
  });

  it('names a missing tab', () => {
    const wb = encoded();
    delete wb[T.person];
    expect(decodeError(wb)).toEqual({ kind: 'missing_tab', tab: 'People', message: 'The "People" tab is missing' });
    const noAccounts = encoded();
    delete noAccounts[T.account];
    expect(decodeError(noAccounts)).toEqual({ kind: 'missing_tab', tab: 'Accounts', message: 'The "Accounts" tab is missing' });
  });

  it('refuses a file without our _meta tab or a company id', () => {
    const wb = encoded();
    delete wb['_meta'];
    expect(decodeError(wb)).toEqual({ kind: 'not_ours', tab: '_meta', message: 'This file was not created with PartnerStandard Desk' });
    const noId = encoded();
    noId['_meta']![2]![1] = '';
    expect(decodeError(noId)).toEqual({ kind: 'not_ours', tab: '_meta', message: 'This file was not created with PartnerStandard Desk' });
    const noVersion = encoded();
    noVersion['_meta']![1]![1] = 'one';
    expect(decodeError(noVersion)).toMatchObject({ kind: 'not_ours', tab: '_meta' });
  });

  it('refuses a file saved by a newer schema version', () => {
    const wb = encoded();
    wb['_meta']![1]![1] = 6;
    expect(decodeError(wb)).toEqual({ kind: 'newer_version', tab: '_meta', message: 'This file was saved by a newer version of the app. Reload the page.' });
  });

  it('reads a version 1 Partners file as an old file, whatever its tabs, and never upgrades it', () => {
    const message = 'This Partners file was made by an earlier test version of PartnerStandard Desk.';
    const wb = encoded();
    wb['_meta']![1]![1] = 1;
    expect(decodeError(wb)).toEqual({ kind: 'old_version', tab: '_meta', message });
    // A real version 1 file has no Accounts tab, and company columns on Partners.
    delete wb[T.account];
    wb[T.partner]![0]![1] = 'Company';
    expect(decodeError(wb)).toEqual({ kind: 'old_version', tab: '_meta', message });
  });

  it('names a missing column', () => {
    const wb = encoded();
    setCell(wb, T.partner, 0, 'Step', 'Something else');
    expect(decodeError(wb)).toEqual({ kind: 'missing_column', tab: 'Partners', message: 'The "Partners" tab is missing the "Step" column' });
  });

  it('matches headers whatever their case, spaces and punctuation', () => {
    const wb = encoded();
    setCell(wb, T.partner, 0, 'Desk: Credibility', '  desk credibility ');
    setCell(wb, T.account, 0, 'Sub-vertical', 'SUB VERTICAL');
    setCell(wb, T.person, 0, 'Partner account', 'partner-account');
    expect(decodeOk(wb).value).toEqual(richBook());
  });
});

describe('decodePartnerBook: hand edits', () => {
  it('turns an unknown stage into a row issue and leaves that row out', () => {
    const wb = encoded();
    setCell(wb, T.partner, 2, 'Stage', 'Pending');
    const decoded = decodeOk(wb);
    expect(decoded.issues).toEqual([
      { tab: 'Partners', row: 3, message: 'Stage must be one of Recruitment, Onboarding, Growth, Expansion, Exit' },
    ]);
    expect(decoded.value.partners.map((p) => p.id)).toEqual(['p_1', 'p_3', 'p_4']);
    expect(decoded.locations.has('p_2')).toBe(false);
  });

  it('leaves a partner out when its Closed cell can’t be read, rather than showing it as open', () => {
    const wb = encoded();
    setCell(wb, T.partner, 3, 'Closed', 'maybe later');
    const decoded = decodeOk(wb);
    expect(decoded.issues).toEqual([{ tab: 'Partners', row: 4, message: 'Closed must be one of Not now, No' }]);
    expect(decoded.value.partners.map((p) => p.id)).toEqual(['p_1', 'p_2', 'p_4']);
    expect(decoded.locations.has('p_3')).toBe(false);
    expect(decoded.unreadable.has('p_3')).toBe(false);
  });

  it('leaves a partner out when its Exited date can’t be read, rather than showing it as active', () => {
    const wb = encoded();
    setCell(wb, T.partner, 4, 'Exited date', 'last autumn');
    const decoded = decodeOk(wb);
    expect(decoded.issues).toEqual([{ tab: 'Partners', row: 5, message: 'Exited date: use a date like 2026-10-21 (YYYY-MM-DD)' }]);
    expect(decoded.value.partners.map((p) => p.id)).toEqual(['p_1', 'p_2', 'p_3']);
    expect(decoded.locations.has('p_4')).toBe(false);
  });

  it('keeps a row with an unreadable score, holding it empty, and says which value it could not read', () => {
    const wb = encoded();
    setCell(wb, T.partner, 1, 'Desk: Credibility', '3/3');
    const decoded = decodeOk(wb);
    expect(decoded.issues).toEqual([{ tab: 'Partners', row: 2, message: 'Desk: Credibility must be 0, 1, 2, 3 or empty' }]);
    expect(decoded.value.partners.map((p) => p.id)).toEqual(['p_1', 'p_2', 'p_3', 'p_4']);
    expect(decoded.value.partners[0]!.desk).toEqual({ customerBase: 3, credibility: null, capability: 3, commitment: null });
    expect(decoded.unreadable).toEqual(new Map([['p_1', new Set(['desk.credibility'])]]));
    expect(decoded.locations.get('p_1')).toEqual({ entity: 'partner', tab: 'Partners', row: 2 });
  });

  it('reads scores typed as text, and blank scores as empty', () => {
    const wb = encoded();
    setCell(wb, T.partner, 1, 'Desk: Credibility', ' 2 ');
    setCell(wb, T.partner, 1, 'Desk: Capability', '');
    const decoded = decodeOk(wb);
    expect(decoded.value.partners[0]!.desk).toEqual({ customerBase: 3, credibility: 2, capability: null, commitment: null });
    expect(decoded.issues).toEqual([]);
  });

  it('accepts loosely typed labels and yes/no cells', () => {
    const wb = encoded();
    setCell(wb, T.partner, 1, 'Step', ' discovery CALL ');
    setCell(wb, T.partner, 1, 'Closed', 'not now');
    setCell(wb, T.partner, 1, 'Partner type', 'SI');
    setCell(wb, T.partner, 1, 'MAP filled in', 'X');
    setCell(wb, T.partner, 3, 'MAP filled in', true);
    setCell(wb, T.partner, 2, 'MAP filled in', 'no');
    setCell(wb, T.person, 1, 'Active seller', '✓');
    setCell(wb, T.qualification, 1, 'CASO: Culture', 'PARTLY');
    const decoded = decodeOk(wb);
    expect(decoded.value.partners.find((p) => p.id === 'p_1')).toMatchObject({
      step: 'discovery_call', closed: 'not_now', partnerType: 'system-integrator', mapFilled: true,
    });
    expect(decoded.value.partners.find((p) => p.id === 'p_3')?.mapFilled).toBe(true);
    expect(decoded.value.partners.find((p) => p.id === 'p_2')?.mapFilled).toBe(false);
    expect(decoded.value.people[0]!.activeSeller).toBe(true);
    expect(decoded.value.qualifications[0]!.caso.culture).toEqual({ answer: 'partly', note: 'Same pace' });
    expect(decoded.issues).toEqual([]);
  });

  it('leaves out a row with a yes/no cell it cannot read', () => {
    const wb = encoded();
    setCell(wb, T.person, 1, 'Active seller', 'maybe');
    const decoded = decodeOk(wb);
    expect(decoded.issues).toEqual([{ tab: 'People', row: 2, message: 'Active seller must be "yes" or empty' }]);
    expect(decoded.value.people.map((e) => e.id)).toEqual(['e_2']);
  });

  it('flags rows that break core rules, naming the column', () => {
    const wb = encoded();
    setCell(wb, T.account, 3, 'Target customer type', '');
    setCell(wb, T.partner, 1, 'Partner account', '');
    setCell(wb, T.partner, 2, 'Step', 'Researched');
    setCell(wb, T.person, 1, 'Partner account', '');
    const decoded = decodeOk(wb);
    expect(decoded.issues).toEqual([
      { tab: 'Accounts', row: 4, message: 'Target customer type is empty' },
      { tab: 'Partners', row: 2, message: 'Partner account is empty' },
      { tab: 'Partners', row: 3, message: 'Step: A step only applies in recruitment.' },
      { tab: 'Partners', row: 5, message: 'Partner account: no row on the "Accounts" tab has this ID, or that row can’t be read' },
      { tab: 'People', row: 2, message: 'Partner account is empty' },
    ]);
    expect(decoded.value.accounts.map((a) => a.id)).toEqual(['a_1', 'a_2']);
    expect(decoded.value.partners.map((p) => p.id)).toEqual(['p_3']);
    expect(decoded.value.people.map((e) => e.id)).toEqual(['e_2']);
  });

  it('keeps a person with an email it cannot read, holding it empty', () => {
    const wb = encoded();
    setCell(wb, T.person, 1, 'Email', 'eva at acme');
    const decoded = decodeOk(wb);
    expect(decoded.issues).toEqual([{ tab: 'People', row: 2, message: 'Email must be an email address or empty' }]);
    expect(decoded.value.people[0]).toMatchObject({ id: 'e_1', email: null });
    expect(decoded.unreadable.get('e_1')).toEqual(new Set(['email']));
  });

  it('converts serial dates and flags other date formats', () => {
    const wb = encoded();
    setCell(wb, T.partner, 2, 'Signed date', 46316); // 2026-10-21
    setCell(wb, T.call, 1, 'Date', '15/10/2026');
    const decoded = decodeOk(wb);
    expect(decoded.value.partners[1]!.signedDate).toBe('2026-10-21');
    expect(decoded.issues).toEqual([{ tab: 'Calls', row: 2, message: 'Date: use a date like 2026-10-21 (YYYY-MM-DD)' }]);
    expect(decoded.value.calls).toEqual([]);
  });

  it('keeps a row with an unreadable Updated cell and says it will be reset', () => {
    const wb = encoded();
    setCell(wb, T.marketLink, 1, 'Updated', 'last Tuesday');
    const decoded = decodeOk(wb);
    expect(decoded.value.marketLinks[0]).toEqual({ ...richBook().marketLinks[0], updatedAt: null });
    expect(decoded.issues).toEqual([
      { tab: 'Market links', row: 2, message: "Updated: couldn't read this timestamp; it will be reset on the next save" },
    ]);
  });

  it('reads an Updated timestamp typed without an offset as UTC, whatever the host time zone', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const wb = encoded();
      setCell(wb, T.marketLink, 1, 'Updated', '2026-10-21T10:00');
      setCell(wb, T.person, 1, 'Updated', '2026-10-21 10:00:30');
      setCell(wb, T.call, 1, 'Updated', '2026-10-21');
      setCell(wb, T.partner, 1, 'Updated', 46316.5);
      const decoded = decodeOk(wb);
      expect(decoded.value.marketLinks[0]!.updatedAt).toBe('2026-10-21T10:00:00.000Z');
      expect(decoded.value.people[0]!.updatedAt).toBe('2026-10-21T10:00:30.000Z');
      expect(decoded.value.calls[0]!.updatedAt).toBe('2026-10-21T00:00:00.000Z');
      expect(decoded.value.partners[0]!.updatedAt).toBe('2026-10-21T12:00:00.000Z');
      expect(decoded.issues).toEqual([]);
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it('keeps the offset of an Updated timestamp that has one', () => {
    const wb = encoded();
    setCell(wb, T.marketLink, 1, 'Updated', '2026-10-21T10:00+02:00');
    setCell(wb, T.person, 1, 'Updated', '2026-10-21 10:00Z');
    const decoded = decodeOk(wb);
    expect(decoded.value.marketLinks[0]!.updatedAt).toBe('2026-10-21T08:00:00.000Z');
    expect(decoded.value.people[0]!.updatedAt).toBe('2026-10-21T10:00:00.000Z');
  });

  it('reads an empty Updated by as someone in the sheet, without an issue', () => {
    const wb = encoded();
    setCell(wb, T.person, 1, 'Updated by', ' ');
    const decoded = decodeOk(wb);
    expect(decoded.value.people[0]!.updatedBy).toBe('Someone in the sheet');
    expect(decoded.issues).toEqual([]);
  });

  it('keeps unknown columns where an encoder can put them back', () => {
    const wb = encoded();
    wb[T.partner] = wb[T.partner]!.map((row, i) => [...row, i === 0 ? 'My notes' : `note ${i}`]);
    const original = wb[T.partner]![2]!.slice();
    const decoded = decodeOk(wb);
    expect(decoded.value.partners).toEqual(richBook().partners);
    const p2 = decoded.value.partners.find((p) => p.id === 'p_2')!;
    const location = decoded.locations.get('p_2')!;
    expect(encodeRow(PARTNERS_LAYOUT.columns.partner, p2, decoded.columns.partner, wb[location.tab]![location.row - 1])).toEqual(original);
    expect(original.at(-1)).toBe('note 2');
  });

  it('reads columns in any order', () => {
    const wb = encoded();
    wb[T.call] = wb[T.call]!.map((row) => row.slice().reverse());
    const decoded = decodeOk(wb);
    expect(decoded.value.calls).toEqual(richBook().calls);
    const location = decoded.locations.get('k_1')!;
    expect(encodeRow(PARTNERS_LAYOUT.columns.call, decoded.value.calls[0]!, decoded.columns.call, [])).toEqual(wb[location.tab]![location.row - 1]);
  });

  it('decodes rows without an ID under a provisional id', () => {
    const wb = encoded();
    setCell(wb, T.partner, 4, 'ID', '');
    setCell(wb, T.partner, 3, 'ID', ' ');
    setCell(wb, T.partner, 3, 'Stage', 'Pending');
    const decoded = decodeOk(wb);
    expect(decoded.value.partners.map((p) => p.id)).toEqual(['p_1', 'p_2', 'tmp_partner_5']);
    expect(decoded.missingIds).toEqual([{ entity: 'partner', row: 5, provisionalId: 'tmp_partner_5' }]);
    expect(decoded.locations.get('tmp_partner_5')).toEqual({ entity: 'partner', tab: 'Partners', row: 5 });
    expect(decoded.issues).toEqual([{ tab: 'Partners', row: 4, message: 'Stage must be one of Recruitment, Onboarding, Growth, Expansion, Exit' }]);
  });

  it('keeps both copies of a pasted row and flags the duplicate id', () => {
    const wb = encoded();
    wb[T.person]!.push(wb[T.person]![1]!.slice());
    const decoded = decodeOk(wb);
    expect(decoded.value.people.map((e) => e.id)).toEqual(['e_1', 'e_2', 'tmp_person_4']);
    expect(decoded.missingIds).toEqual([{ entity: 'person', row: 4, provisionalId: 'tmp_person_4' }]);
    expect(decoded.issues).toEqual([{ tab: 'People', row: 4, message: 'Duplicate ID: a new one will be assigned on the next save' }]);
  });

  it('skips blank rows silently', () => {
    const wb = encoded();
    wb[T.partner]!.splice(2, 0, ['', null, '   ']);
    wb[T.partner]!.push([]);
    const decoded = decodeOk(wb);
    expect(decoded.value.partners).toEqual(richBook().partners);
    expect(decoded.issues).toEqual([]);
  });

  it('keeps a row that points to a deleted partner, for the app to flag', () => {
    const wb = encoded();
    wb[T.partner]!.splice(1, 1);
    const decoded = decodeOk(wb);
    expect(decoded.value.calls.find((k) => k.id === 'k_1')?.partnerId).toBe('p_1');
    expect(decoded.issues).toEqual([]);
  });

  it('keeps a person whose company is gone, for the app to flag', () => {
    const wb = encoded();
    wb[T.account]!.splice(1, 1);
    wb[T.partner] = wb[T.partner]!.filter((row) => row[1] !== 'a_1');
    const decoded = decodeOk(wb);
    expect(decoded.value.people.find((e) => e.id === 'e_1')?.accountId).toBe('a_1');
    expect(decoded.issues).toEqual([]);
  });

  it('leaves out a partner type whose company isn’t on the Accounts tab, counts it, and never writes it', () => {
    const wb = encoded();
    setCell(wb, T.partner, 2, 'Partner account', 'a_gone1');
    const decoded = decodeOk(wb);
    expect(decoded.issues).toEqual([
      { tab: 'Partners', row: 3, message: 'Partner account: no row on the "Accounts" tab has this ID, or that row can’t be read' },
    ]);
    expect(decoded.value.partners.map((p) => p.id)).toEqual(['p_1', 'p_3', 'p_4']);
    expect(decoded.locations.has('p_2')).toBe(false);
    expect(decoded.unreadable.has('p_2')).toBe(false);
    // Its market link and its company's people stay, for the app to flag.
    expect(decoded.value.marketLinks.map((l) => l.id)).toEqual(['l_1', 'l_2']);
    expect(decoded.value.people.map((e) => e.id)).toEqual(['e_1', 'e_2']);
  });

  it('leaves out the partner types of a company whose row can’t be read, without an ID of its own', () => {
    const wb = encoded();
    setCell(wb, T.account, 1, 'Company', ' ');
    setCell(wb, T.partner, 3, 'ID', '');
    const decoded = decodeOk(wb);
    expect(decoded.issues.map((i) => [i.tab, i.row])).toEqual([['Accounts', 2], ['Partners', 2], ['Partners', 4]]);
    expect(decoded.value.partners.map((p) => p.id)).toEqual(['p_2', 'p_4']);
    expect(decoded.missingIds).toEqual([]);
  });

  it('never puts what a cell holds into an issue', () => {
    const wb = encoded();
    setCell(wb, T.partner, 1, 'Stage', 'SECRET-1');
    setCell(wb, T.partner, 2, 'Desk: Capability', 'SECRET-2');
    setCell(wb, T.person, 1, 'Email', 'SECRET-3');
    setCell(wb, T.call, 1, 'Date', 'SECRET-4');
    setCell(wb, T.marketLink, 1, 'Updated', 'SECRET-5');
    setCell(wb, T.person, 2, 'Active seller', 'SECRET-6');
    setCell(wb, T.partner, 3, 'Signed date', 'SECRET-7');
    setCell(wb, T.account, 2, 'Target customer type', 'SECRET-8');
    setCell(wb, T.partner, 4, 'Partner account', 'SECRET-9');
    const decoded = decodeOk(wb);
    // The Beta AG row is left out, and with it Beta's partner (p_2), which already had an issue of its own.
    expect(decoded.issues).toHaveLength(10);
    for (const issue of decoded.issues) expect(issue.message).not.toContain('SECRET');
  });
});

describe('decodePartnerBook: a partner type’s program and level', () => {
  const PARTNERS = T.partner;

  it('writes the current version, with Program and Level on the Partners tab, and reads them back', () => {
    const wb = encoded();
    expect(wb['_meta']![1]).toEqual(['schemaVersion', 5]);
    const header = wb[PARTNERS]![0]!;
    expect(header).toContain('Program');
    expect(header).toContain('Level');
    expect(wb[PARTNERS]![2]![header.indexOf('Program')]).toBe('pg_dach0001');
    expect(wb[PARTNERS]![2]![header.indexOf('Level')]).toBe('Preferred');
    const decoded = decodeOk(wb);
    expect(decoded.value.partners.map((p) => [p.id, p.programId, p.level])).toEqual([
      ['p_1', null, null], ['p_2', 'pg_dach0001', 'pref'], ['p_3', null, null], ['p_4', null, null],
    ]);
    expect(decoded.upgrade).toEqual([]);
  });

  it('reads a version 2 file with no program links, and says how the next save upgrades it', () => {
    const v2 = asPartnersVersion2(encoded());
    // A column the person added, after the app's own.
    const width = v2[PARTNERS]![0]!.length;
    v2[PARTNERS]![0]![width] = 'My notes';
    v2[PARTNERS]![3]![width] = 'Call in May';
    const decoded = decodeOk(v2);
    expect(decoded.issues).toEqual([]);
    expect(decoded.value).toEqual({
      ...richBook(), partners: richBook().partners.map((p) => ({ ...p, programId: null, level: null, mapHealth: null, mapNextMilestone: null })),
    });
    // The new columns go after every column in use, the person's own included, version 3's first.
    expect(decoded.columns.partner.programId).toBe(width + 1);
    expect(decoded.columns.partner.level).toBe(width + 2);
    expect(decoded.columns.partner.mapHealth).toBe(width + 3);
    expect(decoded.columns.partner.mapNextMilestone).toBe(width + 4);
    expect(decoded.upgrade).toEqual([
      { tab: PARTNERS, row: 1, col: width + 1, value: 'Program', anchorCol: 0 },
      { tab: PARTNERS, row: 1, col: width + 2, value: 'Level', anchorCol: 0 },
      { tab: PARTNERS, row: 1, col: width + 3, value: 'MAP health', anchorCol: 0 },
      { tab: PARTNERS, row: 1, col: width + 4, value: 'Next milestone', anchorCol: 0 },
      ...PROPOSALS_UPGRADE,
      { tab: '_meta', row: 2, col: 1, value: 5, anchorCol: 0 },
    ]);
  });

  it('keeps a Program or Level column a version 2 file already has, and adds only the other', () => {
    const v2 = asPartnersVersion2(encoded());
    const width = v2[PARTNERS]![0]!.length;
    v2[PARTNERS]![0]![width] = 'level';
    const decoded = decodeOk(v2);
    expect(decoded.columns.partner.level).toBe(width);
    expect(decoded.upgrade.filter((c) => c.tab === PARTNERS)).toEqual([
      { tab: PARTNERS, row: 1, col: width + 1, value: 'Program', anchorCol: 0 },
      { tab: PARTNERS, row: 1, col: width + 2, value: 'MAP health', anchorCol: 0 },
      { tab: PARTNERS, row: 1, col: width + 3, value: 'Next milestone', anchorCol: 0 },
    ]);
  });

  it('still reads a version 1 file as old, never upgraded', () => {
    const wb = asPartnersVersion2(encoded());
    wb['_meta']![1]![1] = 1;
    expect(decodeError(wb)).toMatchObject({ kind: 'old_version' });
  });

  it('leaves out a row whose Level can’t be read, like any unreadable list value', () => {
    const wb = encoded();
    setCell(wb, PARTNERS, 2, 'Level', 'Gold');
    const decoded = decodeOk(wb);
    expect(decoded.value.partners.map((p) => p.id)).toEqual(['p_1', 'p_3', 'p_4']);
    expect(decoded.issues).toEqual([{ tab: PARTNERS, row: 3, message: 'Level must be one of Registered, Preferred' }]);
    expect(decoded.locations.has('p_2')).toBe(false);
  });

  it('leaves out a row with a level and no program', () => {
    const wb = encoded();
    setCell(wb, PARTNERS, 2, 'Program', '');
    const decoded = decodeOk(wb);
    expect(decoded.value.partners.map((p) => p.id)).toEqual(['p_1', 'p_3', 'p_4']);
    expect(decoded.issues).toEqual([{ tab: PARTNERS, row: 3, message: 'Level: Pick a program before a level.' }]);
  });

  it('reads a level typed by hand in any case, and a program without a level as no level', () => {
    const wb = encoded();
    setCell(wb, PARTNERS, 2, 'Level', 'registered');
    setCell(wb, PARTNERS, 1, 'Program', 'pg_dach0001');
    const partners = decodeOk(wb).value.partners;
    expect(partners.find((p) => p.id === 'p_2')!.level).toBe('reg');
    expect(partners.find((p) => p.id === 'p_1')).toMatchObject({ programId: 'pg_dach0001', level: null });
  });
});

describe('decodePartnerBook: a partner type’s MAP health and next milestone (version 4)', () => {
  const PARTNERS = T.partner;

  it('writes them as a label and a date, and reads them back', () => {
    const wb = encoded();
    const header = wb[PARTNERS]![0]!;
    expect(wb[PARTNERS]![2]![header.indexOf('MAP health')]).toBe('At risk');
    expect(wb[PARTNERS]![2]![header.indexOf('Next milestone')]).toBe('2026-11-20');
    expect(decodeOk(wb).value.partners.map((p) => [p.id, p.mapHealth, p.mapNextMilestone])).toEqual([
      ['p_1', null, null], ['p_2', 'at_risk', '2026-11-20'], ['p_3', null, null], ['p_4', null, null],
    ]);
  });

  it('reads a version 3 file with no MAP fields, and says how the next save upgrades it', () => {
    const v3 = asPartnersVersion3(encoded());
    const width = v3[PARTNERS]![0]!.length;
    v3[PARTNERS]![0]![width] = 'My notes';
    v3[PARTNERS]![2]![width] = 'Call in May';
    const decoded = decodeOk(v3);
    expect(decoded.issues).toEqual([]);
    expect(decoded.value).toEqual({ ...richBook(), partners: richBook().partners.map((p) => ({ ...p, mapHealth: null, mapNextMilestone: null })) });
    expect(decoded.columns.partner.mapHealth).toBe(width + 1);
    expect(decoded.columns.partner.mapNextMilestone).toBe(width + 2);
    expect(decoded.upgrade).toEqual([
      { tab: PARTNERS, row: 1, col: width + 1, value: 'MAP health', anchorCol: 0 },
      { tab: PARTNERS, row: 1, col: width + 2, value: 'Next milestone', anchorCol: 0 },
      ...PROPOSALS_UPGRADE,
      { tab: '_meta', row: 2, col: 1, value: 5, anchorCol: 0 },
    ]);
  });

  it('keeps a row whose MAP health or next milestone can’t be read, with that value empty', () => {
    const wb = encoded();
    setCell(wb, PARTNERS, 2, 'MAP health', 'Fine');
    setCell(wb, PARTNERS, 1, 'Next milestone', 'soon');
    const decoded = decodeOk(wb);
    expect(decoded.value.partners.map((p) => [p.id, p.mapHealth, p.mapNextMilestone])).toEqual([
      ['p_1', null, null], ['p_2', null, '2026-11-20'], ['p_3', null, null], ['p_4', null, null],
    ]);
    expect(decoded.issues).toEqual([
      { tab: PARTNERS, row: 2, message: 'Next milestone: use a date like 2026-10-21 (YYYY-MM-DD)' },
      { tab: PARTNERS, row: 3, message: 'MAP health must be one of On track, At risk, Off track' },
    ]);
    expect(decoded.unreadable.get('p_2')).toEqual(new Set(['mapHealth']));
    expect(decoded.unreadable.get('p_1')).toEqual(new Set(['mapNextMilestone']));
  });
});

describe('decodePartnerBook: the Proposals tab (version 5)', () => {
  const PROPOSALS = 'Proposals';

  it('writes every Proposals row with its lists as labels, and reads them back', () => {
    const wb = encoded(bookWithProposals());
    expect(wb[PROPOSALS]![0]).toEqual(PROPOSALS_HEADER);
    expect(wb[PROPOSALS]![2]).toEqual([
      'r_2', 'prp_2', 'New partner', '', '', 'm_abcdefghij', 'h_1', 'Zeta GmbH', 'New partner', 'Zeta GmbH', 'Website: zeta.example\nCountry: Austria',
      'Sells to IT firms', 'Claude for Ruth', 'Rejected', 'Too small', '2026-10-01T09:00:00.000Z', '2026-10-02T08:00:00.000Z',
      '2026-10-31T09:00:00.000Z', '', '2026-10-02T08:00:00.000Z', 'Ruth',
    ]);
    const decoded = decodeOk(wb);
    expect(decoded.value).toEqual(bookWithProposals());
    expect(decoded.issues).toEqual([]);
    expect(decoded.locations.get('r_3')).toEqual({ entity: 'proposalItem', tab: PROPOSALS, row: 4 });
  });

  it('reads the lists typed by hand, and leaves out a row whose Status or Kind can’t be read', () => {
    const wb = encoded(bookWithProposals());
    setCell(wb, PROPOSALS, 1, 'What', 'credibility (desk check)');
    setCell(wb, PROPOSALS, 2, 'Status', 'Maybe');
    setCell(wb, PROPOSALS, 3, 'Kind', '');
    const decoded = decodeOk(wb);
    expect(decoded.value.proposalItems.map((r) => [r.id, r.what])).toEqual([['r_1', 'desk.credibility']]);
    expect(decoded.issues).toEqual([
      { tab: PROPOSALS, row: 3, message: 'Status must be one of Waiting, Accepted, Rejected, Withdrawn, Replaced, Expired, Not sent' },
      { tab: PROPOSALS, row: 4, message: 'Kind is empty' },
    ]);
  });

  it('keeps a row with an unreadable Answered on or Target updated, holding it empty, and says which value it could not read', () => {
    const wb = encoded(bookWithProposals());
    setCell(wb, PROPOSALS, 1, 'Target updated', 'last Tuesday');
    setCell(wb, PROPOSALS, 2, 'Answered on', 'yesterday');
    const decoded = decodeOk(wb);
    expect(decoded.value.proposalItems.map((r) => r.id)).toEqual(['r_1', 'r_2', 'r_3']);
    expect(decoded.value.proposalItems[0]).toEqual({ ...bookWithProposals().proposalItems[0], targetUpdated: null });
    expect(decoded.value.proposalItems[1]).toEqual({ ...bookWithProposals().proposalItems[1], answeredOn: null });
    expect(decoded.unreadable).toEqual(new Map([['r_1', new Set(['targetUpdated'])], ['r_2', new Set(['answeredOn'])]]));
    expect(decoded.issues.map((i) => [i.tab, i.row])).toEqual([[PROPOSALS, 2], [PROPOSALS, 3]]);
  });

  it('a version 4 file reads with no proposal rows and no issue', () => {
    const v4 = asPartnersVersion4(encoded());
    expect(v4[PROPOSALS]).toBeUndefined();
    const decoded = decodeOk(v4);
    expect(decoded.value).toEqual({ ...richBook(), proposalItems: [] });
    expect(decoded.issues).toEqual([]);
    expect(decoded.columns.proposalItem).toEqual(Object.fromEntries(PARTNERS_LAYOUT.columns.proposalItem.map((c, i) => [c.key, i])));
  });

  it('upgrade 4 to 5 adds the Proposals header row and sets _meta to 5', () => {
    const v4 = asPartnersVersion4(encoded());
    expect(v4['_meta']![1]).toEqual(['schemaVersion', 4]);
    expect(decodeOk(v4).upgrade).toEqual([...PROPOSALS_UPGRADE, { tab: '_meta', row: 2, col: 1, value: 5, anchorCol: 0 }]);
    // A Proposals tab a save made before its header was written is empty: it gets the header too.
    const empty = { ...v4, [PROPOSALS]: [[], ['']] };
    expect(decodeOk(empty).upgrade).toEqual([...PROPOSALS_UPGRADE, { tab: '_meta', row: 2, col: 1, value: 5, anchorCol: 0 }]);
    // A current file has nothing to upgrade.
    expect(decodeOk(encoded()).upgrade).toEqual([]);
  });

  it('a Proposals tab with anything in it is left alone and the decoder names the missing column', () => {
    const v4 = asPartnersVersion4(encoded());
    // A tab of the person's own that happens to have the name.
    v4[PROPOSALS] = [['Idea', 'Who'], ['Ask Acme about training', 'Ruth']];
    expect(decodeError(v4)).toEqual({ kind: 'missing_column', tab: PROPOSALS, message: 'The "Proposals" tab is missing the "ID" column' });
    // Nor does it get the header when the tab only lacks some columns: those are named.
    const partial = asPartnersVersion4(encoded());
    partial[PROPOSALS] = [PROPOSALS_HEADER.filter((h) => h !== 'Evidence or reason')];
    expect(decodeError(partial)).toEqual({
      kind: 'missing_column', tab: PROPOSALS, message: 'The "Proposals" tab is missing the "Evidence or reason" column',
    });
  });

  it('names a missing Proposals tab in a version 5 file', () => {
    const wb = encoded();
    delete wb[PROPOSALS];
    expect(decodeError(wb)).toEqual({ kind: 'missing_tab', tab: PROPOSALS, message: 'The "Proposals" tab is missing' });
  });
});
