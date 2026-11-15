// The guide on a company server (plan 13, task 13; spec 2026-11-07 §12): the lines that speak of Google Drive, Google
// Sheets or the PartnerStandard Desk folder, as a company server says them. Every other line is the hosted guide's, unchanged.
// The app's own words, under AGPL 3.0 like the code (plan 18, task 2).
import { COPY, DATABASE_COPY } from './copy';
import { GUIDE_QUESTIONS, GUIDE_SECTIONS, ui, type GuidePart, type GuideQuestion, type GuideSection } from './guide';

/**
 * Hosted line → the company server's line, or null to leave it out. Keyed by the whole hosted line, so a change to one
 * fails the test that every key is still in the guide.
 */
export const DATABASE_GUIDE_LINES: ReadonlyMap<string, string | null> = new Map<string, string | null>([
  // The idea
  ['Your work lives in your own Google Drive, in the folder PartnerStandard / PartnerStandard Desk. Those files are the app’s database: '
    + 'work in the app, share through its links, and don’t edit, move or delete them in Drive.',
  'Your work lives in your company’s own database, on its own server. Work in the app and share through its links. '
    + `When you need a file, ${ui(DATABASE_COPY.OPEN_IN_SHEETS)} gives you a copy.`],
  // Set up once
  [`${ui(COPY.SETTINGS_STORAGE)} shows where your files are: the folder PartnerStandard / PartnerStandard Desk in your Google Drive.`,
    `${ui(COPY.SETTINGS_STORAGE)} shows where your work is: your company’s own database. Under ${ui(COPY.MEMBERS_TITLE)}, an admin invites `
      + `colleagues by email as ${ui(COPY.MEMBERS_ROLES.partnerManager)} or ${ui(COPY.MEMBERS_ROLES.viewer)}: everyone sees the same partners, and a viewer changes nothing. `
      + `Under ${ui(COPY.TRASH_TITLE)}, an admin brings back a deleted case, MAP or program; its old links stay off.`],
  [`${ui(COPY.SETTINGS_DELETE)} removes your account, your company name and your list of files from PartnerStandard Desk. Your spreadsheets stay in your Google Drive.`,
    `${ui(COPY.SETTINGS_DELETE)} removes your account and signs you out. Your company’s partner work stays in its database. The last admin makes someone else an admin first.`],
  // Markets, programs, MAP, business cases
  ['Each market is a spreadsheet in the folder PartnerStandard / PartnerStandard Desk.',
    `Each market is kept in your company’s database. ${ui(DATABASE_COPY.OPEN_IN_SHEETS)} gives you a copy.`],
  [`Each program is a spreadsheet in the folder PartnerStandard / PartnerStandard Desk. The ${ui(COPY.PROG_SHEET_TITLE)} and the public page are tabs in it.`,
    `Each program is kept in your company’s database. ${ui(DATABASE_COPY.OPEN_IN_SHEETS)} gives you a copy, with the ${ui(COPY.PROG_SHEET_TITLE)} and the public page as tabs in it.`],
  ['Each MAP is a spreadsheet in the folder PartnerStandard / PartnerStandard Desk.',
    `Each MAP is kept in your company’s database. ${ui(DATABASE_COPY.MAP_OPEN_SHEET)} gives you a copy as a spreadsheet.`],
  ['The partner’s link shows their side only, as it is now. Each case is a spreadsheet in the folder PartnerStandard / PartnerStandard Desk.',
    `The partner’s link shows their side only, as it is now. Each case is kept in your company’s database. ${ui(DATABASE_COPY.OPEN_IN_SHEETS)} gives you a copy.`],
  // Onboarding: a company server's MAP emails go to its admins and partner managers, never to a viewer (owner, 2026-11-14)
  ['Activity owners with an email get a reminder before an activity is due, and weekly while it is overdue. You get an email when someone changes the MAP through their link.',
    'Activity owners with an email get a reminder before an activity is due, and weekly while it is overdue. You get an email when someone changes the MAP through their link. Viewers don’t get this email.'],
  [`Each Monday you get one email with your MAPs’ news: done, due, overdue and blocked. Choose your emails under ${ui(COPY.SETTINGS_EMAILS)} in ${ui(COPY.NAV_SETTINGS)}.`,
    `Each Monday you get one email with your MAPs’ news: done, due, overdue and blocked. Viewers don’t get it. Choose your emails under ${ui(COPY.SETTINGS_EMAILS)} in ${ui(COPY.NAV_SETTINGS)}.`],
  // Closing before signing
  [`Removing a partner type is different: the remove button under the stepper takes that type out of ${ui(COPY.NAV_PARTNERS)}, and with the company’s last type, the company and its contacts too. `
    + 'You choose whether its cases and MAP go to the Drive trash or stay in Drive; either way their links stop working. To stop working with a partner, close it or exit it.',
  `Removing a partner type is different: the remove button under the stepper takes that type out of ${ui(COPY.NAV_PARTNERS)}, and with the company’s last type, the company and its contacts too. `
    + 'Its cases and MAP go to the trash, and their links stop working; they can come back only with the partner type. To stop working with a partner, close it or exit it.'],
  // Agents and the API
  [`Under ${ui(COPY.AGENTS_TITLE)}, click ${ui(COPY.TURN_OFF)} beside it. It stops at once. Your Google sign-in stays as it is.`,
    `Under ${ui(COPY.AGENTS_TITLE)}, click ${ui(COPY.TURN_OFF)} beside it. It stops at once.`],
]);

