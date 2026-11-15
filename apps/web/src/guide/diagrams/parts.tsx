// Shared pieces of the guide's drawings. Colors are the theme's classes only, so light and dark both work.
import type { ReactNode } from 'react';

export const TEXT = 'fill-ink text-xs';
export const MUTED = 'fill-ink-3 text-xs';
export const HEAD = 'fill-ink text-xs font-semibold';
export const LINE = 'stroke-ink-2 fill-none';
export const LINE_MUTED = 'stroke-ink-3 fill-none';
export const BOX = 'fill-surface stroke-line';
export const BOX_DASHED = 'fill-surface stroke-ink-3 [stroke-dasharray:5_4]';
export const BAR = 'fill-surface-2';
export const BAR_DRAFT = 'fill-none stroke-ink-3 [stroke-dasharray:5_4]';
export const CLOSED = 'fill-canvas stroke-ink-3 [stroke-dasharray:4_3]';

/** The arrow head, drawn in the line's own color. `id` is unique per drawing, since several share a page. */
export function ArrowMarker({ id }: { id: string }) {
  return (
    <defs>
      <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
      </marker>
    </defs>
  );
}

/** A line of text, centered on x unless `start`. */
export function T({ x, y, children, cls = TEXT, start = false }: { x: number; y: number; children: ReactNode; cls?: string; start?: boolean }) {
  return (
    <text className={cls} x={x} y={y} textAnchor={start ? 'start' : 'middle'}>
      {children}
    </text>
  );
}
