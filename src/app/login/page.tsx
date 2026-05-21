import { redirect } from "next/navigation";

import { SignInButton } from "@/components/auth/SignInButton";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const user = await getSessionUser();
  const { redirect: redirectTo } = await searchParams;
  if (user) redirect(redirectTo || "/");

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">ログイン</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          イベントへのRSVPや、ショーケースへのプロジェクト投稿にはGoogleアカウントでのログインが必要です。
        </p>
      </div>
      <SignInButton redirectTo={redirectTo || "/"} />
    </div>
  );
}
