"use server";

import { FieldValue } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import { requireAdmin } from "@/lib/auth/session";
import { adminDb } from "@/lib/firebase/admin";
import { inputError } from "@/lib/i18n/action-errors";
import { SITE_PAGE_SLUGS } from "@/lib/data/site-pages";

const SitePageInputSchema = z.object({
  slug: z.enum(SITE_PAGE_SLUGS),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(50000),
});

export type SitePageFormInput = z.input<typeof SitePageInputSchema>;

export async function saveSitePage(input: SitePageFormInput): Promise<void> {
  const user = await requireAdmin();
  const result = SitePageInputSchema.safeParse(input);
  if (!result.success) {
    throw new Error(await inputError(result.error.issues));
  }
  const parsed = result.data;

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

  // Slug doubles as the public route under /, so revalidating `/${slug}`
  // refreshes the corresponding page (`/about`). Also bust the admin
  // edit page so the next visit shows the just-saved value.
  revalidatePath(`/${parsed.slug}`);
  revalidatePath(`/admin/${parsed.slug}`);
}
