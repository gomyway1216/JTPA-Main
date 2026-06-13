import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { fromSnap, type SnapLike } from "@/lib/data/from-snap";
import { NotificationDocSchema } from "@/lib/data/schemas";
import { plainify } from "@/lib/data/serialize";
import type { NotificationDoc } from "@/lib/types";

function toDoc(doc: SnapLike): NotificationDoc {
  const data = fromSnap<Omit<NotificationDoc, "id">>(
    doc,
    NotificationDocSchema,
    "notifications",
  );
  return plainify({
    ...data,
    readAt: data.readAt ?? null,
    id: doc.id,
  });
}

export async function listMyNotifications(
  uid: string,
  limit = 50,
): Promise<NotificationDoc[]> {
  const snap = await adminDb()
    .collection("notifications")
    .where("recipientUid", "==", uid)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map(toDoc);
}

export async function listUnreadNotifications(
  uid: string,
  limit = 100,
): Promise<NotificationDoc[]> {
  const snap = await adminDb()
    .collection("notifications")
    .where("recipientUid", "==", uid)
    .where("readAt", "==", null)
    .limit(limit)
    .get();
  return snap.docs.map(toDoc);
}

export async function countUnreadNotifications(uid: string): Promise<number> {
  const snap = await adminDb()
    .collection("notifications")
    .where("recipientUid", "==", uid)
    .where("readAt", "==", null)
    .count()
    .get();
  const count = snap.data().count;
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}
