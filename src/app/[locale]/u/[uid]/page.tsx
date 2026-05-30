import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { RolePill } from "@/components/users/AuthorBadge";
import { UserLinksRow } from "@/components/users/UserLinks";
import { getPublicProfile } from "@/lib/data/users";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  const { uid } = await params;
  const t = await getTranslations("PublicProfile");
  const profile = await getPublicProfile(uid);
  if (!profile) return { title: t("notFoundTitle") };
  // Title uses @username — the universal handle — rather than the full
  // name, which may be private. Falls back to the bio for description
  // when it's been opted-public; `||` not `??` so an empty published
  // bio ("") doesn't emit `<meta name="description" content="" />`,
  // suboptimal for SEO (per PR #59 Gemini review).
  return {
    title: t("metadataTitle", { username: profile.username }),
    description: profile.bio || undefined,
  };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  const { uid } = await params;
  const t = await getTranslations("PublicProfile");
  const profile = await getPublicProfile(uid);
  if (!profile) notFound();

  // Initials fallback for the avatar — same surrogate-safe `[...str][0]`
  // pattern as the AuthorBadge to handle emoji / non-BMP usernames. The
  // initial comes from the username (the primary label) rather than the
  // full name, which may be private.
  const initial = ([...profile.username][0] ?? "?").toUpperCase();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <article className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900 space-y-5">
        <header className="flex items-start gap-4">
          {profile.photoURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.photoURL}
              alt={t("avatarAlt", { username: profile.username })}
              className="h-16 w-16 rounded-full border border-zinc-200 dark:border-zinc-800"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 text-lg font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-300">
              {initial}
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            {/*
              Heading hierarchy follows the user's `fullNamePublic`
              choice. When the real name is public, it leads (matching
              the `AuthorBadge` policy elsewhere in the app) and the
              @handle becomes the secondary label. When it's private,
              the @handle gets the H1 slot. Either way the role pill
              sits next to whichever label takes the H1 — one notch
              larger than the inline AuthorBadge so it doesn't look
              like an afterthought next to the heading.
            */}
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold break-all">
              <span>{profile.fullName || `@${profile.username}`}</span>
              {profile.role && <RolePill role={profile.role} size="lg" />}
            </h1>
            {profile.fullName && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                @{profile.username}
              </p>
            )}
            {profile.affiliation && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {profile.affiliation}
              </p>
            )}
          </div>
        </header>

        <UserLinksRow links={profile.links} ownerLabel={`@${profile.username}`} />

        {profile.bio ? (
          // Plain text with author-entered newlines preserved.
          // `break-words` handles long URLs / unbroken tokens.
          <section className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {profile.bio}
          </section>
        ) : (
          // Quiet placeholder rather than a missing section — keeps the
          // card from looking broken for users who've published nothing
          // beyond their name.
          <p className="text-sm text-zinc-500">
            {t("emptyBio")}
          </p>
        )}
      </article>
    </div>
  );
}
