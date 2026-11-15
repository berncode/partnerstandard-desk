import { Fragment } from 'react';

/** A guide text: a name the app shows is written `**name**` (`ui()` in the method pack) and comes out bold. */
export function GuideText({ text }: { text: string }) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    // split() with one group puts the marked names at the odd places.
    i % 2 === 1 ? <strong key={i} className="font-semibold text-ink">{part}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}
