import { getLocale, getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

import { PollForm } from "@/app/[locale]/poll/_components/PollForm";
import { loginPath } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";
import { getPollBySlug } from "@/lib/data/poll";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("EditPages");
  return { title: t("poll") };
}

export default async function EditPollPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) {
    const locale = await getLocale();
    redirect(loginPath(`/poll/${slug}/edit`, locale));
  }

  const t = await getTranslations("EditPages");

  const poll = await getPollBySlug(slug);
  if (!poll) notFound();
  if (poll.authorUid !== user.uid && !user.isAdmin) {
    // 404 (not 403) so we don't leak whether the slug exists for
    // non-owners — matches the Q&A pattern.
    notFound();
  }

  // The server action also enforces this freeze; passing the flag
  // through to the form just makes the constraint visible to the user
  // before they try to save.
  const optionsLocked = (poll.voterCount ?? 0) > 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t("poll")}</h1>
      </header>
      <PollForm mode="edit" poll={poll} optionsLocked={optionsLocked} />
    </div>
  );
}
