import "server-only";

import * as z from "zod";

import { adminDb, adminStorage } from "@/lib/firebase/admin";
import { inputError } from "@/lib/i18n/action-errors";
import { slugify } from "@/lib/utils";

// Helpers shared by the content Server Actions (posts / guides / projects /
// events / qa / site-pages). Deliberately a plain module — NOT "use server" —
// these run *inside* actions; they are not action endpoints themselves.

export type ParsedInput<T extends z.ZodTypeAny> =
  | { ok: true; data: z.infer<T> }
  | { ok: false; error: string };

// Zod parse → `{ ok }` result with a readable, localized error so the caller
// can return which field failed instead of throwing — Next masks thrown
// Server Action errors as a generic digest in production.
// `mapIssueMessage` lets a caller translate sentinel messages embedded in a
// schema (see the id-regex message in qa.ts) before the issues are formatted.
export async function parseInput<T extends z.ZodTypeAny>(
  schema: T,
  input: z.input<T>,
  mapIssueMessage?: (message: string) => string | Promise<string>,
): Promise<ParsedInput<T>> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const issues = mapIssueMessage
    ? await Promise.all(
        result.error.issues.map(async (issue) => ({
          path: issue.path,
          message: await mapIssueMessage(issue.message),
        })),
      )
    : result.error.issues;
  return { ok: false, error: await inputError(issues) };
}

export interface FindUniqueSlugOptions {
  // `slugify` fallback prefix for titles that strip to nothing (CJK-only).
  prefix?: string;
  // Doc id that is allowed to already own the slug — the edit flow's own
  // doc shouldn't count as a collision against itself.
  existingId?: string;
  // Collision probes before giving up on the fallback suffix.
  attempts?: number;
  // Candidate built for retry `attempt` (≥ 1). Defaults to a `-1`, `-2`, …
  // counter; qa.ts swaps in a base36 timestamp instead.
  retrySuffix?: (slug: string, attempt: number) => string;
  // Last-resort slug once the probe budget is exhausted. Defaults to a
  // base36-timestamp suffix so callers always get *some* slug back.
  fallback?: (slug: string) => string;
}

// Try the base slug first, then the retry suffixes, until a candidate is
// free in `collection` (or already owned by `existingId`).
export async function findUniqueSlug(
  collection: string,
  base: string,
  options: FindUniqueSlugOptions = {},
): Promise<string> {
  const {
    prefix,
    existingId,
    attempts = 20,
    retrySuffix = (slug, attempt) => `${slug}-${attempt}`,
    fallback = (slug) => `${slug}-${Date.now().toString(36)}`,
  } = options;
  const slug = slugify(base, prefix);
  for (let i = 0; i < attempts; i++) {
    const candidate = i === 0 ? slug : retrySuffix(slug, i);
    const snap = await adminDb()
      .collection(collection)
      .where("slug", "==", candidate)
      .limit(1)
      .get();
    if (snap.empty || snap.docs[0].id === existingId) return candidate;
  }
  return fallback(slug);
}

// Best-effort Storage cleanup. Logged and swallowed so a single missing object
// can't block a metadata write or a doc deletion.
export async function deleteStoragePaths(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const bucket = adminStorage().bucket();
  await Promise.all(
    paths.map((p) =>
      bucket
        .file(p)
        .delete()
        .catch((err) => {
          console.warn("Failed to delete storage object:", p, err);
        }),
    ),
  );
}
