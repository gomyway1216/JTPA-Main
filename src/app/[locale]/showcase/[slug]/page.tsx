import { getTranslations } from "next-intl/server";
import Image from "next/image";
import { notFound } from "next/navigation";

import { CommentsSection } from "@/components/comments/CommentsSection";
import { LikeButton } from "@/components/likes/LikeButton";
import { MarkdownBody } from "@/components/markdown/MarkdownBody";
import { AuthorBadge } from "@/components/users/AuthorBadge";
import { getSessionUser } from "@/lib/auth/session";
import { getProjectBySlugCached } from "@/lib/data/cached";
import { listComments } from "@/lib/data/comments";
import { getMyLikesForParent, RECORD_LIKE_KEY } from "@/lib/data/likes";
import { getPublicProfilesByUids } from "@/lib/data/users";
import { getLocalizedProjectContent } from "@/lib/localized-content";
import { canViewProjectDetail } from "@/lib/projects-visibility";
import { stripMarkdown, truncate } from "@/lib/utils";

// Per-request render (session, like state, comments stay fresh); only the
// project document is served from the shared data cache.
export const dynamic = "force-dynamic";

function loadProjectComments(projectId: string) {
  return listComments("project", projectId).catch((err) => {
    console.error("Failed to list project comments:", err);
    return { comments: [], nextCursor: null };
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const project = await getProjectBySlugCached(slug).catch(() => null);
  if (!project || project.status !== "approved") {
    return {};
  }
  const content = getLocalizedProjectContent(project, locale);
  const description = truncate(stripMarkdown(content.description), 160);
  const images = project.thumbnail ? [project.thumbnail.url] : undefined;
  return {
    title: content.title,
    description,
    openGraph: {
      title: content.title,
      description,
      images,
    },
    twitter: {
      card: project.thumbnail ? "summary_large_image" : "summary",
      title: content.title,
      description,
      images,
    },
  };
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const userPromise = getSessionUser();
  const [t, project] = await Promise.all([
    getTranslations("ShowcaseDetail"),
    getProjectBySlugCached(slug),
  ]);
  if (!project) notFound();

  const isPrivatePreview = project.status !== "approved";
  const commentsPagePromise = isPrivatePreview
    ? null
    : loadProjectComments(project.id);
  const user = await userPromise;
  if (!canViewProjectDetail(project, user, locale)) notFound();
  const content = getLocalizedProjectContent(project, locale);

  const statusT = isPrivatePreview ? await getTranslations("Status") : null;
  const commentsPage = await (
    commentsPagePromise ?? loadProjectComments(project.id)
  );
  const { comments, nextCursor: commentsNextCursor } = commentsPage;
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
        <h1 className="text-3xl font-bold">{content.title}</h1>
        {isPrivatePreview && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {t.rich("statusNotice", {
              status: statusT ? statusT(project.status) : "",
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </div>
        )}
        <p className="flex items-center gap-1.5 text-sm text-zinc-500">
          <span>{t("author")}</span>
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
        // The source ratio is whatever the submitter uploaded; width/height
        // only pre-reserve a 16:9 box while loading — Tailwind preflight's
        // `img { height: auto }` keeps the rendered height tracking the
        // real ratio at full width, exactly like the old raw <img>.
        // `preload`: the cover is the LCP element on projects that have one.
        <Image
          src={project.thumbnail.url}
          alt={t("coverAlt", { title: content.title })}
          width={1600}
          height={900}
          preload
          sizes="(max-width: 768px) 100vw, 736px"
          className="w-full rounded-lg border border-zinc-200 object-cover dark:border-zinc-800"
        />
      )}

      <MarkdownBody source={content.description} />

      {(project.screenshots?.length ?? 0) > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{t("screenshots")}</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {project.screenshots?.map((s, i) => (
              <li key={s.path}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block"
                >
                  <Image
                    src={s.url}
                    alt={`${content.title} screenshot ${i + 1}`}
                    width={640}
                    height={360}
                    sizes="(max-width: 640px) 50vw, 240px"
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
            {t("openApp")}
          </a>
        )}
        {project.repoUrl && (
          <a
            href={project.repoUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
          >
            {t("sourceCode")}
          </a>
        )}
        {project.demoVideoUrl && (
          <a
            href={project.demoVideoUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
          >
            {t("demoVideo")}
          </a>
        )}
      </div>

      <CommentsSection
        key={project.id}
        parentType="project"
        parentId={project.id}
        parentSlug={project.slug}
        initialComments={comments}
        initialNextCursor={commentsNextCursor}
        initialLikedKeys={[...likedSet]}
        profilesByUid={Object.fromEntries(profilesByUid)}
        user={user}
      />
    </article>
  );
}
