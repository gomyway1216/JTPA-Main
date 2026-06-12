import Link from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";

const FOOTER_LINKS = [
  { href: "/events", key: "events" },
  { href: "/showcase", key: "showcase" },
  { href: "/community", key: "community" },
  { href: "/help", key: "help" },
] as const;

export async function Footer() {
  const t = await getTranslations("Footer");

  return (
    <footer className="border-t border-zinc-200 bg-white py-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 print:hidden">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} JTPA</p>
        <nav className="flex flex-wrap gap-4 text-xs">
          {FOOTER_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:underline">
              {t(link.key)}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
