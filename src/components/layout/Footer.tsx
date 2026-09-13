import Link from "@/i18n/navigation";
import { MAINTAINER_NAME, MAINTAINER_PROFILE_PATH } from "@/lib/maintainer";
import { JTPA_EVENTS_URL, JTPA_SITE_URL } from "@/lib/site";
import { getTranslations } from "next-intl/server";

const FOOTER_LINKS = [
  { href: "/events", key: "events" },
  { href: "/showcase", key: "showcase" },
  { href: "/community", key: "community" },
  { href: "/mailing-list", key: "mailingList" },
  { href: "/help", key: "help" },
] as const;

export async function Footer() {
  const t = await getTranslations("Footer");

  return (
    <footer className="border-t border-zinc-200 bg-white py-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 print:hidden">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex flex-wrap gap-x-2 gap-y-1">
            <span>© {new Date().getFullYear()} JTPA</span>
            <span aria-hidden="true">·</span>
            <span>
              {t.rich("maintainerText", {
                name: (chunks) => (
                  <Link
                    href={MAINTAINER_PROFILE_PATH}
                    className="hover:underline"
                  >
                    {chunks || MAINTAINER_NAME}
                  </Link>
                ),
              })}
            </span>
          </p>
          <nav className="flex flex-wrap gap-4 text-xs">
            {FOOTER_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="hover:underline">
                {t(link.key)}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 text-xs dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
          <p>
            {t("supportedBy")} {" "}
            <a
              href={JTPA_SITE_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-zinc-700 hover:underline dark:text-zinc-300"
            >
              JTPA
            </a>
          </p>
          <a
            href={JTPA_EVENTS_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            {t("jtpaEvents")} →
          </a>
        </div>
      </div>
    </footer>
  );
}
