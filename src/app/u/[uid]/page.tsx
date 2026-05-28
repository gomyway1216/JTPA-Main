import { notFound } from "next/navigation";

import { getPublicProfile } from "@/lib/data/users";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  const { uid } = await params;
  const profile = await getPublicProfile(uid);
  if (!profile) return { title: "ユーザーが見つかりません" };
  return {
    title: `${profile.displayName} のプロフィール`,
    description: profile.bio ?? undefined,
  };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  const { uid } = await params;
  const profile = await getPublicProfile(uid);
  if (!profile) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <article className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900 space-y-5">
        <header className="flex items-center gap-4">
          {profile.photoURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.photoURL}
              alt={`${profile.displayName} のアイコン`}
              className="h-16 w-16 rounded-full border border-zinc-200 dark:border-zinc-800"
            />
          ) : (
            // Initials fallback when no Google photo. Matches the
            // visual weight of the photo path so the layout doesn't
            // jump between users.
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 text-lg font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-300">
              {profile.displayName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-xl font-semibold">{profile.displayName}</h1>
            {profile.affiliation && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {profile.affiliation}
              </p>
            )}
          </div>
        </header>

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
            このユーザーはまだ紹介文を公開していません。
          </p>
        )}
      </article>
    </div>
  );
}
