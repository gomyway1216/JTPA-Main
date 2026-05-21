"use server";

import { redirect } from "next/navigation";

import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
  clearSessionCookie,
  createSessionCookie,
} from "@/lib/auth/session";

export async function signInWithIdToken(idToken: string): Promise<void> {
  const decoded = await adminAuth().verifyIdToken(idToken, true);

  // Upsert user profile (first login bootstraps the profile doc).
  const ref = adminDb().collection("users").doc(decoded.uid);
  const now = new Date();
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      uid: decoded.uid,
      email: decoded.email ?? "",
      displayName: decoded.name ?? decoded.email?.split("@")[0] ?? "User",
      photoURL: decoded.picture ?? null,
      affiliation: "",
      emailOptIn: true,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await ref.set(
      {
        email: decoded.email ?? snap.get("email") ?? "",
        displayName: decoded.name ?? snap.get("displayName"),
        photoURL: decoded.picture ?? snap.get("photoURL") ?? null,
        updatedAt: now,
      },
      { merge: true },
    );
  }

  await createSessionCookie(idToken);
}

export async function signOut(): Promise<void> {
  await clearSessionCookie();
  redirect("/");
}
