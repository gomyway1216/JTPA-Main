"use client";

import { useMemo, useState, useTransition } from "react";

import { setUserRole, type ManagedRole } from "@/app/actions/roles";
import type { AdminUserListEntry } from "@/lib/data/users-admin";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function UserTable({
  users,
  currentUid,
}: {
  users: AdminUserListEntry[];
  currentUid: string;
}) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingUid, setPendingUid] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Filter by email OR displayName substring, case-insensitive. Empty query
  // shows everyone (sorted by last sign-in upstream).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.displayName ?? "").toLowerCase().includes(q),
    );
  }, [users, query]);

  // Total count drives the last-admin guard on the client — the server
  // re-checks via countAdmins(), but disabling the button locally keeps
  // the UI from offering an action that's going to fail.
  const totalAdmins = useMemo(
    () => users.filter((u) => u.isAdmin).length,
    [users],
  );

  function handleToggle(uid: string, role: ManagedRole, grant: boolean) {
    setError(null);
    setPendingUid(uid);
    startTransition(async () => {
      try {
        await setUserRole({ uid, role, grant });
      } catch (err) {
        setError(err instanceof Error ? err.message : "ロール変更に失敗しました");
      } finally {
        setPendingUid(null);
      }
    });
  }

  return (
    <div className="space-y-3">
      <input
        type="search"
        placeholder="メールアドレス or 名前で絞り込み"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      {filtered.length === 0 ? (
        <p className="text-sm text-zinc-500">該当するユーザーがいません。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500">
              <tr>
                <th className="py-2">ユーザー</th>
                <th className="py-2">ロール</th>
                <th className="py-2">最終ログイン</th>
                <th className="py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {filtered.map((u) => {
                const isSelf = u.uid === currentUid;
                const isPending = pendingUid === u.uid;
                // Last-admin guard (client-side mirror of the server check).
                const isLastAdmin = u.isAdmin && totalAdmins <= 1;
                const canRevokeAdmin = u.isAdmin && !isSelf && !isLastAdmin;

                return (
                  <tr key={u.uid}>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {u.photoURL ? (
                          <img
                            src={u.photoURL}
                            alt=""
                            width={28}
                            height={28}
                            className="h-7 w-7 rounded-full object-cover"
                          />
                        ) : (
                          <span className="inline-block h-7 w-7 rounded-full bg-zinc-200 dark:bg-zinc-700" />
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {u.displayName || "(名前未設定)"}
                            {isSelf && (
                              <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-900 dark:bg-blue-950 dark:text-blue-200">
                                あなた
                              </span>
                            )}
                          </div>
                          <div className="truncate text-xs text-zinc-500">
                            {u.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {u.isAdmin && (
                          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-900 dark:bg-purple-950 dark:text-purple-200">
                            admin
                          </span>
                        )}
                        {u.isEditor && (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                            editor
                          </span>
                        )}
                        {!u.isAdmin && !u.isEditor && (
                          <span className="text-xs text-zinc-500">なし</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 text-xs text-zinc-500">
                      {formatDate(u.lastSignInAt)}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() =>
                            handleToggle(u.uid, "editor", !u.isEditor)
                          }
                          className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                        >
                          {u.isEditor ? "editor 剥奪" : "editor 付与"}
                        </button>
                        {u.isAdmin ? (
                          <button
                            type="button"
                            disabled={isPending || !canRevokeAdmin}
                            title={
                              isSelf
                                ? "自分自身の admin は剥奪できません"
                                : isLastAdmin
                                  ? "最後の admin は剥奪できません"
                                  : undefined
                            }
                            onClick={() => handleToggle(u.uid, "admin", false)}
                            className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
                          >
                            admin 剥奪
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => handleToggle(u.uid, "admin", true)}
                            className="rounded border border-purple-300 px-2 py-1 text-xs text-purple-700 hover:bg-purple-50 disabled:opacity-50 dark:border-purple-800 dark:text-purple-300 dark:hover:bg-purple-950"
                          >
                            admin 付与
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-zinc-500">
        表示中: {filtered.length} / 全 {users.length} 名
      </p>
    </div>
  );
}
