"use client";

import Link from "@/i18n/navigation";
import { unstable_rethrow } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";

import {
  checkUsernameAvailable,
  removeMyAvatar,
  updateMyAvatar,
  updateMyProfile,
  type UsernameAvailability,
} from "@/app/actions/users";
import { SaveFlash } from "@/components/forms/SaveFlash";
import { DeleteConfirmationDialog } from "@/components/ui/DeleteConfirmationDialog";
import {
  deleteUserAvatarObject,
  GUIDE_IMAGE_ACCEPT,
  GUIDE_IMAGE_LABEL,
  uploadUserAvatar,
} from "@/lib/firebase/uploads";
import type { ProjectAsset } from "@/lib/types";
import {
  normalizeUsername,
  type UsernameValidationError,
  validateUsernameFormat,
} from "@/lib/users-shared";

interface Props {
  uid: string;
  initial: {
    username: string;
    fullName: string; // Google-account real name, read-only here
    affiliation: string;
    bio: string;
    affiliationPublic: boolean;
    bioPublic: boolean;
    fullNamePublic: boolean;
    emailOptIn: boolean;
    avatar: ProjectAsset | null;
    links: {
      portfolio: string;
      github: string;
      linkedin: string;
      sns: string;
    };
  };
}

// Debounce window for the live availability probe. 400ms feels
// responsive while keeping us from spamming the server on every
// keystroke; the user will pause naturally between typing a candidate
// and reading the verdict.
const USERNAME_CHECK_DEBOUNCE_MS = 400;

