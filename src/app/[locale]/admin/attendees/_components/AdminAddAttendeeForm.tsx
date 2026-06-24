"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState, useTransition } from "react";

import {
  addAdminAttendee,
  type AddAdminAttendeeError,
} from "@/app/actions/check-in";

type UserOption = {
  uid: string;
  email: string;
  displayName: string | null;
};

export function AdminAddAttendeeForm({
  eventId,
  users,
}: {
  eventId: string;
  users: UserOption[];
}) {
  const t = useTranslations("Admin.attendees");
  const router = useRouter();
  const [mode, setMode] = useState<"user" | "guest">("user");
  const [query, setQuery] = useState("");
  const [selectedUid, setSelectedUid] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestAffiliation, setGuestAffiliation] = useState("");
  const [error, setError] = useState<AddAdminAttendeeError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? users.filter(
          (u) =>
            u.email.toLowerCase().includes(q) ||
            (u.displayName ?? "").toLowerCase().includes(q),
        )
      : users;
    return filtered.slice(0, 40);
  }, [users, query]);

  const selectedUser = users.find((u) => u.uid === selectedUid);
  const optionUsers =
    selectedUser && !filteredUsers.some((u) => u.uid === selectedUser.uid)
      ? [selectedUser, ...filteredUsers]
      : filteredUsers;

  const canSubmit =
    mode === "user" ? !!selectedUid : guestName.trim().length > 0;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setNotice(null);

    startTransition(async () => {
      try {
        const res =
          mode === "user"
            ? await addAdminAttendee({
                eventId,
                kind: "user",
                uid: selectedUid,
              })
            : await addAdminAttendee({
                eventId,
                kind: "guest",
                displayName: guestName,
                email: guestEmail,
                affiliation: guestAffiliation,
              });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setNotice(
          res.alreadyAttended ? t("addAlreadyAttended") : t("addSuccess"),
        );
        if (mode === "guest") {
          setGuestName("");
          setGuestEmail("");
          setGuestAffiliation("");
        }
        router.refresh();
      } catch {
        setError("UNKNOWN");
      }
    });
  }

  return (
    <section className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-sm font-semibold">{t("addTitle")}</h2>

      <form onSubmit={submit} className="mt-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={mode === "user"}
            onClick={() => {
              setMode("user");
              setError(null);
              setNotice(null);
            }}
            className={`rounded border px-3 py-1.5 text-xs ${
              mode === "user"
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            {t("addModeUser")}
          </button>
          <button
            type="button"
            aria-pressed={mode === "guest"}
            onClick={() => {
              setMode("guest");
              setError(null);
              setNotice(null);
            }}
            className={`rounded border px-3 py-1.5 text-xs ${
              mode === "guest"
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            {t("addModeGuest")}
          </button>
        </div>

        {mode === "user" ? (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <label className="space-y-1 text-xs">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {t("userSearchLabel")}
              </span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("userSearchPlaceholder")}
                className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {t("userSelectLabel")}
              </span>
              <select
                value={selectedUid}
                onChange={(e) => setSelectedUid(e.target.value)}
                disabled={users.length === 0}
                className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                <option value="">
                  {users.length === 0
                    ? t("noUserOptions")
                    : t("userSelectPlaceholder")}
                </option>
                {optionUsers.length === 0 && users.length > 0 ? (
                  <option value="" disabled>
                    {t("noUserMatches")}
                  </option>
                ) : null}
                {optionUsers.map((u) => (
                  <option key={u.uid} value={u.uid}>
                    {(u.displayName || t("userNameFallback")) +
                      (u.email ? ` <${u.email}>` : "")}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-xs">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {t("guestNameLabel")}
              </span>
              <input
                required
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder={t("guestNamePlaceholder")}
                className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {t("guestEmailLabel")}
              </span>
              <input
                type="email"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                placeholder={t("guestEmailPlaceholder")}
                className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {t("guestAffiliationLabel")}
              </span>
              <input
                value={guestAffiliation}
                onChange={(e) => setGuestAffiliation(e.target.value)}
                placeholder={t("guestAffiliationPlaceholder")}
                className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending || !canSubmit}
            className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950"
          >
            {pending ? t("addingAttendee") : t("addAttendee")}
          </button>
          {notice && <p className="text-xs text-emerald-700">{notice}</p>}
          {error && (
            <p className="text-xs text-red-600">
              {t(`addError.${error}`)}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
