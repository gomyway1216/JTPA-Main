import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { EventForm } from "@/app/[locale]/admin/events/_components/EventForm";
import { CampaignLinks } from "@/app/[locale]/admin/events/[id]/edit/CampaignLinks";
import { localizedPath } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";
import { getEventById } from "@/lib/data/events";
import { eventPromotionLinks } from "@/lib/event-links";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";
import { siteBaseUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const user = await getSessionUser();
  if (!user?.isAdmin) return redirectToLocalizedPath("/admin/guides");

  const { id, locale } = await params;
  const event = await getEventById(id);
  if (!event) notFound();
  const t = await getTranslations("Admin.events");
  const eventUrl = `${siteBaseUrl()}${localizedPath(`/events/${event.slug}`, locale)}`;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("editTitle")}</h1>
      <CampaignLinks links={eventPromotionLinks(eventUrl, event.slug)} />
      <EventForm mode="edit" user={user} event={event} />
    </div>
  );
}