export function ProfileForm({ uid, initial }: Props) {
  const t = useTranslations("ProfileForm");
  const actionErrors = useTranslations("ActionErrors");
  const imageUploadMessages = {
    missingGuideId: () => actionErrors("guideImageMissingId"),
    missingQaId: () => actionErrors("qaImageMissingId"),
    missingUserId: () => actionErrors("userMissingId"),
    unsupportedType: (types: string) => actionErrors("imageType", { types }),
    tooLarge: (size: number) => actionErrors("imageTooLarge", { size }),
  };
  const [username, setUsername] = useState(initial.username);
  const [affiliation, setAffiliation] = useState(initial.affiliation);
  const [bio, setBio] = useState(initial.bio);
  const [affiliationPublic, setAffiliationPublic] = useState(
    initial.affiliationPublic,
  );
  const [bioPublic, setBioPublic] = useState(initial.bioPublic);
  const [fullNamePublic, setFullNamePublic] = useState(initial.fullNamePublic);
  const [emailOptIn, setEmailOptIn] = useState(initial.emailOptIn);
  const [portfolio, setPortfolio] = useState(initial.links.portfolio);
  const [github, setGithub] = useState(initial.links.github);
  const [linkedin, setLinkedin] = useState(initial.links.linkedin);
  const [sns, setSns] = useState(initial.links.sns);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  // Avatar is saved immediately on pick/remove through its own Server
  // Actions, independent of the form's Save button — it must NOT ride the
  // username-reservation transaction (a pending handle change shouldn't
  // block changing your icon, and vice versa). `avatarBusy` spans both the
  // Storage upload and the follow-up persist so the controls disable as a
  // single unit.
  const [avatar, setAvatar] = useState<ProjectAsset | null>(initial.avatar);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarDeleteDialogOpen, setAvatarDeleteDialogOpen] = useState(false);

  // Derived synchronously from the current input — these don't need an
  // effect because they're a pure function of `username` (and the
  // initial handle, which is constant for the form's lifetime).
  //
  // `isCurrentHandle` is intentionally computed BEFORE (and
  // independently of) the format check so a grandfathered handle in a
  // reserved namespace (e.g. someone who claimed `user-foo` before
  // the prefix rule landed in PR #94) doesn't get rejected on every
  // re-render of their own profile. The format error is reported only
  // when the user is actually trying to *change* the handle. Per
  // PR #94 Copilot review.
  const usernameNorm = normalizeUsername(username);
  const isCurrentHandle = usernameNorm === normalizeUsername(initial.username);
  const formatErr = validateUsernameFormat(usernameNorm);

  // Async-only state: the server's verdict tagged with the input it was
  // probed for. Storing the input alongside the verdict means a stale
  // result for a previous candidate is just *ignored* by the derived
  // `availability` below (since `serverProbe.for !== usernameNorm`)
  // rather than requiring a synchronous setState-in-effect to clear it.
  // That keeps the effect body free of sync state mutations — the lint
  // rule (and React's docs) flag those as cascading renders.
  const [serverProbe, setServerProbe] = useState<{
    for: string;
    status: "available" | "taken";
  } | null>(null);

  // Debounced live availability probe. Cancellation guards against
  // stale verdicts; the setState calls only happen inside the
  // setTimeout callback (after the effect body has returned), so the
  // rule against synchronous-in-effect state updates is satisfied.
  useEffect(() => {
    if (formatErr || isCurrentHandle) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const result = await checkUsernameAvailable(usernameNorm);
        if (cancelled) return;
        if (result.status === "available" || result.status === "taken") {
          setServerProbe({ for: usernameNorm, status: result.status });
        }
        // "invalid" / "yours" from the server are already handled
        // synchronously by the derived state — drop them.
      } catch {
        // Network blip — leave serverProbe alone so the derived
        // verdict surfaces as "still probing" until the next attempt.
        // The transaction in updateMyProfile is the authoritative
        // last word regardless.
      }
    }, USERNAME_CHECK_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [usernameNorm, formatErr, isCurrentHandle]);

  // Compose verdicts in priority order: client-side invalid > current
  // handle > async result for THIS input > still probing. A stale
  // verdict for a previous candidate falls through the `for` check
  // and shows up as "probing" again, which matches user expectation
  // when they keep editing.
  const probeMatchesCurrent = serverProbe?.for === usernameNorm;
  // Resolution order matters: `isCurrentHandle` wins over `formatErr`
  // so a grandfathered reserved handle (e.g. legacy `user-*`) reads as
  // "yours" instead of "invalid" when the user is keeping it
  // unchanged. The server enforces the same grandfather rule in
  // `updateMyProfile` so the form's optimism here matches what the
  // submit path will accept.
  const availability: UsernameAvailability | null = isCurrentHandle
    ? { status: "yours" }
    : formatErr
      ? { status: "invalid", reason: usernameErrorMessage(formatErr, t) }
      : probeMatchesCurrent
        ? { status: serverProbe!.status }
        : null;
  const probing = !isCurrentHandle && !formatErr && !probeMatchesCurrent;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateMyProfile({
          username,
          affiliation,
          bio,
          affiliationPublic,
          bioPublic,
          fullNamePublic,
          emailOptIn,
          links: { portfolio, github, linkedin, sns },
        });
        if (result.ok) {
          setSavedAt(Date.now());
        } else {
          setError(result.error);
        }
      } catch (err) {
        // Server-Action `redirect()` (and `notFound()`) signal
        // navigation by throwing an internal Next.js error — let those
        // propagate; surface anything else as a real save failure.
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : t("saveFailed"));
      }
    });
  }

  async function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    setAvatarError(null);
    const file = e.target.files?.[0];
    // Reset the input so picking the SAME file again still fires onChange.
    e.target.value = "";
    if (!file) return;
    setAvatarBusy(true);
    try {
      // Upload to Storage first (client → `users/{uid}/...`), then persist
      // the resulting {path, url} via the Server Action, which also sweeps
      // the previous object. Two awaits, one spinner.
      const asset = await uploadUserAvatar(uid, file, imageUploadMessages);
      const result = await updateMyAvatar(asset);
      if (result.ok) {
        setAvatar(asset);
      } else {
        setAvatarError(result.error);
        // Persisting failed after the upload already landed — delete the
        // just-uploaded object so it doesn't orphan in the bucket. Best-
        // effort; a leaked object is harmless next to surfacing the error.
        void deleteUserAvatarObject(asset.path).catch((cleanupErr) => {
          console.error("Failed to clean up orphaned avatar:", cleanupErr);
        });
      }
    } catch (err) {
      setAvatarError(
        err instanceof Error ? err.message : t("uploadFailed"),
      );
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleAvatarRemove() {
    setAvatarError(null);
    setAvatarBusy(true);
    try {
      const result = await removeMyAvatar();
      if (result.ok) {
        setAvatarDeleteDialogOpen(false);
        setAvatar(null);
      } else {
        setAvatarDeleteDialogOpen(false);
        setAvatarError(result.error);
      }
    } catch (err) {
      setAvatarDeleteDialogOpen(false);
      setAvatarError(err instanceof Error ? err.message : t("deleteFailed"));
    } finally {
      setAvatarBusy(false);
    }
  }

  // Initials fallback for the avatar preview — same surrogate-safe
  // `[...str][0]` handling as AuthorBadge and the /u/[uid] page. Tracks the
  // live username field so the placeholder matches what the user is typing.
  const avatarInitial = ([...username][0] ?? "?").toUpperCase();

  const submitBlocked =
    pending ||
    probing ||
    !availability ||
    availability.status === "taken" ||
    availability.status === "invalid";

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-zinc-200 bg-white p-5 space-y-6 dark:border-zinc-800 dark:bg-zinc-900"
      >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          {t("title")}
        </h2>
        <Link
          href={`/u/${uid}`}
          className="text-xs text-blue-600 hover:underline"
        >
          {t("viewPublic")}
        </Link>
      </div>

      {/* Avatar: upload / preview / remove. Saved immediately via its own
          Server Actions (handleAvatarPick / handleAvatarRemove), separate
          from the form's Save button below. */}
      <div className="space-y-2">
        <p className="block text-sm font-medium">{t("icon")}</p>
        <div className="flex items-center gap-4">
          {avatar ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={avatar.url}
              alt={t("currentIconAlt")}
              className="h-16 w-16 shrink-0 rounded-full border border-zinc-200 object-cover dark:border-zinc-800"
            />
          ) : (
            <span
              aria-hidden
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 text-lg font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {avatarInitial}
            </span>
          )}
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <label
                className={`cursor-pointer rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 focus-within:ring-2 focus-within:ring-zinc-500 focus-within:ring-offset-2 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:focus-within:ring-offset-zinc-900 ${
                  avatarBusy || pending
                    ? "pointer-events-none opacity-50"
                    : ""
                }`}
              >
                {/* sr-only (not hidden) keeps the input in the tab order so
                    keyboard / screen-reader users can reach it; the visible
                    focus ring rides on the parent label via focus-within. */}
                <input
                  type="file"
                  accept={GUIDE_IMAGE_ACCEPT}
                  disabled={avatarBusy || pending}
                  onChange={handleAvatarPick}
                  className="sr-only"
                />
                {avatar ? t("changeImage") : t("uploadImage")}
              </label>
              {avatar && (
                <button
                  type="button"
                  onClick={() => setAvatarDeleteDialogOpen(true)}
                  disabled={avatarBusy || pending}
                  className="text-xs text-red-600 hover:underline disabled:opacity-50"
                >
                  {t("delete")}
                </button>
              )}
            </div>
            <p className="text-xs text-zinc-500">
              {avatarBusy
                ? t("processing")
                : t("avatarHint", { types: GUIDE_IMAGE_LABEL })}
            </p>
            {avatarError && (
              <p className="text-xs text-red-600">{avatarError}</p>
            )}
          </div>
        </div>
      </div>

      {/* Username: unique handle + live availability check */}
      <div className="space-y-2">
        <label
          htmlFor="profile-username"
          className="block text-sm font-medium"
        >
          {t("username")}
        </label>
        <div className="flex items-stretch overflow-hidden rounded border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950">
          <span className="flex items-center bg-zinc-50 px-3 text-sm text-zinc-500 dark:bg-zinc-900">
            @
          </span>
          <input
            id="profile-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={20}
            autoComplete="off"
            spellCheck={false}
            className="w-full px-2 py-2 text-sm focus:outline-none bg-transparent"
          />
        </div>
        <UsernameAvailabilityHint
          probing={probing}
          availability={availability}
        />
        <p className="text-xs text-zinc-500">{t("usernameHelp")}</p>
      </div>

      {/* Full name (Google) — display + per-field publish toggle */}
      <div className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <p className="text-sm font-medium">
          {t("fullName")}
        </p>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          {initial.fullName || t("notSet")}
        </p>
        <label className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={fullNamePublic}
            onChange={(e) => setFullNamePublic(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            {t("fullNamePublic")}
            <span className="mt-0.5 block text-xs text-zinc-500">
              {t("fullNameHint")}
            </span>
          </span>
        </label>
      </div>

      {/* Affiliation: text + per-field publish toggle */}
      <div className="space-y-2">
        <label
          htmlFor="profile-affiliation"
          className="block text-sm font-medium"
        >
          {t("affiliation")}
        </label>
        <input
          id="profile-affiliation"
          type="text"
          maxLength={200}
          value={affiliation}
          onChange={(e) => setAffiliation(e.target.value)}
          placeholder={t("affiliationPlaceholder")}
          className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
        <label className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={affiliationPublic}
            onChange={(e) => setAffiliationPublic(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            {t("affiliationPublic")}
            <span className="mt-0.5 block text-xs text-zinc-500">
              {t("affiliationHint")}
            </span>
          </span>
        </label>
      </div>

      {/* Bio: textarea + per-field publish toggle */}
      <div className="space-y-2">
        <label htmlFor="profile-bio" className="block text-sm font-medium">
          {t("bio")}
        </label>
        <textarea
          id="profile-bio"
          rows={5}
          maxLength={1000}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder={t("bioPlaceholder")}
          className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={bioPublic}
              onChange={(e) => setBioPublic(e.target.checked)}
              className="mt-0.5"
            />
            <span>{t("bioPublic")}</span>
          </label>
          <span className="text-xs text-zinc-500">{bio.length} / 1000</span>
        </div>
      </div>

      {/* External links — always public when set. Empty = removed. */}
      <fieldset className="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <legend className="text-sm font-medium">
          {t("links")}
          <span className="ml-2 text-xs font-normal text-zinc-500">
            {t("linksHint")}
          </span>
        </legend>
        <LinkInput
          id="profile-link-portfolio"
          label={t("portfolio")}
          placeholder="https://your-portfolio.example.com"
          value={portfolio}
          onChange={setPortfolio}
        />
        <LinkInput
          id="profile-link-github"
          label="GitHub"
          placeholder="https://github.com/your-handle"
          value={github}
          onChange={setGithub}
        />
        <LinkInput
          id="profile-link-linkedin"
          label="LinkedIn"
          placeholder="https://www.linkedin.com/in/your-handle"
          value={linkedin}
          onChange={setLinkedin}
        />
        <LinkInput
          id="profile-link-sns"
          label="SNS"
          placeholder={t("snsPlaceholder")}
          value={sns}
          onChange={setSns}
        />
      </fieldset>

      {/* Notifications */}
      <div className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <p className="text-sm font-medium">{t("notifications")}</p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={emailOptIn}
            onChange={(e) => setEmailOptIn(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            {t("emailOptIn")}
            <span className="mt-0.5 block text-xs text-zinc-500">
              {t("emailOptInHint")}
            </span>
          </span>
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitBlocked}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? t("saving") : t("save")}
        </button>
        <SaveFlash savedAt={savedAt} message={t("saved")} />
      </div>
      </form>
      <DeleteConfirmationDialog
        open={avatarDeleteDialogOpen}
        title={t("deleteConfirm")}
        description={t("deleteDescription")}
        pending={avatarBusy}
        onCancel={() => setAvatarDeleteDialogOpen(false)}
        onConfirm={handleAvatarRemove}
      />
    </>
  );
}

// ---------- inline subcomponents ----------

function LinkInput({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
      >
        {label}
      </label>
      <input
        id={id}
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        maxLength={500}
        className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />
    </div>
  );
}

function UsernameAvailabilityHint({
  probing,
  availability,
}: {
  probing: boolean;
  availability: UsernameAvailability | null;
}) {
  const t = useTranslations("ProfileForm");
  if (probing) {
    return (
      <p className="text-xs text-zinc-500" aria-live="polite">
        {t("checking")}
      </p>
    );
  }
  if (!availability) return null;
  switch (availability.status) {
    case "available":
      return (
        <p className="text-xs text-emerald-700 dark:text-emerald-400" aria-live="polite">
          {t("available")}
        </p>
      );
    case "yours":
      return (
        <p className="text-xs text-zinc-500" aria-live="polite">
          {t("yours")}
        </p>
      );
    case "taken":
      return (
        <p className="text-xs text-red-600" aria-live="polite">
          {t("taken")}
        </p>
      );
    case "invalid":
      return (
        <p className="text-xs text-red-600" aria-live="polite">
          {availability.reason}
        </p>
      );
  }
}

function usernameErrorMessage(
  err: UsernameValidationError,
  t: (key: string) => string,
): string {
  switch (err) {
    case "empty":
      return t("usernameEmpty");
    case "format":
      return t("usernameHelp");
    case "reserved":
      return t("usernameReserved");
  }
}
