import { notFound } from "next/navigation";

import { CommentsSection } from "@/components/comments/CommentsSection";
import { LikeButton } from "@/components/likes/LikeButton";
import { AuthorBadge } from "@/components/users/AuthorBadge";
import { getSessionUser } from "@/lib/auth/session";
import { listComments } from "@/lib/data/comments";
import { getMyLikesForParent, RECORD_LIKE_KEY } from "@/lib/data/likes";
import { getProjectBySlug } from "@/lib/data/projects";
import { getPublicProfilesByUids } from "@/lib/data/users";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (!project || project.status !== "approved") notFound();

  // Session + comment listing are independent — kick them off together
  // rather than serially. The like-state query depends on the comment
  // ids so it stays after the join.
  const [user, comments] = await Promise.all([
    getSessionUser(),
    listComments("project", project.id).catch((err) => {
      console.error("Failed to list project comments:", err);
      return [];
    }),
  ]);
  const likedSet = await getMyLikesForParent({
    parentType: "project",
    parentId: project.id,
    commentIds: comments.map((c) => c.id),
    uid: user?.uid ?? null,
  }).catch((err) => {
    console.error("Failed to load project like state:", err);
    return new Set<string>();
  });
  // Batched profile read for the project owner + every commenter.
  const profilesByUid = await getPublicProfilesByUids([
    project.ownerUid,
    ...comments.map((c) => c.authorUid),
  ]);

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{project.title}</h1>
        <p className="flex items-center gap-1.5 text-sm text-zinc-500">
          <span>投稿者:</span>
          <AuthorBadge
            profile={profilesByUid.get(project.ownerUid) ?? null}
            size="md"
          />
        </p>
        {project.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {project.tags.map((t) => (
              <span
                key={t}
                className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="pt-1">
          <LikeButton
            target="record"
            parentType="project"
            parentId={project.id}
            parentSlug={project.slug}
            initialLiked={likedSet.has(RECORD_LIKE_KEY)}
            initialCount={project.likeCount ?? 0}
            user={user}
          />
        </div>
      </header>

      {project.thumbnail && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={project.thumbnail.url}
          alt={`${project.title} のカバー画像`}
          className="w-full rounded-lg border border-zinc-200 object-cover dark:border-zinc-800"
        />
      )}

      {/* Plain-text description (not Markdown) — see events/[slug]/page.tsx. */}
      <section className="whitespace-pre-wrap break-words leading-relaxed">
        {project.description}
      </section>

      {(project.screenshots?.length ?? 0) > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">スクリーンショット</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {project.screenshots?.map((s, i) => (
              <li key={s.path}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.url}
                    alt={`screenshot ${i + 1}`}
                    className="h-32 w-full rounded border border-zinc-200 object-cover hover:opacity-90 dark:border-zinc-800"
                  />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        External links use plain `<a>` rather than next/link — next/link is
        built for client-side internal navigation (prefetching, the App
        Router's transition machinery, etc.) and just adds noise for
        outbound URLs. Per Gemini review on PR #56.
      */}
      <div className="flex flex-wrap gap-3">
        {project.appUrl && (
          <a
            href={project.appUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            アプリを開く →
          </a>
        )}
        {project.repoUrl && (
          <a
            href={project.repoUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
          >
            ソースコード
          </a>
        )}
        {project.demoVideoUrl && (
          <a
            href={project.demoVideoUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
          >
            デモ動画
          </a>
        )}
      </div>

      <CommentsSection
        key={project.id}
        parentType="project"
        parentId={project.id}
        parentSlug={project.slug}
        initialComments={comments}
        initialLikedKeys={[...likedSet]}
        profilesByUid={Object.fromEntries(profilesByUid)}
        user={user}
      />
    </article>
  );
}
