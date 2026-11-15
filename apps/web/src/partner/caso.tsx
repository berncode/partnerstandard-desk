'use client';

import { CASO_ANSWERS, type CasoAnswer } from '@partner-desk/core';
import { CASO_HELP, CASO_LETTERS, type CasoLetter } from '@partner-desk/method';
import { CASO_ANSWER_LABELS, COPY } from '@partner-desk/copy';
import { ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '@/ui/cn';
import { InlineText } from '@/ui/inline-text';
import { useQualification } from './desk-check';
import { sayIfRefused, usePartner } from './partner-context';

function Letter({ letter }: { letter: CasoLetter }) {
  const { readOnly } = usePartner();
  const { qualification, edit } = useQualification();
  const value = qualification?.caso[letter] ?? { answer: null, note: '' };
  const id = useId();
  const set = (patch: Partial<typeof value>) => edit({ caso: { [letter]: patch } });
  const { label, question } = CASO_HELP[letter];
  return (
    <li className="grid min-w-0 gap-2 rounded-lg border border-line p-3">
      <div role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={`${id}-help`} className="grid gap-1.5">
        <p id={`${id}-label`} className="text-sm font-medium">{label}</p>
        <p id={`${id}-help`} className="text-xs text-ink-3">{question}</p>
        <div className="flex flex-wrap gap-4">
          {CASO_ANSWERS.map((answer: CasoAnswer) => (
            <label key={answer} className="inline-flex items-center gap-1.5 text-sm">
              <input type="radio" name={`${id}-answer`} value={answer} checked={value.answer === answer} disabled={readOnly}
                onChange={() => sayIfRefused(set({ answer }))} className="h-4 w-4 accent-brand-strong" />
              {CASO_ANSWER_LABELS[answer]}
            </label>
          ))}
        </div>
      </div>
      <InlineText value={value.note} label={COPY.NOTE_ON(label)} field={`caso.${letter}.note`} disabled={readOnly}
        placeholder={COPY.NOTE} className="text-sm" onCommit={(note) => set({ note })} />
    </li>
  );
}

/** CASO (optional): folded away until asked for, with the help question for each letter. */
export function Caso() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="grid gap-3">
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}
        className="inline-flex w-fit items-center gap-1.5 rounded text-sm font-semibold outline-none hover:text-brand-strong focus-visible:ring-2 focus-visible:ring-brand">
        <ChevronDown className={cn('h-4 w-4 transition-transform', !open && '-rotate-90')} aria-hidden />
        {COPY.CASO} <span className="font-normal text-ink-3">{COPY.OPTIONAL}</span>
      </button>
      {open && (
        <ul id={panelId} className="grid gap-3 sm:grid-cols-2">
          {CASO_LETTERS.map((letter) => <Letter key={letter} letter={letter} />)}
        </ul>
      )}
    </div>
  );
}
