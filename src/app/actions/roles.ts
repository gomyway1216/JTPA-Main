"use server";

import { FieldValue } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/session";
import { countAdmins } from "@/lib/data/users-admin";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { actionError } from "@/lib/i18n/action-errors";

export type ManagedRole = "admin" | "editor" | "contributor";

const VALID_ROLES: ReadonlySet<ManagedRole> = new Set([
  "admin",
  "editor",
  "contributor",
]);

interface SetRoleArgs {
  uid: string;
  role: ManagedRole;
  grant: boolean;
}

// Returning the error rather than throwing it is what lets the real message
// reach the admin — Next masks thrown Server Action errors as a generic
// digest in production (same reasoning as events.ts / users.ts, per PR #59).
export type RoleActionResult = { ok: true } | { ok: false; error: string };

export async function setUserRole(
  args: SetRoleArgs,
): Promise<RoleActionResult> {
  const actor = await requireAdmin();

  // Server Actions can be invoked with an arbitrary runtime payload —
  // including null/undefined or a non-object. Destructuring in the
  // signature would throw a TypeError on a nullish payload, which Next
  // masks as the generic production digest; guard the payload first so a
  // bad one comes back as a real { ok: false } error instead.
  if (args == null || typeof args !== "object") {
    return { ok: false, error: await actionError("roleUidRequired") };
  }
  const { uid, role, grant } = args;

  // Runtime validation — TypeScript only checks the shape at compile time,
  // and Server Actions can be invoked with any payload. Reject anything
  // that doesn't match the documented contract before we touch Auth or
  // start mutating claim objects (prevents writing keys like `__proto__`
  // or whatever else slips through type erasure).
  if (typeof uid !== "string" || uid.length === 0) {
    return { ok: false, error: await actionError("roleUidRequired") };
  }
  if (!VALID_ROLES.has(role)) {
    return {
      ok: false,
      error: await actionError("roleInvalid", { role: String(role) }),
    };
  }
  if (typeof grant !== "boolean") {
    return { ok: false, error: await actionError("roleGrantBoolean") };
  }

  const target = await adminAuth().getUser(uid);
  const current = (target.customClaims ?? {}) as Record<string, unknown>;
  const currentlyHas = current[role] === true;

  // Idempotent no-op. Crucially: this short-circuits the "last admin"
  // guard below, so trying to revoke admin from a non-admin no longer
  // pays for a countAdmins() walk or misfires on the count check.
  if (grant === currentlyHas) return { ok: true };

  // Stop an admin from locking themselves out by mistake — they can demote
  // a fellow admin first, then ask that admin to demote them.
  if (!grant && role === "admin" && uid === actor.uid) {
    return { ok: false, error: await actionError("roleSelfAdminRevoke") };
  }

  // Stop revoking the very last admin — there must always be at least
  // one account able to manage the system. Only relevant when the target
  // actually holds admin today (the no-op short-circuit above guarantees
  // currentlyHas === true here when revoking).
  if (!grant && role === "admin") {
    const adminCount = await countAdmins();
    if (adminCount <= 1) {
      return {
        ok: false,
        error: await actionError("roleLastAdminRevoke"),
      };
    }
  }

  const next: Record<string, unknown> = { ...current };
  if (grant) next[role] = true;
  else delete next[role];

  await adminAuth().setCustomUserClaims(uid, next);

  // Race-safety: the pre-check is not atomic — two concurrent revokes can
  // both observe count > 1 and proceed. If a write of ours just zeroed
  // out the admin set, restore this user's admin claim and surface the
  // conflict. Self-heals without needing a Firestore-backed lock; the
  // worst case is that one of two concurrent revokes is reverted.
  if (!grant && role === "admin") {
    const remaining = await countAdmins();
    if (remaining === 0) {
      await adminAuth().setCustomUserClaims(uid, { ...next, admin: true });
      return {
        ok: false,
        error: await actionError("roleConcurrentAdminRevoke"),
      };
    }
  }

  // Audit trail + denormalized role badge on the user's profile doc.
  // The badge mirrors the claim hierarchy (admin > editor > contributor)
  // so `AuthorBadge` can render the role pill without a per-render Auth
  // lookup; recompute from the post-write `next` claim object rather
  // than from the in-progress flip so we get the actual highest claim
  // even when multiple claims were already set. Use `update` rather
  // than `set({ merge: true })` so we don't accidentally create a
  // half-baked profile doc for a user who hasn't signed in via the app
  // yet — the role change itself has already landed, the audit + badge
  // mirror is best-effort and will self-heal on next sign-in via the
  // `signInWithIdToken` bootstrap.
  const nextBadge: "admin" | "editor" | "contributor" | null =
    next.admin === true
      ? "admin"
      : next.editor === true
        ? "editor"
        : next.contributor === true
          ? "contributor"
          : null;
  try {
    await adminDb()
      .collection("users")
      .doc(uid)
      .update({
        roleBadge: nextBadge ?? FieldValue.delete(),
        roleChangedAt: FieldValue.serverTimestamp(),
        roleChangedBy: {
          uid: actor.uid,
          email: actor.email || null,
          displayName: actor.displayName || null,
        },
      });
  } catch (err) {
    // NOT_FOUND just means the target never signed in via AuthProvider;
    // skip the audit write rather than create an incomplete profile.
    console.warn(
      `Skipped role-change audit for ${uid} (profile doc missing): ${err}`,
    );
  }

  revalidatePath("/admin/users");
  return { ok: true };
}
