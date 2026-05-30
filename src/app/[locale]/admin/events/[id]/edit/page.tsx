import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { EventForm } from "@/app/[locale]/admin/events/_components/EventForm";
import { getSessionUser } from "@/lib/auth/session";
import { getEventById } from "@/lib/data/events";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";

export const dynamic = "force-dynamic";

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user?.isAdmin) return redirectToLocalizedPath("/admin/guides");

  const { id } = await params;
  const event = await getEventById(id);
  if (!event) notFound();
  const t = await getTranslations("Admin.events");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("editTitle")}</h1>
      <EventForm mode="edit" user={user} event={event} />
    </div>
  );
}
