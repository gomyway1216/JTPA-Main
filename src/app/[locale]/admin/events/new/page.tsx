import { getTranslations } from "next-intl/server";

import { EventForm } from "@/app/[locale]/admin/events/_components/EventForm";
import { getSessionUser } from "@/lib/auth/session";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const user = await getSessionUser();
  if (!user?.isAdmin) return redirectToLocalizedPath("/admin/guides");
  const t = await getTranslations("Admin.events");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("newTitle")}</h1>
      <EventForm mode="create" user={user} />
    </div>
  );
}
