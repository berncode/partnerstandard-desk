// One account, its partner types: the example of the guide's first section. 360 wide, so it fits a phone.
import { GUIDE_DIAGRAMS } from '@partner-desk/copy';
import { ArrowMarker, BOX, HEAD, LINE, MUTED, T } from './parts';

const L = GUIDE_DIAGRAMS.account.labels;

function Part({ x, title, stage }: { x: number; title: string; stage: string }) {
  return (
    <g>
      <rect className={BOX} x={x} y={100} width={166} height={200} rx={6} />
      <T x={x + 83} y={118} cls={HEAD}>{title.split(' as ')[0]}</T>
      <T x={x + 83} y={134} cls={HEAD}>{`as ${title.split(' as ')[1]}`}</T>
      <T x={x + 12} y={158} cls={MUTED} start>{L.owns}</T>
      <T x={x + 12} y={180} start>{stage}</T>
      <T x={x + 12} y={204} start>{L.markets}</T>
      <T x={x + 12} y={228} start>{L.program}</T>
      <T x={x + 12} y={252} start>{L.map}</T>
      <T x={x + 12} y={276} start>{L.cases}</T>
    </g>
  );
}

export function Account() {
  return (
    <svg viewBox="0 0 360 310" role="img" aria-label={GUIDE_DIAGRAMS.account.alt} className="block h-auto w-full text-ink-2">
      <ArrowMarker id="account-arrow" />
      <rect className={BOX} x={100} y={8} width={160} height={52} rx={6} />
      <T x={180} y={30} cls={HEAD}>{L.account}</T>
      <T x={180} y={48} cls={MUTED}>{L.accountSub}</T>
      <path className={LINE} d="M150,60 V80 H93 V98" markerEnd="url(#account-arrow)" />
      <path className={LINE} d="M210,60 V80 H267 V98" markerEnd="url(#account-arrow)" />
      <Part x={10} title={L.reseller!} stage={L.resellerStage!} />
      <Part x={184} title={L.technology!} stage={L.technologyStage!} />
    </svg>
  );
}
