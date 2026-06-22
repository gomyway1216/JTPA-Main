import { getTranslations } from "next-intl/server";

import { GuideForm } from "@/app/[locale]/admin/guides/_components/GuideForm";
import { getSessionUser } from "@/lib/auth/session";
import {
  redirectToLocalizedPath,
  redirectToLoginPath,
} from "@/lib/i18n/redirects";

export const dynamic = "force-dynamic";

export default async function NewGuidePage() {
  const user = await getSessionUser();
  // /admin/* is gated by the layout, but `requireEditor()` in the layout
  // throws on a missing claim; this redirect is a UX nicety for an
  // already-disallowed path. We also need `user` to thread into the
  // form so it knows whether to publish directly or request review.
  if (!user) return redirectToLoginPath("/admin/guides/new");
  if (!user.isAdmin && !user.isEditor) return redirectToLocalizedPath("/admin/guides");
  const t = await getTranslations("Admin.guides");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("newTitle")}</h1>
      <GuideForm mode="create" user={user} showCurationFields />
    </div>
  );
}
