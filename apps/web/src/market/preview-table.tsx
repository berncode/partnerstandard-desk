'use client';

// The notes are the Partner book's duplicate kinds, and rows already here, repeated or excluded can't be ticked. Words from COPY.
import { safeHref, type PreviewRow } from '@partner-desk/core';
import { type PartnerType } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { cn } from '@/ui/cn';
import { canTick, rowNote } from './import-model';

/** A cell of imported text: always plain text, never HTML, cut to a few lines on screen. */
function TextCell({ value, className }: { value: string | undefined; className?: string }) {
  return <td className={cn('px-2 py-2 align-top', className)}><span className="line-clamp-3 break-words">{value ?? ''}</span></td>;
}

/**
 * The import preview: one row per company with a tick box and, under the company, what the duplicate check found. The
 * website is a link only when it starts with http:// or https://.
 */
export function PreviewTable({ rows, partnerType, onToggle, disabled = false }: {
  rows: readonly PreviewRow[]; partnerType: PartnerType; onToggle: (index: number, selected: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className="max-h-[50vh] overflow-auto rounded-xl border border-line">
      <table aria-label={COPY.PREVIEW} className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <thead className="sticky top-0 bg-surface-2 text-xs text-ink-3">
          <tr>
            <th scope="col" className="w-10 px-2 py-2"><span className="sr-only">{COPY.IMPORT}</span></th>
            <th scope="col" className="px-2 py-2 font-medium">{COPY.FIELD_COMPANY}</th>
            <th scope="col" className="px-2 py-2 font-medium">{COPY.FIELD_WEBSITE}</th>
            <th scope="col" className="px-2 py-2 font-medium">{COPY.FIELD_COUNTRY}</th>
            <th scope="col" className="px-2 py-2 font-medium">{COPY.FIELD_WHY_IT_FITS}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const company = row.values.Company ?? '';
            const website = row.values.Website ?? '';
            const href = safeHref(website);
            const note = rowNote(row, partnerType);
            const tickable = canTick(row);
            const ticked = row.selected && tickable;
            return (
              <tr key={index} className={cn('border-t border-line', !ticked && 'text-ink-3')}>
                <td className="px-2 py-2 align-top">
                  <input type="checkbox" aria-label={COPY.IMPORT_ROW(company)} checked={ticked}
                    disabled={disabled || !tickable} onChange={(e) => onToggle(index, e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-brand-strong disabled:opacity-50" />
                </td>
                <td className="px-2 py-2 align-top">
                  <span className="block font-medium break-words text-ink">{company}</span>
                  {note && <span className={cn('block text-xs', note.problem ? 'text-danger' : 'text-warn')}>{note.text}</span>}
                </td>
                <td className="max-w-48 px-2 py-2 align-top break-all">
                  {href ? <a href={href} target="_blank" rel="noopener noreferrer"
                    className="rounded text-brand-strong underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand">{website}</a> : website}
                </td>
                <TextCell value={row.values.Country} />
                <TextCell value={row.values['Why it fits']} className="min-w-48" />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
