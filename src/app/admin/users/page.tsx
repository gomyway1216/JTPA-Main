import { redirect } from "next/navigation";

import { UserTable } from "@/app/admin/users/_components/UserTable";
import { getSessionUser } from "@/lib/auth/session";
import { listAllUsersForAdmin } from "@/lib/data/users-admin";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const me = await getSessionUser();
  if (!me?.isAdmin) redirect("/admin/guides");

  const { users, truncated } = await listAllUsersForAdmin();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ユーザー管理</h1>
        <span className="text-xs text-zinc-500">{users.length} 名</span>
      </div>

      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
        ロールの変更は、対象ユーザーが一度サインアウトして再ログインするまで
        有効になりません。
      </p>

      {truncated && (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          ユーザー数が表示上限 (1000) を超えています。検索しても見つからない場合は
          別途追加実装が必要です。
        </p>
      )}

      <UserTable users={users} currentUid={me.uid} />
    </div>
  );
}
