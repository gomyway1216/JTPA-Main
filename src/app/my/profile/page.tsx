import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/session";
import { getMyProfile } from "@/lib/data/users";

import { ProfileForm } from "./_components/ProfileForm";

export const dynamic = "force-dynamic";

export default async function MyProfilePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/my/profile");

  const profile = await getMyProfile(user.uid);
  // If the profile doc doesn't exist (rare — session predates the
  // bootstrap in signInWithIdToken, or someone manually deleted the
  // doc), fall back to the session fields plus the schema defaults so
  // the form is still editable. The first save will (via Firestore
  // `update`) error if the doc genuinely doesn't exist — sign-out /
  // sign-in resolves it by re-running the bootstrap.
  //
  // Visibility flags default to false (private) — older docs that
  // pre-date these fields land here as `undefined` and get the same
  // conservative default.
  const initial = {
    affiliation: profile?.affiliation ?? "",
    bio: profile?.bio ?? "",
    affiliationPublic: profile?.affiliationPublic ?? false,
    bioPublic: profile?.bioPublic ?? false,
    emailOptIn: profile?.emailOptIn ?? true,
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">アカウント設定</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          所属・紹介文・通知設定を編集できます。各項目は個別に公開/非公開を切り替えられます。表示名・メールアドレス・アイコンは Google アカウント側で管理され、メールは常に非公開です。
        </p>
      </header>

      <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Google アカウント情報 (編集不可)
        </h2>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-zinc-500">表示名</dt>
          <dd>{user.displayName || "(未設定)"}</dd>
          <dt className="text-zinc-500">メール</dt>
          <dd>{user.email}</dd>
          {user.photoURL && (
            <>
              <dt className="text-zinc-500">アイコン</dt>
              <dd>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={user.photoURL}
                  alt={`${user.displayName} のアイコン`}
                  className="h-10 w-10 rounded-full border border-zinc-200 dark:border-zinc-800"
                />
              </dd>
            </>
          )}
        </dl>
      </section>

      <ProfileForm uid={user.uid} initial={initial} />
    </div>
  );
}
