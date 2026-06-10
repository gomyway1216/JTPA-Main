import { getTranslations } from "next-intl/server";

// Shown at the top of an admin page when one or more of its data reads
// failed (see `safeLoad` in @/lib/data/safe-load). Failed sections still
// render as empty lists so the rest of the page stays usable — without
// this banner an admin couldn't tell "nothing pending" from "query failed".
// Renders nothing when `show` is false so pages can include it
// unconditionally.
export async function LoadErrorBanner({ show }: { show: boolean }) {
  if (!show) return null;
  const t = await getTranslations("Admin.common");
  return (
    <p
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      {t("loadError")}
    </p>
  );
}
