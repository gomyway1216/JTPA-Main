import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { PostForm } from "@/app/posts/_components/PostForm";
import { loginPath } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("NewPost");
  return { title: t("metadataTitle") };
}

export default async function NewPostPage() {
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("NewPost"),
  ]);
  const user = await getSessionUser();
  if (!user) redirect(loginPath("/blog/new", locale));

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t("description")}
        </p>
      </header>
      <PostForm mode="create" user={user} />
    </div>
  );
}
