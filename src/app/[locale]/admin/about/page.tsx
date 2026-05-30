import Link from "@/i18n/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { getSessionUser } from "@/lib/auth/session";
import { getSitePage } from "@/lib/data/site-pages";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";

import { AboutForm } from "./_components/AboutForm";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.about");
  return { title: t("metadataTitle") };
}

export default async function AdminAboutPage() {
  const user = await getSessionUser();
  // Editor-only routes (guides) live alongside this one; bounce non-admins
  // there so they don't see a forbidden screen.
  if (!user?.isAdmin) return redirectToLocalizedPath("/admin/guides");

  const page = await getSitePage("about");
  const [t, aboutT] = await Promise.all([
    getTranslations("Admin.about"),
    getTranslations("AboutPage"),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <Link
          href="/about"
          className="text-sm text-blue-600 hover:underline"
        >
          {t("viewPublic")}
        </Link>
      </div>
      <p className="text-sm text-zinc-500">
        {t("description")}
      </p>
      <AboutForm
        initialTitle={page?.title ?? aboutT("defaultTitle")}
        initialBody={page?.body ?? aboutT("defaultBody")}
      />
    </div>
  );
}
