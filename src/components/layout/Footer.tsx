import Link from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";

export async function Footer() {
  const t = await getTranslations("Footer");

  return (
    <footer className="border-t border-zinc-200 bg-white py-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 print:hidden">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between">
        {/*
          Copyright only. The maintainer credit lives on /about under
          the maintainer section — putting it on every page through
          the footer read as self-promotional on a community-branded
          site. /about is where someone asking "who's behind this?"
          would actually look.
        */}
        <p>© {new Date().getFullYear()} JTPA</p>
        <nav className="flex flex-wrap gap-4 text-xs">
          <Link href="/about" className="hover:underline">
            {t("about")}
          </Link>
          <Link href="/help" className="hover:underline">
            {t("help")}
          </Link>
          <Link href="/guide" className="hover:underline">
            {t("guide")}
          </Link>
          <Link href="/qa" className="hover:underline">
            {t("qa")}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
