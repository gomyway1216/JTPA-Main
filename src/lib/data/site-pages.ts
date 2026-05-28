import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { plainify } from "@/lib/data/serialize";
import type { SitePageDoc } from "@/lib/types";

// Slugs that are safe to expose through saveSitePage / getSitePage. Keeping
// this in one place lets the server action validate inputs against the same
// set the read path uses.
export const SITE_PAGE_SLUGS = ["about"] as const;
export type SitePageSlug = (typeof SITE_PAGE_SLUGS)[number];

// Fallback content rendered when a sitePages doc has not been saved yet.
// Same copy that used to live inline in src/app/about/page.tsx, now also
// pre-loaded into the admin editor so the first save edits real text rather
// than starting from blank.
export const SITE_PAGE_DEFAULTS: Record<
  SitePageSlug,
  { title: string; body: string }
> = {
  about: {
    title: "JTPAとは",
    body: `JTPA (Japanese Technology Professionals Association) は、Bay Area を中心に活動する日本人テックプロフェッショナルのコミュニティです。 AI・機械学習を中心とした勉強会、ネットワーキングイベント、メンバーの作ったプロジェクトの紹介などを行っています。

# 活動内容

- 定期的なオフライン/オンラインの勉強会
- 発表者を募集してのライトニングトーク
- メンバーが開発したAIプロダクトのショーケース
`,
  },
};

export async function getSitePage(
  slug: SitePageSlug,
): Promise<SitePageDoc | null> {
  const snap = await adminDb().collection("sitePages").doc(slug).get();
  if (!snap.exists) return null;
  return plainify({
    ...(snap.data() as Omit<SitePageDoc, "id">),
    id: snap.id,
  });
}