/**
 * Answers by question, each with the hosted answer it replaces, so a change to that answer fails the test until its
 * company server answer follows. A null answer leaves the question out (there is no sheet to edit, and no Google sign-in).
 */
export const DATABASE_GUIDE_ANSWERS: ReadonlyMap<string, { hosted: string; answer: string | null }> = new Map([
  ['Where are my files?', {
    hosted: 'In your Google Drive, in the folder PartnerStandard / PartnerStandard Desk: your partners, each market, MAP, business case and program are spreadsheets there. '
      + `${ui(COPY.SETTINGS_STORAGE)} in ${ui(COPY.NAV_SETTINGS)} shows it. Deleting a case, a MAP or a program in the app moves its file to the Drive trash, where you can restore it.`,
    answer: 'In your company’s own database, on its server: your partners, each market, MAP, business case and program. '
      + `${ui(COPY.SETTINGS_STORAGE)} in ${ui(COPY.NAV_SETTINGS)} shows it. Each market, MAP, business case and program page has ${ui(DATABASE_COPY.OPEN_IN_SHEETS)} or ${ui(DATABASE_COPY.MAP_OPEN_SHEET)}, which gives you a copy. `
      + 'Deleting a case, a MAP or a program moves it to the trash, where an admin can restore it later.',
  }],
  ['What happens if I edit a sheet by hand?', {
    hosted: 'Please don’t. The folder PartnerStandard / PartnerStandard Desk is the app’s database: work in the app, share through its links. Only an admin who knows what a change does should edit, move or delete its files. If a file is changed, the app re-reads it before it saves, changes only your rows and leaves rows it can’t read alone. A case, program or activity changed in the sheet asks you to refresh.',
    answer: null,
  }],
  [`What does ${COPY.SETTINGS_DELETE} remove?`, {
    hosted: `${ui(COPY.SETTINGS_DELETE)} in ${ui(COPY.NAV_SETTINGS)} removes your account, your company name and your list of files from PartnerStandard Desk, and every link you shared stops working. `
      + 'Your spreadsheets stay in your Google Drive.',
    answer: `${ui(COPY.SETTINGS_DELETE)} in ${ui(COPY.NAV_SETTINGS)} removes your account and signs you out, and every link you shared stops working. `
      + 'Your company’s partner work stays in its database.',
  }],
  [`Why doesn’t ${COPY.SETTINGS_DELETE} sign me out of Google?`, {
    hosted: 'All PartnerStandard tools share one Google sign-in, and PartnerStandard Desk never takes it away, so the other tools keep working. '
      + `To remove that access, use ${ui(COPY.GOOGLE_CONNECTIONS_LINK)}, linked in ${ui(COPY.NAV_SETTINGS)}. That signs you out of the other PartnerStandard tools too.`,
    answer: null,
  }],
]);

const swap = (line: string): string[] => {
  if (!DATABASE_GUIDE_LINES.has(line)) return [line];
  const next = DATABASE_GUIDE_LINES.get(line);
  return next === null || next === undefined ? [] : [next];
};

/** A part with its lines swapped; a table cell or a card's line is swapped in place (none is left out). */
const swapPart = (part: GuidePart): GuidePart => ({
  ...part,
  ...(part.lines ? { lines: part.lines.flatMap(swap) } : {}),
  ...(part.groups ? { groups: part.groups.map((g) => ({ ...g, steps: g.steps.flatMap(swap), ...(g.note ? { note: swap(g.note)[0] ?? g.note } : {}) })) } : {}),
  ...(part.table ? { table: { head: part.table.head, rows: part.table.rows.map((row) => row.map((cell) => swap(cell)[0] ?? cell)) } } : {}),
});

const DATABASE_SECTIONS: GuideSection[] = GUIDE_SECTIONS.map((section) => ({
  ...section,
  why: swap(section.why)[0] ?? section.why,
  steps: section.steps.flatMap(swap),
  appDoes: section.appDoes.flatMap(swap),
  ...(section.parts ? { parts: section.parts.map(swapPart) } : {}),
}));

const DATABASE_QUESTIONS: GuideQuestion[] = GUIDE_QUESTIONS.flatMap((pair) => {
  const swapped = DATABASE_GUIDE_ANSWERS.get(pair.question);
  if (!swapped) return [pair];
  return swapped.answer === null ? [] : [{ ...pair, answer: swapped.answer }];
});

/** The guide for where the work lives: the company server's lines on the database, the hosted guide itself otherwise. */
export function guideFor(storage: 'google' | 'memory' | 'database'): { sections: GuideSection[]; questions: GuideQuestion[] } {
  return storage === 'database'
    ? { sections: DATABASE_SECTIONS, questions: DATABASE_QUESTIONS }
    : { sections: GUIDE_SECTIONS, questions: GUIDE_QUESTIONS };
}
