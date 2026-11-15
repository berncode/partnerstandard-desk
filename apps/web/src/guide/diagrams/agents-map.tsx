// How a helper comes in, drawn for the guide: the first of the two pictures in Agents and the API, in the theme's
// colors, and no storage place named, so both editions show it as it is.
// Wider than a phone: the guide puts it in a frame that scrolls sideways.
import { GUIDE_DIAGRAMS } from '@partner-desk/copy';
import { ArrowMarker, BOX, LINE, T } from './parts';

// Larger than the small pictures' text: a wide picture shrinks to the column on a laptop.
const HEAD = 'fill-ink text-[15px] font-semibold';
const MUTED = 'fill-ink-3 text-[13px]';
const TEXT = 'fill-ink text-[13px]';

const L = GUIDE_DIAGRAMS.agentsMap.labels;
const COLUMN = 'fill-ink-3 text-[12px] font-semibold tracking-wider';
const SMALL = 'fill-ink-2 text-[12px]';

function Helper({ y, title, sub, how }: { y: number; title: string; sub: string; how: string }) {
  return (
    <g>
      <rect className={BOX} x={10} y={y} width={190} height={86} rx={10} />
      <T x={105} y={y + 26} cls={HEAD}>{title}</T>
      <T x={105} y={y + 46} cls={MUTED}>{sub}</T>
      <T x={105} y={y + 68} cls={MUTED}>{how}</T>
    </g>
  );
}

const CHECKS = [L.who, L.may, L.fresh, L.decision] as const;

export function AgentsMap() {
  return (
    <svg viewBox="0 0 940 430" role="img" aria-label={GUIDE_DIAGRAMS.agentsMap.alt} className="block h-auto w-full min-w-[640px] text-ink-2">
      <ArrowMarker id="agents-map-arrow" />
      <T x={105} y={22} cls={COLUMN}>{L.outside}</T>
      <T x={470} y={22} cls={COLUMN}>{L.desk}</T>
      <T x={825} y={22} cls={COLUMN}>{L.work}</T>

      <Helper y={40} title={L.assistant!} sub={L.assistantSub!} how={L.assistantHow!} />
      <Helper y={146} title={L.tool!} sub={L.toolSub!} how={L.toolHow!} />
      <path className={LINE} d="M200,83 L308,150" markerEnd="url(#agents-map-arrow)" />
      <T x={236} y={124} cls={SMALL}>{L.connector}</T>
      <path className={LINE} d="M200,189 L308,182" markerEnd="url(#agents-map-arrow)" />
      <T x={258} y={204} cls={SMALL}>{L.key}</T>

      {/* The same door for everyone: the brand's soft fill marks the Desk itself. */}
      <rect className="fill-brand-soft stroke-brand" x={310} y={40} width={320} height={250} rx={12} />
      <T x={470} y={66} cls="fill-ink text-[16px] font-bold">{L.door}</T>
      <T x={470} y={84} cls={MUTED}>{L.doorSub}</T>
      {CHECKS.map((label, i) => (
        <g key={label}>
          <rect className={BOX} x={324} y={100 + i * 44} width={292} height={36} rx={8} />
          <T x={336} y={123 + i * 44} cls={TEXT} start>{label}</T>
        </g>
      ))}

      <path className={LINE} d="M630,165 L718,165" markerEnd="url(#agents-map-arrow)" />
      <T x={674} y={156} cls={SMALL}>{L.reads}</T>
      <rect className={BOX} x={720} y={120} width={210} height={90} rx={10} />
      <T x={825} y={156} cls={HEAD}>{L.workTitle}</T>
      <T x={825} y={178} cls={MUTED}>{L.workSub}</T>

      <path className={LINE} d="M470,290 V336" markerEnd="url(#agents-map-arrow)" />
      <rect className={BOX} x={320} y={338} width={300} height={80} rx={10} />
      <T x={470} y={362} cls={HEAD}>{L.see}</T>
      <T x={470} y={384} cls={MUTED}>{L.seeCard}</T>
      <T x={470} y={402} cls={MUTED}>{L.seeHistory}</T>

      <path className={`${LINE} [stroke-dasharray:5_4]`} d="M310,260 C250,300 150,300 105,236" markerEnd="url(#agents-map-arrow)" />
      <T x={185} y={316} cls={SMALL}>{L.webhook}</T>
    </svg>
  );
}
