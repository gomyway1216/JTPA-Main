import { EventForm } from "@/app/admin/events/_components/EventForm";

export const dynamic = "force-dynamic";

export default function NewEventPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">イベント新規作成</h1>
      <EventForm mode="create" />
    </div>
  );
}
