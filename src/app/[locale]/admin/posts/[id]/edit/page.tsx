import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { PostForm } from "@/app/posts/_components/PostForm";
import { getSessionUser } from "@/lib/auth/session";
import { getPostById } from "@/lib/data/posts";
import {
  redirectToLocalizedPath,
  redirectToLoginPath,
} from "@/lib/i18n/redirects";

export const dynamic = "force-dynamic";

export default async function AdminEditPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return redirectToLoginPath(`/admin/posts/${id}/edit`);
  if (!user.isAdmin) return redirectToLocalizedPath("/admin/guides");

  const [t, post] = await Promise.all([
    getTranslations("EditPages"),
    getPostById(id),
  ]);
  if (!post) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">{t("post")}</h1>
      <PostForm mode="edit" user={user} post={post} returnTo="admin" />
    </div>
  );
}
