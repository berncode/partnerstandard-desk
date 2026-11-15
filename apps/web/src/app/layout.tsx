import { COPY } from '@partner-desk/copy';
import type { Metadata } from 'next';
import { Inter_Tight } from 'next/font/google';
import { shownIcon } from '@/ui/brand';
import { THEME_SCRIPT } from '@/ui/theme';
import { Toaster } from '@/ui/toaster';
import './globals.css';

// The font, the pre-paint theme script, the toaster.
const interTight = Inter_Tight({ subsets: ['latin'], variable: '--font-inter-tight', display: 'swap' });

export const metadata: Metadata = {
  title: { default: COPY.APP_NAME, template: `%s · ${COPY.APP_NAME}` },
  description: COPY.LANDING_TEXT,
  // PartnerStandard's icon on hosted, the Community Edition's elsewhere (brand.ts).
  icons: { icon: shownIcon() },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // The inline script sets data-theme before the first paint; suppressHydrationWarning lets React keep it.
    <html lang="en" data-theme="light" suppressHydrationWarning className={`${interTight.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col bg-canvas font-sans text-ink">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
