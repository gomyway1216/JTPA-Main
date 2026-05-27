"use client";

import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";

import { clientStorage } from "./client";

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
  file: File,
): Promise<string> {
  if (!guideId) {
    throw new Error("ガイドIDが取得できませんでした");
  }
  if (!isAllowedType(file.type)) {
    throw new Error(`画像形式は ${GUIDE_IMAGE_LABEL} のみ対応しています`);
  }
  if (file.size > MAX_GUIDE_IMAGE_BYTES) {
    throw new Error("画像サイズは 5MB 以下にしてください");
  }
  const path = `guides/${guideId}/${Date.now()}-${sanitizeFilename(file.name)}`;
  const r = storageRef(clientStorage, path);
  await uploadBytes(r, file, { contentType: file.type });
  return await getDownloadURL(r);
}
