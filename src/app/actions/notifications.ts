"use server";

import { Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/session";
import { adminDb } from "@/lib/firebase/admin";
import type { NotificationDoc } from "@/lib/types";

const MARK_READ_BATCH_SIZE = 500;

type NotificationReadState = Pick<NotificationDoc, "recipientUid" | "readAt">;

function revalidateNotificationSurfaces() {
  revalidatePath("/my");
  revalidatePath("/my/notifications");
}

export async function markNotificationRead(
  notificationId: string,
): Promise<void> {
  const user = await requireUser();
  const id = notificationId.trim();
  if (!id) return;

  const ref = adminDb().collection("notifications").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return;

  const data = snap.data() as NotificationReadState;
  if (data.recipientUid !== user.uid || data.readAt) return;

  await ref.update({ readAt: Timestamp.now() });
  revalidateNotificationSurfaces();
}

export async function markAllNotificationsRead(): Promise<void> {
  const user = await requireUser();
  const db = adminDb();

  let touched = false;
  while (true) {
    const snap = await db
      .collection("notifications")
      .where("recipientUid", "==", user.uid)
      .where("readAt", "==", null)
      .limit(MARK_READ_BATCH_SIZE)
      .get();

    if (snap.empty) break;

    const now = Timestamp.now();
    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.update(doc.ref, { readAt: now });
    }
    await batch.commit();
    touched = true;
  }

  if (!touched) return;
  revalidateNotificationSurfaces();
}
