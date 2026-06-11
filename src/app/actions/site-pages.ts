"use server";

import { FieldValue } from "firebase-admin/firestore";
import { revalidatePath, updateTag } from "next/cache";
import * as z from "zod";

import { parseInput } from "@/lib/actions/shared";
import { requireAdmin } from "@/lib/auth/session";
import { SITE_PAGES_TAG } from "@/lib/data/cache-tags";
import { adminDb } from "@/lib/firebase/admin";
import { SITE_PAGE_SLUGS } from "@/lib/data/site-pages";

const SitePageInputSchema = z.object({
  slug: z.enum(SITE_PAGE_SLUGS),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(50000),
});

export type SitePageFormInput = z.input<typeof SitePageInputSchema>;

// Returning the error rather than throwing it is what lets the real message
// reach the admin — Next masks thrown Server Action errors as a generic
// digest in production (same reasoning as posts.ts / events.ts, per PR #59).
export type SitePageSaveResult = { ok: true } | { ok: false; error: string };

export async function saveSitePage(
  input: SitePageFormInput,
): Promise<SitePageSaveResult> {
  const user = await requireAdmin();
  const pr = await parseInput(SitePageInputSchema, input);
  if (!pr.ok) return pr;
  const parsed = pr.data;

  await adminDb()
    .collection("sitePages")
    .doc(parsed.slug)
    .set(
      {
        slug: parsed.slug,
        title: parsed.title,
        body: parsed.body,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: {
          uid: user.uid,
          displayName: user.displayName || null,
          email: user.email || null,
        },
      },
      { merge: true },
    );

  // Expire the cross-request data cache for the public page body
  // (src/lib/data/cached.ts) — covers both locales at once. The admin
  // edit form reads the uncached getSitePage, so it's always fresh.
  updateTag(SITE_PAGES_TAG);
  // Slug doubles as the public route under /, so revalidating `/${slug}`
  // refreshes the corresponding page (`/about`). Also bust the admin
  // edit page so the next visit shows the just-saved value.
  revalidatePath(`/${parsed.slug}`);
  revalidatePath(`/admin/${parsed.slug}`);
  return { ok: true };
}
