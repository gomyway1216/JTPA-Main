import { redirect } from "next/navigation";

import { PollForm } from "@/app/poll/_components/PollForm";
import { getSessionUser } from "@/lib/auth/session";

export const metadata = { title: "投票を作成" };

export default async function NewPollPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/poll/new");

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">投票を作成</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          選択肢を 2〜8 つ用意してください。複数選択OK・投票後の変更も自由です。
        </p>
      </header>
      <PollForm mode="create" />
    </div>
  );
}
