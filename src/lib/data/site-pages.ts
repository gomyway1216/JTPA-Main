import "server-only";

import { cache } from "react";

import { adminDb } from "@/lib/firebase/admin";
import { plainify } from "@/lib/data/serialize";
import type { SitePageDoc } from "@/lib/types";
import jaMessages from "../../../messages/ja.json";

// Slugs that are safe to expose through saveSitePage / getSitePage. Keeping
// this in one place lets the server action validate inputs against the same
// set the read path uses.
export const SITE_PAGE_SLUGS = ["about"] as const;
export type SitePageSlug = (typeof SITE_PAGE_SLUGS)[number];

// Default-locale fallback content. The localized pages read their fallback
// from the message catalog directly; this export stays for data-layer tests
// and callers that need the app's default locale without a request context.
export const SITE_PAGE_DEFAULTS: Record<
  SitePageSlug,
  { title: string; body: string }
> = {
  about: {
    title: jaMessages.AboutPage.defaultTitle,
    body: jaMessages.AboutPage.defaultBody,
  },
};

// Wrapped in React `cache` so a single request hits Firestore once even when
// both `generateMetadata` and the page component call this with the same
// slug. Matches the pattern used by `getSessionUser` in src/lib/auth/session.ts.
export const getSitePage = cache(
  async (slug: SitePageSlug): Promise<SitePageDoc | null> => {
    const snap = await adminDb().collection("sitePages").doc(slug).get();
    if (!snap.exists) return null;
    return plainify({
      ...(snap.data() as Omit<SitePageDoc, "id">),
      id: snap.id,
    });
  },
);
