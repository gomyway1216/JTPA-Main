import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import "../globals.css";

import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/components/theme/ThemeProvider";
import { routing } from "@/i18n/routing";
import { getSessionUser } from "@/lib/auth/session";
import { getMyAvatarUrl } from "@/lib/data/users";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "JTPA — Japanese Technology Professionals Association",
  description:
    "JTPAのコミュニティイベント、AIプロジェクトのショーケース、勉強会情報。",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();

  const sessionUser = await getSessionUser();
  // The session cookie only carries the Google `photoURL` (decoded from
  // the cookie — never a Firestore read). Override it with a user-uploaded
  // avatar when one is set, so the header icon — and any future auth
  // consumer — shows the custom image. Costs one cached Firestore read per
  // request for logged-in users; anonymous visitors skip it entirely.
  const user = sessionUser
    ? {
        ...sessionUser,
        photoURL:
          (await getMyAvatarUrl(sessionUser.uid)) ?? sessionUser.photoURL,
      }
    : null;

  return (
    <html
      lang={locale}
      // Apply the same surface bg to <html> as <body>. Without it, any
      // sliver where <body> doesn't fully cover the viewport — overscroll
      // bounce on macOS / iOS, or browser autofill bars — leaks the
      // default white html background through, which reads as a stray
      // light strip at the bottom of the page in dark mode.
      //
      // `bg-background` is backed by the `--background` CSS var (defined
      // in globals.css and exposed through `@theme inline` as the
      // `background` color token), so both html and body track the same
      // single source of truth — any future palette tweak propagates here
      // without manually re-syncing two hardcoded color stops.
      className={`${geistSans.variable} ${geistMono.variable} h-full bg-background antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Sets `.dark` on <html> before paint so users don't see a
            flash of the wrong theme on first load. Must run synchronously
            in <head>; the React state in ThemeProvider mounts later. */}
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
      </head>
      <body
        // Body matches <html> via `bg-background` so there's no 1-px
        // color drift between the two layers — the whole point of also
        // painting <html> was to plug visual gaps, and that only holds
        // if both surfaces resolve to the exact same hex. Text colors
        // stay on the zinc-900/100 pair (intentionally a touch softer
        // than the pure-ink `--foreground`).
        className="min-h-full flex flex-col bg-background text-zinc-900 dark:text-zinc-100"
        suppressHydrationWarning
      >
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>
            <AuthProvider initialUser={user}>
              <Header user={user} />
              <main className="flex-1">{children}</main>
              <Footer />
            </AuthProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
