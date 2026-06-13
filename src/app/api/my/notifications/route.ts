import { getSessionUser } from "@/lib/auth/session";
import { listMyNotifications } from "@/lib/data/notifications";
import type { NotificationDoc } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json(
      { notifications: [] as NotificationDoc[] },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const notifications = await listMyNotifications(user.uid, 3);
  return Response.json(
    { notifications },
    { headers: { "Cache-Control": "no-store" } },
  );
}
