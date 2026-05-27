"use server";

import { FieldValue } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/session";
import { countAdmins } from "@/lib/data/users-admin";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

export type ManagedRole = "admin" | "editor";

interface SetRoleArgs {
  uid: string;
  role: ManagedRole;
  grant: boolean;
}

export async function setUserRole({
  uid,
  role,
  grant,
}: SetRoleArgs): Promise<void> {
  const actor = await requireAdmin();
  if (!uid) throw new Error("uid が指定されていません");

  // Stop an admin from locking themselves out by mistake — they can demote
  // a fellow admin first, then ask that admin to demote them.
  if (!grant && role === "admin" && uid === actor.uid) {
    throw new Error("自分自身の admin ロールは剥奪できません");
  }

  // Stop revoking the very last admin — there must always be at least
  // one account able to manage the system.
  if (!grant && role === "admin") {
    const adminCount = await countAdmins();
    if (adminCount <= 1) {
      throw new Error(
        "最後の admin ロールは剥奪できません。先に別ユーザーへ admin を付与してください。",
      );
    }
  }

  const target = await adminAuth().getUser(uid);
  const current = (target.customClaims ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...current };
  if (grant) next[role] = true;
  else delete next[role];

  await adminAuth().setCustomUserClaims(uid, next);

  // Audit trail on the user's profile doc. Stored separately from the
  // claim itself so we keep a paper-trail of who flipped what and when
  // (the claim alone is just a boolean).
  await adminDb()
    .collection("users")
    .doc(uid)
    .set(
      {
        roleChangedAt: FieldValue.serverTimestamp(),
        roleChangedBy: {
          uid: actor.uid,
          email: actor.email || null,
          displayName: actor.displayName || null,
        },
      },
      { merge: true },
    );

  revalidatePath("/admin/users");
}
