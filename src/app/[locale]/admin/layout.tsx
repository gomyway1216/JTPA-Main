import Link from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";

import { getSessionUser } from "@/lib/auth/session";
import {
  redirectToLocalizedPath,
  redirectToLoginPath,
} from "@/lib/i18n/redirects";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) return redirectToLoginPath("/admin");
  // Editors get access to /admin so they can manage guides. Page-level guards
  // keep admin-only sections (events, projects, attendees, dashboard) off-limits.
  if (!user.isAdmin && !user.isEditor) return redirectToLocalizedPath("/");
  const t = await getTranslations("Admin.nav");

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 print:max-w-none print:px-0 print:py-0">
      <div className="grid gap-6 md:grid-cols-[200px_1fr] print:block">
        <aside className="md:sticky md:top-4 md:self-start print:hidden">
          <nav className="flex flex-col gap-1 text-sm">
            {user.isAdmin && <AdminLink href="/admin">{t("dashboard")}</AdminLink>}
            {user.isAdmin && <AdminLink href="/admin/events">{t("events")}</AdminLink>}
            {user.isAdmin && (
              <AdminLink href="/admin/projects">{t("projects")}</AdminLink>
            )}
            {user.isAdmin && <AdminLink href="/admin/posts">{t("posts")}</AdminLink>}
            {user.isAdmin && <AdminLink href="/admin/attendees">{t("attendees")}</AdminLink>}
            <AdminLink href="/admin/guides">{t("guides")}</AdminLink>
            {/* Feedback triage is intentionally shared with editors so
                admins aren't the bottleneck for marking entries
                read/resolved. The Server Action enforces requireEditor
                regardless of which role clicked through. */}
            <AdminLink href="/admin/feedback">{t("feedback")}</AdminLink>
            {user.isAdmin && <AdminLink href="/admin/about">{t("about")}</AdminLink>}
            {user.isAdmin && <AdminLink href="/admin/users">{t("users")}</AdminLink>}
            {user.isAdmin && (
              <AdminLink href="/admin/errors">{t("errors")}</AdminLink>
            )}
            <AdminLink href="/admin/help">{t("help")}</AdminLink>
          </nav>
        </aside>
        <section>{children}</section>
      </div>
    </div>
  );
}

function AdminLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      {children}
    </Link>
  );
}
