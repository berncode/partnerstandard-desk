// The path of a proposal, drawn for the guide: the second of the two pictures in Agents and the API, in the theme's
// colors. Wider than a phone: the guide puts it in a frame that scrolls.
import { GUIDE_DIAGRAMS } from '@partner-desk/copy';
import { ArrowMarker, BOX, LINE, T } from './parts';

// Larger than the small pictures' text: a wide picture shrinks to the column on a laptop.
const HEAD = 'fill-ink text-[15px] font-semibold';
const MUTED = 'fill-ink-3 text-[13px]';

const L = GUIDE_DIAGRAMS.proposalPath.labels;

function Step({ x, width, title, sub1, sub2, brand = false }: { x: number; width: number; title: string; sub1: string; sub2: string; brand?: boolean }) {
  return (
    <g>
      <rect className={brand ? 'fill-brand-soft stroke-brand' : BOX} x={x} y={40} width={width} height={90} rx={10} />
      <T x={x + width / 2} y={68} cls={brand ? 'fill-ink text-sm font-bold' : HEAD}>{title}</T>
      <T x={x + width / 2} y={90} cls={MUTED}>{sub1}</T>
      <T x={x + width / 2} y={107} cls={MUTED}>{sub2}</T>
    </g>
  );
}

export function ProposalPath() {
  return (
    <svg viewBox="0 0 940 200" role="img" aria-label={GUIDE_DIAGRAMS.proposalPath.alt} className="block h-auto w-full min-w-[640px] text-ink-2">
      <ArrowMarker id="proposal-path-arrow" />
      <Step x={10} width={190} title={L.proposes!} sub1={L.proposesSub1!} sub2={L.proposesSub2!} />
      <path className={LINE} d="M200,85 H248" markerEnd="url(#proposal-path-arrow)" />
      <Step x={250} width={200} title={L.waits!} sub1={L.waitsSub1!} sub2={L.waitsSub2!} />
      <path className={LINE} d="M450,85 H498" markerEnd="url(#proposal-path-arrow)" />
      <Step x={500} width={200} title={L.decide!} sub1={L.decideSub1!} sub2={L.decideSub2!} brand />
      <path className={LINE} d="M700,85 H748" markerEnd="url(#proposal-path-arrow)" />
      <T x={724} y={76} cls="fill-ink-2 text-[12px]">{L.accept}</T>
      <Step x={750} width={180} title={L.saved!} sub1={L.savedSub1!} sub2={L.savedSub2!} />
      <T x={470} y={164} cls={MUTED}>{L.expires}</T>
      <T x={470} y={186} cls={MUTED}>{L.reject}</T>
    </svg>
  );
}
