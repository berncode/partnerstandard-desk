// A MAP over time: signing starts horizon 1; a review closes each horizon; its commitments become the next horizon's activities.
import { GUIDE_DIAGRAMS } from '@partner-desk/copy';
import { ArrowMarker, BAR, BOX, HEAD, LINE, LINE_MUTED, MUTED, T, TEXT } from './parts';

const L = GUIDE_DIAGRAMS.mapOverTime.labels;

const HORIZONS = [
  { x: 20, bar: L.horizon1!, review: L.review1! },
  { x: 125, bar: L.horizon2!, review: L.review2! },
  { x: 230, bar: L.horizon3!, review: L.review3! },
];

export function MapOverTime() {
  return (
    <svg viewBox="0 0 360 340" role="img" aria-label={GUIDE_DIAGRAMS.mapOverTime.alt} className="block h-auto w-full text-ink-2">
      <ArrowMarker id="map-arrow" />
      <T x={20} y={26} cls={HEAD} start>{L.signing}</T>
      <line className={LINE} x1={20} y1={34} x2={20} y2={62} markerEnd="url(#map-arrow)" />

      {HORIZONS.map(({ x, bar, review }) => (
        <g key={bar}>
          <rect className={BAR} x={x} y={66} width={90} height={30} rx={4} />
          <T x={x + 45} y={86}>{bar}</T>
          <circle className="fill-brand stroke-canvas" cx={x + 90} cy={81} r={7} />
          <T x={x + 90} y={116} cls={MUTED}>{review}</T>
        </g>
      ))}

      <path className={LINE_MUTED} d="M110,124 C110,142 150,142 150,100" markerEnd="url(#map-arrow)" strokeDasharray="4 3" />
      <T x={160} y={156} cls={TEXT} start>{L.commitments1}</T>
      <T x={160} y={172} cls={TEXT} start>{L.commitments2}</T>

      <T x={180} y={206} cls={MUTED}>{L.lengthNote}</T>

      <rect className={BOX} x={20} y={232} width={320} height={92} rx={6} />
      <T x={180} y={256} cls={HEAD}>{L.firstReview}</T>
      <rect className={BAR} x={50} y={272} width={110} height={36} rx={4} />
      <T x={105} y={295}>{L.from}</T>
      <line className={LINE} x1={162} y1={290} x2={198} y2={290} markerEnd="url(#map-arrow)" />
      <rect className={BAR} x={200} y={272} width={110} height={36} rx={4} />
      <T x={255} y={295}>{L.to}</T>
    </svg>
  );
}
