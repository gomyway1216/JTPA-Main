import "server-only";

import { adminAuth } from "@/lib/firebase/admin";

export interface AdminUserListEntry {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  isAdmin: boolean;
  isEditor: boolean;
  disabled: boolean;
  lastSignInAt: string | null; // ISO 8601, null if user never signed in
  createdAt: string | null; // ISO 8601
}

// Cap on how many users we hand the client per render. Firebase Auth's
// listUsers caps each call at 1000, so 5000 means up to five paged
// round-trips. Picked to comfortably cover the foreseeable member base
// while keeping the all-rows-on-one-page UI viable; past this point the
// page would need server pagination + a real search backend instead of
// client-side filtering.
const DEFAULT_CAP = 5000;

export async function listAllUsersForAdmin(
  cap: number = DEFAULT_CAP,
): Promise<{ users: AdminUserListEntry[]; truncated: boolean }> {
  const pageSize = Math.min(cap, 1000);
  const out: AdminUserListEntry[] = [];
  let pageToken: string | undefined;
  let truncated = false;

  while (out.length < cap) {
    const result = await adminAuth().listUsers(pageSize, pageToken);
    for (const u of result.users) {
      out.push({
        uid: u.uid,
        email: u.email ?? "",
        displayName: u.displayName ?? null,
        photoURL: u.photoURL ?? null,
        isAdmin: u.customClaims?.admin === true,
        isEditor: u.customClaims?.editor === true,
        disabled: u.disabled,
        lastSignInAt: u.metadata.lastSignInTime || null,
        createdAt: u.metadata.creationTime || null,
      });
      if (out.length >= cap) break;
    }
    if (!result.pageToken) break;
    if (out.length >= cap) {
      truncated = true;
      break;
    }
    pageToken = result.pageToken;
  }

  // Most-recently active first so admins see who's been around lately.
  out.sort((a, b) => {
    const at = a.lastSignInAt ? Date.parse(a.lastSignInAt) : 0;
    const bt = b.lastSignInAt ? Date.parse(b.lastSignInAt) : 0;
    return bt - at;
  });

  return { users: out, truncated };
}

// Counts admins across the whole user base. Used to refuse revoking the
// last admin (which would lock the project out of its own admin surface).
export async function countAdmins(): Promise<number> {
  let count = 0;
  let pageToken: string | undefined;
  do {
    const result = await adminAuth().listUsers(1000, pageToken);
    for (const u of result.users) {
      if (u.customClaims?.admin === true) count++;
    }
    pageToken = result.pageToken;
  } while (pageToken);
  return count;
}
