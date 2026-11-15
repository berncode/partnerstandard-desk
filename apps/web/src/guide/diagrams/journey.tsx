// The partner journey, drawn for the guide in the theme's colors. Every box and bar links to its section in the guide.
import { GUIDE_DIAGRAMS, type GuideSectionId } from '@partner-desk/copy';
import { ArrowMarker, BAR, BAR_DRAFT, BOX, BOX_DASHED, CLOSED, HEAD, LINE, LINE_MUTED, MUTED, T, TEXT } from './parts';

const L = GUIDE_DIAGRAMS.journey.labels;

/** Each box and bar of the journey, by its label key, to the guide section it opens. */
export const JOURNEY_LINKS: Record<string, GuideSectionId> = {
  marketHypothesis: 'markets',
  partnerHypothesis: 'markets',
  valueProposition: 'markets',
  researched: 'researched',
  discoveryCall: 'discovery-call',
  qualification: 'qualification',
  map: 'map',
  signed: 'signing',
  onboarding: 'onboarding',
  growth: 'reviews',
  evaluation: 'reviews',
  expansion: 'expansion',
  exit: 'exit',
  closed: 'closing',
  barHypotheses: 'markets',
  barProgramDraft: 'programs',
  barProgram: 'programs',
  barCase: 'business-cases',
  barMap: 'map',
  barSigning: 'signing',
  barReviews: 'reviews',
};

/** A link that shows a ring around its shape when a keyboard focuses it. */
const LINK = 'outline-none [&:focus-visible_rect]:stroke-brand [&:focus-visible_rect]:stroke-[3] hover:[&_rect]:stroke-brand';

function Link({ k, name, children }: { k: keyof typeof JOURNEY_LINKS; name: string; children: React.ReactNode }) {
  return (
    <a href={`#${JOURNEY_LINKS[k]}`} aria-label={name} className={LINK}>
      {children}
    </a>
  );
}

const BOX_Y = 96;
const BOXES: { k: keyof typeof JOURNEY_LINKS; x: number; sub?: string; dashed?: boolean }[] = [
  { k: 'marketHypothesis', x: 40 },
  { k: 'partnerHypothesis', x: 132 },
  { k: 'valueProposition', x: 224 },
  { k: 'researched', x: 316, sub: 'researchedSub' },
  { k: 'discoveryCall', x: 408 },
  { k: 'qualification', x: 500, sub: 'qualificationSub' },
  { k: 'map', x: 592, sub: 'mapSub' },
  { k: 'signed', x: 684, sub: 'signedSub' },
  { k: 'onboarding', x: 776, sub: 'onboardingSub' },
  { k: 'growth', x: 868 },
  { k: 'evaluation', x: 960, sub: 'evaluationSub', dashed: true },
  { k: 'expansion', x: 1052 },
  { k: 'exit', x: 1144 },
];

const BARS: { k: keyof typeof JOURNEY_LINKS; x: number; y: number; w: number; draft?: boolean }[] = [
  { k: 'barHypotheses', x: 40, y: 232, w: 1186 },
  { k: 'barProgramDraft', x: 224, y: 264, w: 460, draft: true },
  { k: 'barProgram', x: 684, y: 264, w: 542 },
  { k: 'barCase', x: 500, y: 296, w: 726 },
  { k: 'barMap', x: 592, y: 328, w: 634 },
  { k: 'barSigning', x: 684, y: 360, w: 542 },
  { k: 'barReviews', x: 830, y: 392, w: 396 },
];

export function Journey() {
  return (
    <svg
      viewBox="0 0 1270 470"
      role="group"
      aria-label={GUIDE_DIAGRAMS.journey.alt}
      className="block h-auto w-full min-w-[900px] text-ink-2 print:min-w-0"
    >
      <ArrowMarker id="journey-arrow" />

      <path className={LINE_MUTED} d="M40,86 V80 H306 V86" />
      <T x={173} y={70} cls={HEAD}>{L.groupHypotheses}</T>
      <path className={LINE_MUTED} d="M316,86 V80 H766 V86" />
      <T x={541} y={70} cls={HEAD}>{L.groupRecruitment}</T>
      <path className={LINE_MUTED} d="M776,86 V80 H1226 V86" />
      <T x={1001} y={70} cls={HEAD}>{L.groupAfter}</T>

      {BOXES.map(({ k, x, sub, dashed }) => {
        const [first, ...rest] = L[k]!.split(' ');
        const lines = rest.length ? [first!, rest.join(' ')] : [first!];
        const name = sub ? `${L[k]}, ${L[sub]}` : L[k]!;
        const cx = x + 41;
        return (
          <Link key={k} k={k} name={name}>
            <rect className={dashed ? BOX_DASHED : BOX} x={x} y={BOX_Y} width={82} height={58} rx={6} />
            {sub ? (
              <>
                <T x={cx} y={121}>{lines.length === 2 ? lines[0] : L[k]}</T>
                <T x={cx} y={137} cls={lines.length === 2 ? TEXT : MUTED}>{lines.length === 2 ? lines[1] : L[sub]}</T>
              </>
            ) : lines.length === 2 ? (
              <>
                <T x={cx} y={121}>{lines[0]}</T>
                <T x={cx} y={137}>{lines[1]}</T>
              </>
            ) : (
              <T x={cx} y={129}>{lines[0]}</T>
            )}
          </Link>
        );
      })}

      <g className={LINE}>
        {BOXES.slice(0, -1).map(({ x }) => (
          <line key={x} x1={x + 82} y1={125} x2={x + 91} y2={125} markerEnd="url(#journey-arrow)" />
        ))}
      </g>

      <path className={LINE} d="M990,154 C990,184 920,184 920,158" markerEnd="url(#journey-arrow)" />
      <T x={955} y={196} cls={MUTED}>{L.loop}</T>

      <line className={LINE_MUTED} x1={357} y1={154} x2={357} y2={176} strokeDasharray="3 3" />
      <line className={LINE_MUTED} x1={541} y1={154} x2={541} y2={176} strokeDasharray="3 3" />
      <line className={LINE_MUTED} x1={449} y1={154} x2={449} y2={176} strokeDasharray="3 3" />
      <line className={LINE_MUTED} x1={633} y1={154} x2={633} y2={176} strokeDasharray="3 3" />
      <Link k="closed" name={L.closed!}>
        <rect className={CLOSED} x={306} y={176} width={378} height={26} rx={4} />
        <T x={495} y={193} cls={MUTED}>{L.closed}</T>
      </Link>

      <T x={40} y={222} cls={HEAD} start>{L.existsTitle}</T>
      {BARS.map(({ k, x, y, w, draft }) => (
        <Link key={k} k={k} name={L[k]!}>
          <rect className={draft ? BAR_DRAFT : BAR} x={x} y={y} width={w} height={24} rx={4} />
          <T x={x + 10} y={y + 16} cls={draft ? MUTED : TEXT} start>{L[k]}</T>
        </Link>
      ))}

      <path className={LINE_MUTED} d="M1226,125 H1252 V444 H18 V125 H38" markerEnd="url(#journey-arrow)" />
      <T x={635} y={438} cls={MUTED}>{L.lessons}</T>
    </svg>
  );
}
