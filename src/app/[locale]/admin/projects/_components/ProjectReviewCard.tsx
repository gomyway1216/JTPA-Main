import Link from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import Image from "next/image";

import { MarkdownBody } from "@/components/markdown/MarkdownBody";
import type { PublicProfile } from "@/lib/data/users";
import type { ProjectDoc } from "@/lib/types";

import { ProjectDecisionControls } from "./ProjectDecisionControls";

export async function ProjectReviewCard({
  project,
  ownerProfile,
}: {
  project: ProjectDoc;
  // Resolved server-side by the parent admin page so this card can
  // show the owner's current @username instead of the denormalized
  // `project.ownerName` snapshot. Falls back to the denormalized name
  // when the user doc is gone so the queue still identifies the owner.
  ownerProfile: PublicProfile | null;
}) {
  const [t, common] = await Promise.all([
    getTranslations("Admin.projects"),
    getTranslations("Admin.common"),
  ]);

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{project.title}</h3>
          <p className="text-xs text-zinc-500">
            {ownerProfile ? `@${ownerProfile.username}` : project.ownerName}
            {project.appUrl && (
              <>
                {" · "}
                <a
                  href={project.appUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-blue-600 hover:underline"
                >
                  {t("openApp")}
                </a>
              </>
            )}
            {project.repoUrl && (
              <>
                {" · "}
                <a
                  href={project.repoUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-blue-600 hover:underline"
                >
                  {t("repository")}
                </a>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
          <Link
            href={`/showcase/${project.slug}`}
            className="text-zinc-500 hover:underline"
          >
            {common("preview")}
          </Link>
          <Link
            href={`/admin/projects/${project.id}/edit`}
            className="text-zinc-500 hover:underline"
          >
            {common("editContent")}
          </Link>
        </div>
      </header>
      <div className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
        <MarkdownBody source={project.description} />
      </div>
      {(project.thumbnail || (project.screenshots?.length ?? 0) > 0) && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {project.thumbnail && (
            <li>
              <Image
                src={project.thumbnail.url}
                alt={t("thumbnailAlt")}
                width={80}
                height={80}
                className="h-20 w-20 rounded border border-zinc-200 object-cover dark:border-zinc-800"
              />
            </li>
          )}
          {project.screenshots?.map((s, i) => (
            <li key={s.path}>
              <Image
                src={s.url}
                alt={t("screenshotAlt", { number: i + 1 })}
                width={80}
                height={80}
                className="h-20 w-20 rounded border border-zinc-200 object-cover dark:border-zinc-800"
              />
            </li>
          ))}
        </ul>
      )}
      {project.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {project.tags.map((t) => (
            <span
              key={t}
              className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {t}
            </span>
          ))}
        </div>
      )}
      <ProjectDecisionControls projectId={project.id} />
    </article>
  );
}
