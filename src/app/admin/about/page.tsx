import Link from "next/link";
import { redirect } from "next/navigation";

import { AboutForm } from "@/app/admin/about/_components/AboutForm";
import { getSessionUser } from "@/lib/auth/session";
import { getSitePage, SITE_PAGE_DEFAULTS } from "@/lib/data/site-pages";

export const dynamic = "force-dynamic";
export const metadata = { title: "JTPAとは編集" };

export default async function AdminAboutPage() {
  const user = await getSessionUser();
  // Editor-only routes (guides) live alongside this one; bounce non-admins
  // there so they don't see a forbidden screen.
  if (!user?.isAdmin) redirect("/admin/guides");

  const page = await getSitePage("about");
  const defaults = SITE_PAGE_DEFAULTS.about;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">JTPAとは編集</h1>
        <Link
          href="/about"
          className="text-sm text-blue-600 hover:underline"
        >
          /about を表示 →
        </Link>
      </div>
      <p className="text-sm text-zinc-500">
        /about ページの本文を Markdown で編集します。保存後すぐに公開ページに反映されます。
      </p>
      <AboutForm
        initialTitle={page?.title ?? defaults.title}
        initialBody={page?.body ?? defaults.body}
      />
    </div>
  );
}
