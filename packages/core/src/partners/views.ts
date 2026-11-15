import type { View } from '@partner-desk/method';
import type { Partner } from './types';

/** Closed: turned down, or exited. Potential: still in recruitment. Everything else is active. */
export function viewOf(p: Partner): View {
  if (p.closed !== null || p.exitedDate !== null) return 'closed';
  return p.stage === 'recruitment' ? 'potential' : 'active';
}

export function startView(partners: Partner[]): View {
  return partners.some((p) => viewOf(p) === 'active') ? 'active' : 'potential';
}
