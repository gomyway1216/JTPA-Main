import { notFound, redirect } from "next/navigation";

import { EventForm } from "@/app/[locale]/admin/events/_components/EventForm";
import { getSessionUser } from "@/lib/auth/session";
import { getEventById } from "@/lib/data/events";

export const dynamic = "force-dynamic";

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user?.isAdmin) redirect("/admin/guides");

  const { id } = await params;
  const event = await getEventById(id);
  if (!event) notFound();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">イベント編集</h1>
      <EventForm mode="edit" user={user} event={event} />
    </div>
  );
}
