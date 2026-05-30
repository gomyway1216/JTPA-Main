import Link from "@/i18n/navigation";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/admin");
  // Editors get access to /admin so they can manage guides. Page-level guards
  // keep admin-only sections (events, projects, attendees, dashboard) off-limits.
  if (!user.isAdmin && !user.isEditor) redirect("/");

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        <aside className="md:sticky md:top-4 md:self-start">
          <nav className="flex flex-col gap-1 text-sm">
            {user.isAdmin && <AdminLink href="/admin">概要</AdminLink>}
            {user.isAdmin && <AdminLink href="/admin/events">イベント</AdminLink>}
            {user.isAdmin && (
              <AdminLink href="/admin/projects">プロジェクト承認</AdminLink>
            )}
            {user.isAdmin && <AdminLink href="/admin/posts">ブログ管理</AdminLink>}
            {user.isAdmin && <AdminLink href="/admin/attendees">参加者</AdminLink>}
            <AdminLink href="/admin/guides">ガイド</AdminLink>
            {/* Feedback triage is intentionally shared with editors so
                admins aren't the bottleneck for marking entries
                read/resolved. The Server Action enforces requireEditor
                regardless of which role clicked through. */}
            <AdminLink href="/admin/feedback">フィードバック</AdminLink>
            {user.isAdmin && <AdminLink href="/admin/about">JTPAとは</AdminLink>}
            {user.isAdmin && <AdminLink href="/admin/users">ユーザー</AdminLink>}
            {user.isAdmin && (
              <AdminLink href="/admin/errors">エラーログ</AdminLink>
            )}
            <AdminLink href="/admin/help">ヘルプ</AdminLink>
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
