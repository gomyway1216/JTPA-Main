import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { adminAuth } from "@/lib/firebase/admin";
import {
  SESSION_COOKIE_MAX_AGE_SEC,
  SESSION_COOKIE_NAME,
} from "@/lib/firebase/config";
import type { SessionUser } from "@/lib/types";

export async function createSessionCookie(idToken: string): Promise<void> {
  const expiresIn = SESSION_COOKIE_MAX_AGE_SEC * 1000;
  const sessionCookie = await adminAuth().createSessionCookie(idToken, {
    expiresIn,
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SEC,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

// Memoized per request via React cache().
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;

  try {
    const decoded = await adminAuth().verifySessionCookie(sessionCookie, true);
    return {
      uid: decoded.uid,
      email: decoded.email ?? "",
      displayName: (decoded.name as string | undefined) ?? "",
      photoURL: (decoded.picture as string | undefined) ?? null,
      isAdmin: decoded.admin === true,
    };
  } catch {
    return null;
  }
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isAdmin) throw new Error("FORBIDDEN");
  return user;
}
