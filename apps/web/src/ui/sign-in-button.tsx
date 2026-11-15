'use client';

import { useState, type ReactNode } from 'react';
import { authClient } from './auth-client';
import { Button } from './button';

/** Starts sign-in with a provider, or a reconnect (the same consent flow). Better Auth redirects the page. */
export function SignInButton({ provider, callbackURL, newUserCallbackURL, children, variant = 'primary', className }: {
  provider: 'google'; callbackURL: string; newUserCallbackURL?: string; children: ReactNode; variant?: 'primary' | 'secondary'; className?: string;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant={variant}
      className={className}
      aria-busy={pending}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const { error } = await authClient.signIn.social({ provider, callbackURL, ...(newUserCallbackURL ? { newUserCallbackURL } : {}) });
        if (error) setPending(false);
      }}
    >
      {children}
    </Button>
  );
}
