"use client";

import {
  deleteObject,
  ref as storageRef,
  uploadBytes,
  type StorageReference,
} from "firebase/storage";

import type { ProjectAsset } from "@/lib/types";

import { clientStorage } from "./client";

/**
 * Build a token-less public download URL for a Storage object.
 *
 * `getDownloadURL()` from the Firebase SDK returns the same endpoint with
 * an `&token=<UUID>` appended. The token is only meaningful when the
 * bucket isn't public-read — for every path that calls into this helper
 * (guides, posts, projects, presentations, user avatars, event covers)
 * `storage.rules` already has `allow read: if true`, so the token adds
 * nothing the bucket doesn't already grant. Skipping it means:
 *
 * - URLs are roughly half the length and don't carry a UUID secret
 *   that gets persisted into Firestore alongside the Markdown body.
 * - There's no `firebaseStorageDownloadTokens` metadata to revoke
 *   later (a feature we never use anyway), so the per-object token
 *   rotation footgun goes away.
 *
 * The URL shape matches `getDownloadURL()` minus the token query param.
 * Caller MUST only use this for objects under a publicly-readable path.
 *
 * Host resolution: the SDK records the configured host+protocol on the
 * storage instance, defaulting to the production endpoint and being
 * overwritten by `connectStorageEmulator` (which the app calls in
 * `src/lib/firebase/client.ts` when `NEXT_PUBLIC_USE_FIREBASE_EMULATORS`
 * is on). We read those internal fields so this helper resolves the
 * same way `getDownloadURL` would in either environment — hardcoding
 * `firebasestorage.googleapis.com` would silently 404 in the emulator.
 * `_host` / `_protocol` aren't in the public type definitions but they
 * are how the SDK builds URLs internally and have been stable across
 * SDK versions; falling back to the production defaults keeps things
 * working if a future SDK rename ever drops them.
 */
type StorageHostInternals = { _host?: string; _protocol?: string };

export function publicDownloadUrl(ref: StorageReference): string {
  const s = ref.storage as unknown as StorageHostInternals;
  const host = s._host ?? "firebasestorage.googleapis.com";
  const protocol = s._protocol ?? "https";
  return `${protocol}://${host}/v0/b/${ref.bucket}/o/${encodeURIComponent(
    ref.fullPath,
  )}?alt=media`;
}

// Raster allowlist — deliberately excludes `image/svg+xml`, matching the
// raster check in `storage.rules` and ProjectForm. SVGs can carry active
// markup and we have no use case for vector uploads inside a Markdown body.
export const GUIDE_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export type GuideImageType = (typeof GUIDE_IMAGE_TYPES)[number];

// The `accept` attribute on <input type="file"> takes a comma-separated
// list of MIME types. Derived from the allowlist so the UI hint, the
// runtime validation, and the file picker can never drift apart.
export const GUIDE_IMAGE_ACCEPT = GUIDE_IMAGE_TYPES.join(",");

// Human-friendly label for the same allowlist (used in helper text).
export const GUIDE_IMAGE_LABEL = "PNG / JPEG / WebP / GIF";

// Client-side limits mirror the Firebase Storage rules
// (`guides/{guideId}/{path}`) so users see a useful error before we
// even start the upload; the rules re-enforce the same constraints
// server-side as the final word.
export const MAX_GUIDE_IMAGE_BYTES = 5 * 1024 * 1024;

export type ImageUploadErrorMessages = {
  missingGuideId(): string;
  missingQaId(): string;
  missingUserId(): string;
  unsupportedType(types: string): string;
  tooLarge(sizeMb: number): string;
};

function isAllowedType(t: string): t is GuideImageType {
  return (GUIDE_IMAGE_TYPES as readonly string[]).includes(t);
}

// Strips characters that would either confuse Storage URL handling or
// have no business showing up in a generated path. The extension is
// split off before we sanitize/truncate the base so a wildly long file
// name doesn't end up missing its `.png`/`.jpg` suffix — Content-Type
// sniffing on download relies on the extension.
function sanitizeFilename(name: string): string {
  const dot = name.lastIndexOf(".");
  const hasExt = dot > 0 && dot < name.length - 1;
  const rawBase = hasExt ? name.slice(0, dot) : name;
  const rawExt = hasExt ? name.slice(dot) : "";
  const base =
    rawBase.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 70) || "image";
  const ext = rawExt.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 10);
  return base + ext;
}

