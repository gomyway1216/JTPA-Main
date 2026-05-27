import { redirect } from "next/navigation";

import { EventForm } from "@/app/admin/events/_components/EventForm";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const user = await getSessionUser();
  if (!user?.isAdmin) redirect("/admin/guides");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">イベント新規作成</h1>
      <EventForm mode="create" />
    </div>
  );
}
