"use server";

import { Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/session";
import { adminDb } from "@/lib/firebase/admin";

const MARK_READ_BATCH_SIZE = 500;

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
  revalidatePath("/my");
  revalidatePath("/my/notifications");
}
