// The calculation tools (spec 5.4): the pure functions the screens work their numbers out with, on what the agent
// sends. They read nothing and store nothing, so they take no company and touch no dependency.
import {
  activitySchema, caseSchema, companyFactsSchema, confirmedRecommendation, costCheck, deskRecommendation, exitTriggerSchema,
  isoDateSchema, MAX_PAST_HORIZONS, milestoneSchema, parseProgram, pastHorizonSchema, planInfoSchema, programSchema, scoresSchema, simulateCase,
  simulateOurCase, summarizeMap, type BusinessCase, type CaseResult, type CompanyFacts, type CostCheck, type JoinedPlan, type MapView,
  type OurResult, type Recommendation, type Scores,
} from '@partner-desk/core';
import { FOUR_C, STAGES } from '@partner-desk/method';
import { z } from 'zod';
import { invalid, ok, type CommandResult } from '../result';
import type { AgentTool } from './tools';

/** Types each tool's input and output, and keeps its own type out of the registry's list. */
const tool = <I, O>(t: AgentTool<I, O>): AgentTool => t as unknown as AgentTool;

/**
 * A case its screens can work out: its partner type is in its own offer (`parseCase`), else `simulateCase` throws.
 * Without its `companyId`, which no tool input names (a `companyId` sent along is dropped): the sums don't use it.
 */
const workableCase = caseSchema.omit({ companyId: true }).refine((c) => c.offer.types.some((t) => t.id === c.typeId), {
  message: 'The case\'s typeId must be the id of the partner type in its offer.', path: ['typeId'],
});

/**
 * A program's fields without its `companyId` (dropped when sent, as for a case). Its rules across fields are
 * `parseProgram`'s, checked when the tool runs: a schema with such rules can't leave a field out.
 */
const programFields = z.object(Object.fromEntries(Object.entries(programSchema.shape).filter(([key]) => key !== 'companyId')));
/** The company id `parseProgram` needs and the cost check doesn't read. */
const NO_COMPANY = 'co_calculation';

/** Scores as a partner holds them; a C left out is not scored. */
const someScores = scoresSchema.partial().strict();
const allScores = (s: Partial<Scores> | undefined): Scores =>
  Object.fromEntries(FOUR_C.map((c) => [c, s?.[c] ?? null])) as Scores;

/**
 * The plan details the health rules read, as `get_map` answers them (`info`). Stages by their names only: the stored
 * MAP's reading of old stage names (`stageSchema`) is for files, not for what an agent sends.
 */
const healthInfo = planInfoSchema.extend({
  stage: z.enum(STAGES),
  pastHorizons: z.array(pastHorizonSchema.extend({ stage: z.enum(STAGES) })).max(MAX_PAST_HORIZONS).default([]),
});

export const CALC_TOOLS: readonly AgentTool[] = [
  tool({
    name: 'calculate_case', title: 'Calculate a business case', level: 'calc', rest: { method: 'POST', path: '/calc/calculate-case' },
    description: 'Works out a business case as its tabs do, from a whole case as get_case returns it (value), changed as you '
      + 'like: what the partner earns year by year (partner) and what we get (ours). Reads and stores nothing.',
    input: z.object({ case: workableCase }).strict(),
    run: async (_ctx, input): Promise<CommandResult<{ partner: CaseResult; ours: OurResult }>> => {
      const c = { ...input.case, companyId: NO_COMPANY } as BusinessCase;
      const partner = simulateCase(c);
      return ok({ partner, ours: simulateOurCase(c, partner) });
    },
  }),
  tool({
    name: 'check_program_cost', title: 'Check a program\'s cost', level: 'calc', rest: { method: 'POST', path: '/calc/check-program-cost' },
    description: 'The cost check of a partner program, as the program page shows it: what partners earn per typical customer '
      + 'and level, the running costs, and what partners cost against what a customer brings in and against selling direct. '
      + 'Send the company facts (get_company_facts) and the program (get_program), changed as you like. Reads and stores nothing.',
    input: z.object({ companyFacts: companyFactsSchema, program: programFields }).strict(),
    run: async (_ctx, input): Promise<CommandResult<CostCheck>> => {
      const program = parseProgram({ ...input.program, companyId: NO_COMPANY });
      if (!program.ok) return invalid(Object.fromEntries(program.issues.map((i) => [`program.${i.path}`, i.located])));
      return ok(costCheck(input.companyFacts as CompanyFacts, program.program));
    },
  }),
  tool({
    name: 'recommend_4c', title: 'Recommend from the 4C scores', level: 'calc', rest: { method: 'POST', path: '/calc/recommend-4c' },
    description: 'The recommendation for 4C scores (0 to 3 for customerBase, credibility, capability and commitment): from the '
      + 'desk check, from the confirmed check (all four scored), and the one the partner page shows (confirmed first). '
      + 'Reads and stores nothing; scores are set by the person in PartnerStandard Desk.',
    input: z.object({ desk: someScores.optional(), confirmed: someScores.optional() }).strict(),
    run: async (_ctx, input): Promise<CommandResult<{ desk: Recommendation | null; confirmed: Recommendation | null; recommendation: Recommendation | null }>> => {
      const desk = deskRecommendation(allScores(input.desk));
      const confirmed = confirmedRecommendation(allScores(input.confirmed));
      return ok({ desk, confirmed, recommendation: confirmed ?? desk });
    },
  }),
  tool({
    name: 'map_health', title: 'Work out a MAP\'s health', level: 'calc', rest: { method: 'POST', path: '/calc/map-health' },
    description: 'A MAP\'s health (on_track, at_risk, off_track, or empty) with its reasons, and its next milestone, by the rules '
      + 'the MAP page uses. Send info and lastProgressAt as get_map returns them, its activities, milestones and exitTriggers '
      + '(changed as you like), and today\'s date. Reads and stores nothing.',
    input: z.object({
      info: healthInfo,
      activities: z.array(activitySchema).max(300),
      milestones: z.array(milestoneSchema).max(50),
      exitTriggers: z.array(exitTriggerSchema).max(30),
      today: isoDateSchema,
      lastProgressAt: z.string().max(40).nullable(),
    }).strict(),
    run: async (_ctx, input): Promise<CommandResult<MapView>> => {
      const plan: JoinedPlan = {
        info: input.info, activities: input.activities, milestones: input.milestones, exitTriggers: input.exitTriggers,
        objectives: [], people: [], reviews: [], reviewNumbers: [], reviewItems: [],
      };
      return ok(summarizeMap(plan, input.today, input.lastProgressAt));
    },
  }),
];
