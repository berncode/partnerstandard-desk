// How a partner ends: before signing, close and reopen; after signing, mark exited.
import { GUIDE_DIAGRAMS } from '@partner-desk/copy';
import { ArrowMarker, BOX, CLOSED, HEAD, LINE, LINE_MUTED, MUTED, T } from './parts';

const L = GUIDE_DIAGRAMS.howItEnds.labels;

export function HowItEnds() {
  return (
    <svg viewBox="0 0 360 330" role="img" aria-label={GUIDE_DIAGRAMS.howItEnds.alt} className="block h-auto w-full text-ink-2">
      <ArrowMarker id="ends-arrow" />
      <T x={10} y={20} cls={HEAD} start>{L.before}</T>
      <rect className={BOX} x={10} y={36} width={100} height={52} rx={6} />
      <T x={60} y={67}>{L.recruitment}</T>
      <line className={LINE} x1={112} y1={62} x2={248} y2={62} markerEnd="url(#ends-arrow)" />
      <T x={180} y={54}>{L.close}</T>
      <rect className={CLOSED} x={250} y={26} width={100} height={72} rx={6} />
      <T x={300} y={46} cls={MUTED}>{L.closed}</T>
      <T x={300} y={67}>{L.notNow}</T>
      <T x={300} y={86}>{L.no}</T>
      <path className={LINE_MUTED} d="M300,100 V124 H60 V90" markerEnd="url(#ends-arrow)" strokeDasharray="4 3" />
      <T x={180} y={118}>{L.reopen}</T>

      <T x={10} y={178} cls={HEAD} start>{L.after}</T>
      <rect className={BOX} x={10} y={194} width={100} height={92} rx={6} />
      <T x={60} y={218}>{L.onboarding}</T>
      <T x={60} y={242}>{L.growth}</T>
      <T x={60} y={266}>{L.expansion}</T>
      <line className={LINE} x1={112} y1={240} x2={248} y2={240} markerEnd="url(#ends-arrow)" />
      <T x={180} y={232}>{L.markExited}</T>
      <rect className={BOX} x={250} y={214} width={100} height={52} rx={6} />
      <T x={300} y={245}>{L.exit}</T>
    </svg>
  );
}
