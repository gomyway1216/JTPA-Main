import { getLocale, getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

import { PostForm } from "@/app/posts/_components/PostForm";
import { loginPath } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";
import { getPostById } from "@/lib/data/posts";

export const dynamic = "force-dynamic";

export default async function EditMyPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("EditPages"),
  ]);
  const user = await getSessionUser();
  if (!user) redirect(loginPath(`/my/posts/${id}/edit`, locale));

  const post = await getPostById(id);
  if (!post) notFound();
  // Owner OR admin can edit. Admins editing other people's posts is the
  // shortcut for typo fixes etc; the full moderation queue is /admin/posts.
  if (post.authorUid !== user.uid && !user.isAdmin) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-4">
      <h1 className="text-2xl font-bold">{t("post")}</h1>
      <PostForm mode="edit" user={user} post={post} />
    </div>
  );
}
