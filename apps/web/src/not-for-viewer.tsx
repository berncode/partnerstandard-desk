// A start button in a page's static header (New market, New case, Add a program), hidden from a company server's viewer,
// who can't use it (owner, 2026-11-14). The header knows no person, so the button waits for the session, inside its own
// Suspense. A Vercel build is always hosted, where nobody is a viewer: it keeps the button in the static HTML.
import { onVercel } from '@partner-desk/platform/env';
import { Suspense, type ReactNode } from 'react';
import { currentOwner } from '@/server/runtime';

export function NotForViewer({ children }: { children: ReactNode }) {
  if (onVercel()) return children;
  return <Suspense fallback={null}><ViewerGate>{children}</ViewerGate></Suspense>;
}

/** The children, unless the signed-in person is a company server's viewer. Signed out, the page's loader signs them in. */
export async function ViewerGate({ children }: { children: ReactNode }) {
  const session = await currentOwner();
  return session?.member?.role === 'viewer' ? null : children;
}
