import { ownerTimeZone, ownerToday, readThisWeek } from '@partner-desk/commands';
import { connection } from 'next/server';
import { LoadProblem } from '@/markets/load-problem';
import { actorFor, companyFor, requireOwner } from '@/server/runtime';
import { ThisWeekView } from '@/week/this-week-view';

const PATH = '/this-week';

/**
 * The week through `readThisWeek`: one Partners read and each running MAP through the read cache, and the waiting
 * proposals from our index. Writes nothing. The proposals' dates are the owner's (Settings), from the time of the read.
 */
export async function ThisWeekLoader() {
  const { session, deps } = await requireOwner(PATH);
  const { companyId } = await companyFor(session);
  const actor = actorFor(session);
  const week = await readThisWeek(deps, actor, { companyId });
  if (!week.ok) return <LoadProblem failure={week} partnersFile next={PATH} storage={session.storage} />;
  // Before the clock: a request-time API, so "today" is the request's.
  await connection();
  const [today, timeZone] = await Promise.all([ownerToday(deps, actor.userId), ownerTimeZone(deps, actor.userId)]);
  return <ThisWeekView week={week.value} today={today} timeZone={timeZone} now={deps.clock()} storage={session.storage} />;
}
