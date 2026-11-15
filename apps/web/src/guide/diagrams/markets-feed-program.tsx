// Markets feed a program: two markets of one partner type feed one program; a partner joins it when it signs.
import { GUIDE_DIAGRAMS } from '@partner-desk/copy';
import { ArrowMarker, BOX, HEAD, LINE, MUTED, T } from './parts';

const L = GUIDE_DIAGRAMS.marketsFeedProgram.labels;

export function MarketsFeedProgram() {
  return (
    <svg viewBox="0 0 360 310" role="img" aria-label={GUIDE_DIAGRAMS.marketsFeedProgram.alt} className="block h-auto w-full text-ink-2">
      <ArrowMarker id="feed-arrow" />
      <rect className={BOX} x={10} y={8} width={160} height={52} rx={6} />
      <T x={90} y={29} cls={MUTED}>{L.marketKind}</T>
      <T x={90} y={47} cls={HEAD}>{L.marketOne}</T>
      <rect className={BOX} x={190} y={8} width={160} height={52} rx={6} />
      <T x={270} y={29} cls={MUTED}>{L.marketKind}</T>
      <T x={270} y={47} cls={HEAD}>{L.marketTwo}</T>

      <path className={LINE} d="M90,60 L150,130" markerEnd="url(#feed-arrow)" />
      <path className={LINE} d="M270,60 L210,130" markerEnd="url(#feed-arrow)" />
      <T x={180} y={98}>{L.feeds}</T>

      <rect className={BOX} x={70} y={132} width={220} height={52} rx={6} />
      <T x={180} y={153} cls={MUTED}>{L.programKind}</T>
      <T x={180} y={171} cls={HEAD}>{L.program}</T>

      <path className={LINE} d="M180,244 V186" markerEnd="url(#feed-arrow)" />
      <T x={190} y={218} start>{L.joins}</T>
      <rect className={BOX} x={100} y={246} width={160} height={52} rx={6} />
      <T x={180} y={267}>{L.partner}</T>
      <T x={180} y={285} cls={MUTED}>{L.signs}</T>
    </svg>
  );
}
