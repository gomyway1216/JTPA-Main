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
      bio: "",
      // Default-private for affiliation/bio so signup doesn't silently
      // expose anything until the user explicitly opts in on
      // /my/profile. emailOptIn defaults to true because that's the
      // long-standing onboarding behavior — users get JTPA
      // announcements and can opt out from the profile page.
      affiliationPublic: false,
      bioPublic: false,
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
