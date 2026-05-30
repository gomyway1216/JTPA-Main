import { notFound, redirect } from "next/navigation";

import { QaForm } from "@/app/[locale]/qa/_components/QaForm";
import { getSessionUser } from "@/lib/auth/session";
import { getQaBySlug } from "@/lib/data/qa";

export const metadata = { title: "Q&A を編集" };
export const dynamic = "force-dynamic";

export default async function EditQaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/login?redirect=/qa/${slug}/edit`);

  const qa = await getQaBySlug(slug);
  if (!qa) notFound();
  if (qa.authorUid !== user.uid && !user.isAdmin) {
    // Non-owners get a 404 rather than a 403 so we don't leak whether
    // the slug exists.
    notFound();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Q&amp;A を編集</h1>
      </header>
      <QaForm mode="edit" user={user} qa={qa} />
    </div>
  );
}