export async function uploadGuideImage(
  guideId: string,
  uid: string,
  file: File,
  messages: ImageUploadErrorMessages,
): Promise<string> {
  if (!guideId) {
    throw new Error(messages.missingGuideId());
  }
  if (!uid) {
    throw new Error(messages.missingUserId());
  }
  if (!isAllowedType(file.type)) {
    throw new Error(messages.unsupportedType(GUIDE_IMAGE_LABEL));
  }
  if (file.size > MAX_GUIDE_IMAGE_BYTES) {
    throw new Error(messages.tooLarge(5));
  }
  // Path is `guides/{guideId}/{uid}/{filename}` so Storage rules can
  // constrain writes to the uploader's own sub-folder — mirrors the Q&A
  // layout and replaces the legacy flat `guides/{guideId}/{filename}`
  // path that was admin/editor-only.
  const path = `guides/${guideId}/${uid}/${Date.now()}-${sanitizeFilename(file.name)}`;
  const r = storageRef(clientStorage, path);
  await uploadBytes(r, file, { contentType: file.type });
  return publicDownloadUrl(r);
}

/**
 * Upload an inline-Markdown image for a Q&A post. Same allowlist /
 * size limit as the guide editor; the only difference is the path
 * prefix, which keeps `storage.rules` simple. The path includes the
 * uploader's uid so a user can't drop files into someone else's Q&A
 * folder via the client.
 */
export async function uploadQaImage(
  qaId: string,
  uid: string,
  file: File,
  messages: ImageUploadErrorMessages,
): Promise<string> {
  if (!qaId) {
    throw new Error(messages.missingQaId());
  }
  if (!isAllowedType(file.type)) {
    throw new Error(messages.unsupportedType(GUIDE_IMAGE_LABEL));
  }
  if (file.size > MAX_GUIDE_IMAGE_BYTES) {
    throw new Error(messages.tooLarge(5));
  }
  const path = `qa/${qaId}/${uid}/${Date.now()}-${sanitizeFilename(file.name)}`;
  const r = storageRef(clientStorage, path);
  await uploadBytes(r, file, { contentType: file.type });
  return publicDownloadUrl(r);
}

// Per-user avatar cap. 2MB mirrors `maxSize(2)` for the `users/{uid}`
// block in `storage.rules` so the client-side error fires before the
// upload starts; the rule re-enforces it server-side as the final word.
// Smaller than the 5MB body-image cap because an avatar only ever renders
// at small sizes (16–64px) — a multi-MB source is pure waste.
export const MAX_AVATAR_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * Upload a user's profile avatar. Unlike `uploadGuideImage`/`uploadQaImage`
 * (which return just a URL for embedding inside a Markdown body), this
 * returns the full `{path, url}` pair: the Server Action persists the path
 * so it can delete the previous Storage object when the avatar is replaced
 * or removed.
 *
 * Path is `users/{uid}/avatar-{ts}-{filename}` so `storage.rules` can
 * constrain writes to the owner's own folder (the `users/{uid}` match
 * block requires `request.auth.uid == uid`). The `avatar-` prefix +
 * timestamp keeps successive uploads from colliding and makes the object
 * easy to spot in the bucket.
 */
export async function uploadUserAvatar(
  uid: string,
  file: File,
  messages: ImageUploadErrorMessages,
): Promise<ProjectAsset> {
  if (!uid) {
    throw new Error(messages.missingUserId());
  }
  if (!isAllowedType(file.type)) {
    throw new Error(messages.unsupportedType(GUIDE_IMAGE_LABEL));
  }
  if (file.size > MAX_AVATAR_IMAGE_BYTES) {
    throw new Error(messages.tooLarge(2));
  }
  const path = `users/${uid}/avatar-${Date.now()}-${sanitizeFilename(file.name)}`;
  const r = storageRef(clientStorage, path);
  await uploadBytes(r, file, { contentType: file.type });
  return { path, url: publicDownloadUrl(r) };
}

/**
 * Delete an avatar object the client just uploaded. Used to clean up an
 * orphan when the follow-up `updateMyAvatar` Server Action fails *after* the
 * upload already landed, so the bucket doesn't accumulate unreferenced
 * files (per PR #96 Gemini review). The caller passes the `path` from
 * `uploadUserAvatar`'s result — always under their own `users/{uid}/`
 * folder, which `storage.rules` lets the owner delete.
 */
export async function deleteUserAvatarObject(path: string): Promise<void> {
  await deleteObject(storageRef(clientStorage, path));
}
