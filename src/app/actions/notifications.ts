"use server";

import { Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/session";
import { adminDb } from "@/lib/firebase/admin";

export async function markAllNotificationsRead(): Promise<void> {
  const user = await requireUser();
  const db = adminDb();
  const snap = await db
    .collection("notifications")
    .where("recipientUid", "==", user.uid)
    .where("readAt", "==", null)
    .limit(100)
    .get();

  if (snap.empty) return;

  const now = Timestamp.now();
  const batch = db.batch();
  for (const doc of snap.docs) {
    batch.update(doc.ref, { readAt: now });
  }
  await batch.commit();
  revalidatePath("/my");
  revalidatePath("/my/notifications");
}
