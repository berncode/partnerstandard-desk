// Who is a test sign-in user (plan 13, task 14's review): test sign-in makes each one an address under example.test,
// a name reserved for tests (RFC 2606), so no real person can have one. The test seed serves only these.

/** The address test sign-in gives a new test user. */
export const testUserEmail = (suffix: string): string => `test-${suffix}@example.test`;

/** True only for an address test sign-in made. */
export const isTestUser = (email: string): boolean => /^test-[a-z0-9]+@example\.test$/.test(email);
