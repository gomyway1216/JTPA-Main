import Link from "next/link";
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
  if (!user.isAdmin) redirect("/");

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        <aside className="md:sticky md:top-4 md:self-start">
          <nav className="flex flex-col gap-1 text-sm">
            <AdminLink href="/admin">概要</AdminLink>
            <AdminLink href="/admin/events">イベント</AdminLink>
            <AdminLink href="/admin/projects">プロジェクト承認</AdminLink>
            <AdminLink href="/admin/attendees">参加者</AdminLink>
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
