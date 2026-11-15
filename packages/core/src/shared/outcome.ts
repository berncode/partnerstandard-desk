/** What applying a change gives back: the new value, or why it was refused. Shared by the partner book and the market. */
export type ApplyOutcome<T> =
  | { ok: true; value: T; entityId: string | null }
  | { ok: false; error: 'not_found' | 'invalid' | 'conflict'; message: string; fieldErrors?: Record<string, string> };

export type ApplyFailure = Extract<ApplyOutcome<never>, { ok: false }>;
