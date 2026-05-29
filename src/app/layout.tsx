import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/components/theme/ThemeProvider";
import { getSessionUser } from "@/lib/auth/session";

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

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getSessionUser();

  return (
    <html
      lang="ja"
      // Apply the same surface bg to <html> as <body>. Without it, any
      // sliver where <body> doesn't fully cover the viewport — overscroll
      // bounce on macOS / iOS, or browser autofill bars — leaks the
      // default white html background through, which reads as a stray
      // light strip at the bottom of the page in dark mode.
      className={`${geistSans.variable} ${geistMono.variable} h-full bg-zinc-50 antialiased dark:bg-zinc-950`}
      suppressHydrationWarning
    >
      <head>
        {/* Sets `.dark` on <html> before paint so users don't see a
            flash of the wrong theme on first load. Must run synchronously
            in <head>; the React state in ThemeProvider mounts later. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body
        className="min-h-full flex flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
        suppressHydrationWarning
      >
        <ThemeProvider>
          <AuthProvider initialUser={user}>
            <Header user={user} />
            <main className="flex-1">{children}</main>
            <Footer />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
