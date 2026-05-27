"use client";

import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";

import { clientStorage } from "./client";

// Client-side limits mirror the Firebase Storage rules
// (`guides/{guideId}/{path}`) so users see a useful error before we
// even start the upload; the rules re-enforce the same constraints
// server-side as the final word.
export const MAX_GUIDE_IMAGE_BYTES = 5 * 1024 * 1024;
export const GUIDE_IMAGE_ACCEPT = "image/*";

// Strips characters that would either confuse Storage URL handling or
// have no business showing up in a generated path. We keep an extension
// so the Content-Type sniffing on download stays consistent.
function sanitizeFilename(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  // Belt-and-suspenders cap so wildly long filenames don't get rejected
  // by Storage's 1024-char total-path limit.
  return base.slice(0, 80) || "image";
}

export async function uploadGuideImage(
  guideId: string,
  file: File,
): Promise<string> {
  if (!guideId) {
    throw new Error("ガイドIDが取得できませんでした");
  }
  if (!file.type.startsWith("image/")) {
    throw new Error("画像ファイルのみアップロードできます");
  }
  if (file.size > MAX_GUIDE_IMAGE_BYTES) {
    throw new Error("画像サイズは 5MB 以下にしてください");
  }
  const path = `guides/${guideId}/${Date.now()}-${sanitizeFilename(file.name)}`;
  const r = storageRef(clientStorage, path);
  await uploadBytes(r, file, { contentType: file.type });
  return await getDownloadURL(r);
}
