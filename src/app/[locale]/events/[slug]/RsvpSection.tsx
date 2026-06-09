"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { cancelRsvp, submitRsvp } from "@/app/actions/rsvps";
import type { EventDoc, RsvpDoc, SessionUser } from "@/lib/types";

export function RsvpSection({
  event,
  initialRsvp,
  user,
  profileAffiliation = "",
}: {
  event: EventDoc;
  initialRsvp: RsvpDoc | null;
  user: SessionUser;
  // Profile-level affiliation from /my/profile. Used to pre-fill the
  // affiliation field on first-time RSVP only — once an RSVP exists,
  // its own value wins (the user may have intentionally typed a
  // different one for this specific event).
  profileAffiliation?: string;
}) {
  const t = useTranslations("Rsvp");
  const [rsvp, setRsvp] = useState<RsvpDoc | null>(initialRsvp);
  const [role, setRole] = useState<"attendee" | "presenter">(
    initialRsvp?.role ?? "attendee",
  );
  const [responses, setResponses] = useState<Record<string, string>>(
    () => mapInitial(initialRsvp),
  );
  const [presentationTitle, setPresentationTitle] = useState(
    initialRsvp?.presentationTitle ?? "",
  );
  const [presentationAbstract, setPresentationAbstract] = useState(
    initialRsvp?.presentationAbstract ?? "",
  );
  const [affiliation, setAffiliation] = useState(
    // Only fall back to the profile-level value on a TRULY new RSVP
    // (initialRsvp === null). If the user has an existing RSVP doc but
    // intentionally cleared the affiliation, `?? profileAffiliation`
    // would silently revert their edit — per PR #57 Gemini review.
    initialRsvp ? (initialRsvp.affiliation ?? "") : profileAffiliation,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const presenterFields = event.surveyFields.filter(
    (f) => f.audience === "presenter",
  );
  const allFields = event.surveyFields.filter((f) => f.audience === "all");
  const checkedIn = !!rsvp?.attendedAt && rsvp.status !== "cancelled";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await submitRsvp({
          eventId: event.id,
          role,
          affiliation,
          surveyResponses: responses,
          presentationTitle: role === "presenter" ? presentationTitle : undefined,
          presentationAbstract:
            role === "presenter" ? presentationAbstract : undefined,
        });
        if (result.ok) setRsvp(result.rsvp);
        else setError(result.error);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("submitError"));
      }
    });
  }

  async function handleCancel() {
    setError(null);
    if (!confirm(t("cancelConfirm"))) return;
    startTransition(async () => {
      try {
        const result = await cancelRsvp({ eventId: event.id });
        if (result.ok) setRsvp(null);
        else setError(result.error);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("cancelError"));
      }
    });
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-xl font-semibold mb-4">{t("title")}</h2>

      {rsvp && rsvp.status !== "cancelled" && (
        <div className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
          {checkedIn
            ? t("checkedInRegistered")
            : rsvp.status === "waitlist"
              ? t("waitlist")
              : t("registered", {
                  role:
                    rsvp.role === "presenter"
                      ? t("presenter")
                      : t("attendee"),
                })}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-sm font-medium">{t("roleLabel")}</label>
          <div className="mt-1 flex gap-3">
            <label className="inline-flex items-center gap-1 text-sm">
              <input
                type="radio"
                name="role"
                value="attendee"
                checked={role === "attendee"}
                onChange={() => setRole("attendee")}
              />
              {t("attendeeRole")}
            </label>
            <label className="inline-flex items-center gap-1 text-sm">
              <input
                type="radio"
                name="role"
                value="presenter"
                checked={role === "presenter"}
                onChange={() => setRole("presenter")}
              />
              {t("presenterRole")}
            </label>
          </div>
        </div>

        <Field label={t("name")}>
          <input
            type="text"
            value={user.displayName}
            disabled
            className="w-full rounded border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </Field>

        <Field label={t("affiliation")}>
          <input
            type="text"
            value={affiliation}
            onChange={(e) => setAffiliation(e.target.value)}
            placeholder={t("affiliationPlaceholder")}
            className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </Field>

        {allFields.map((f) => (
          <SurveyInput
            key={f.key}
            field={f}
            value={responses[f.key] ?? ""}
            onChange={(v) =>
              setResponses((r) => ({ ...r, [f.key]: v }))
            }
          />
        ))}

        {role === "presenter" && (
          <div className="space-y-4 rounded-md bg-zinc-50 p-4 dark:bg-zinc-800/50">
            <p className="text-sm font-medium">{t("presenterInfo")}</p>
            <Field label={t("presentationTitle")} required>
              <input
                type="text"
                required
                value={presentationTitle}
                onChange={(e) => setPresentationTitle(e.target.value)}
                className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </Field>
            <Field label={t("presentationAbstract")} required>
              <textarea
                required
                rows={4}
                value={presentationAbstract}
                onChange={(e) => setPresentationAbstract(e.target.value)}
                className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </Field>
            {presenterFields.map((f) => (
              <SurveyInput
                key={f.key}
                field={f}
                value={responses[f.key] ?? ""}
                onChange={(v) =>
                  setResponses((r) => ({ ...r, [f.key]: v }))
                }
              />
            ))}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {pending ? t("submitting") : rsvp ? t("update") : t("submit")}
          </button>
          {rsvp && rsvp.status !== "cancelled" && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={pending}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {t("cancel")}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function SurveyInput({
  field,
  value,
  onChange,
}: {
  field: import("@/lib/types").SurveyField;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTranslations("Rsvp");
  return (
    <Field label={field.label} required={field.required}>
      {field.type === "textarea" ? (
        <textarea
          required={field.required}
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
      ) : field.type === "select" ? (
        <select
          required={field.required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        >
          <option value="">{t("choose")}</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : field.type === "checkbox" ? (
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value === "true"}
            onChange={(e) => onChange(e.target.checked ? "true" : "false")}
          />
          {field.label}
        </label>
      ) : (
        <input
          type="text"
          required={field.required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
      )}
    </Field>
  );
}

function mapInitial(rsvp: RsvpDoc | null): Record<string, string> {
  if (!rsvp) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rsvp.surveyResponses ?? {})) {
    out[k] = typeof v === "boolean" ? String(v) : Array.isArray(v) ? v.join(",") : v;
  }
  return out;
}
