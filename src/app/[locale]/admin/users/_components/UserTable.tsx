"use client";

import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { setUserRole, type ManagedRole } from "@/app/actions/roles";
import { setEventAttendanceCount } from "@/app/actions/users";
import type { AdminUserListEntry } from "@/lib/data/users-admin";

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // Pin the timezone so the SSR pre-render (UTC on server) and the
  // client hydration produce the same string — otherwise React fires a
  // hydration warning when the server-rendered HTML doesn't match the
  // client's locale-aware render.
  return d.toLocaleString(locale === "en" ? "en-US" : "ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  });
}

export function UserTable({
  users,
  currentUid,
  truncated,
}: {
  users: AdminUserListEntry[];
  currentUid: string;
  // When the upstream listUsers walk hit its cap, `users` is incomplete
  // and the client-side admin count may undercount. The "last-admin"
  // disable in that case would be unreliable — defer entirely to the
  // server check.
  truncated: boolean;
}) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingUid, setPendingUid] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const locale = useLocale();
  const t = useTranslations("Admin.users");

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
        const res = await setUserRole({ uid, role, grant });
        // Surface the real reason (self-revoke / last-admin / race) instead
        // of the masked generic Server Action crash.
        if (!res.ok) setError(res.error);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("roleChangeFailed"));
      } finally {
        setPendingUid(null);
      }
    });
  }

  return (
    <div className="space-y-3">
      <input
        type="search"
        aria-label={t("searchAria")}
        placeholder={t("searchPlaceholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      {filtered.length === 0 ? (
        <p className="text-sm text-zinc-500">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-zinc-500">
              <tr>
                <th className="py-2">{t("columns.user")}</th>
                <th className="py-2">{t("columns.role")}</th>
                <th className="py-2">{t("columns.eventAttendanceCount")}</th>
                <th className="py-2">{t("columns.lastLogin")}</th>
                <th className="py-2 text-right">{t("columns.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {filtered.map((u) => {
                const isSelf = u.uid === currentUid;
                const isPending = pendingUid === u.uid;
                // Last-admin guard (client-side mirror of the server check).
                // Skip when the list is truncated — `totalAdmins` would
                // be undercounting and could disable the button for a
                // perfectly safe revoke. The server enforces the same
                // rule authoritatively either way.
                const isLastAdmin =
                  !truncated && u.isAdmin && totalAdmins <= 1;
                const canRevokeAdmin = u.isAdmin && !isSelf && !isLastAdmin;

                return (
                  <tr key={u.uid}>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        {u.photoURL ? (
                          <Image
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
                            {u.displayName || t("nameUnset")}
                            {isSelf && (
                              <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-900 dark:bg-blue-950 dark:text-blue-200">
                                {t("you")}
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
                        {u.isContributor && (
                          <span
                            className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-900 dark:bg-sky-950 dark:text-sky-200"
                            title={t("contributorHint")}
                          >
                            contributor
                          </span>
                        )}
                        {!u.isAdmin && !u.isEditor && !u.isContributor && (
                          <span className="text-xs text-zinc-500">{t("none")}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2">
                      <AttendanceCountEditor
                        uid={u.uid}
                        initialCount={u.eventAttendanceCount}
                      />
                    </td>
                    <td className="py-2 text-xs text-zinc-500">
                      {formatDate(u.lastSignInAt, locale)}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() =>
                            handleToggle(
                              u.uid,
                              "contributor",
                              !u.isContributor,
                            )
                          }
                          className="rounded border border-sky-300 px-2 py-1 text-xs text-sky-800 hover:bg-sky-50 disabled:opacity-50 dark:border-sky-800 dark:text-sky-300 dark:hover:bg-sky-950"
                        >
                          {u.isContributor
                            ? t("contributorRevoke")
                            : t("contributorGrant")}
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() =>
                            handleToggle(u.uid, "editor", !u.isEditor)
                          }
                          className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                        >
                          {u.isEditor ? t("editorRevoke") : t("editorGrant")}
                        </button>
                        {u.isAdmin ? (
                          <button
                            type="button"
                            disabled={isPending || !canRevokeAdmin}
                            title={
                              isSelf
                                ? t("cannotRevokeSelf")
                                : isLastAdmin
                                  ? t("cannotRevokeLast")
                                  : undefined
                            }
                            onClick={() => handleToggle(u.uid, "admin", false)}
                            className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
                          >
                            {t("adminRevoke")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => handleToggle(u.uid, "admin", true)}
                            className="rounded border border-purple-300 px-2 py-1 text-xs text-purple-700 hover:bg-purple-50 disabled:opacity-50 dark:border-purple-800 dark:text-purple-300 dark:hover:bg-purple-950"
                          >
                            {t("adminGrant")}
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
        {t("visibleCount", { visible: filtered.length, total: users.length })}
      </p>
    </div>
  );
}

function AttendanceCountEditor({
  uid,
  initialCount,
}: {
  uid: string;
  initialCount: number;
}) {
  const [value, setValue] = useState(String(initialCount));
  const [prevInitialCount, setPrevInitialCount] = useState(initialCount);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const t = useTranslations("Admin.users");

  if (initialCount !== prevInitialCount) {
    setValue(String(initialCount));
    setPrevInitialCount(initialCount);
    setError(null);
  }

  const changed = Number(value) !== initialCount;

  function save() {
    setError(null);
    const count = Number(value);
    startTransition(async () => {
      try {
        const res = await setEventAttendanceCount({ uid, count });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("attendanceSaveFailed"));
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
        />
        <button
          type="button"
          disabled={pending || !changed}
          onClick={save}
          className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {pending ? t("savingAttendance") : t("saveAttendance")}
        </button>
      </div>
      {error && <p className="max-w-40 text-[10px] text-red-600">{error}</p>}
    </div>
  );
}
