import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PresentationSection } from "@/app/events/[slug]/PresentationSection";
import { RsvpSection } from "@/app/events/[slug]/RsvpSection";
import { getSessionUser } from "@/lib/auth/session";
import { getEventBySlug } from "@/lib/data/events";
import { listPresentations } from "@/lib/data/presentations";
import { getMyRsvp } from "@/lib/data/rsvps";
import { getMyProfile } from "@/lib/data/users";
import { formatDateTime, isEventEnded } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  const user = await getSessionUser();
  // Members-only events redirect anonymous visitors to login. Admins always
  // pass; the firestore.rules backstop already enforces the same boundary.
  if (event.visibility === "members_only" && !user) {
    redirect(`/login?redirect=/events/${slug}`);
  }
  // Profile load is parallel with RSVP/presentations so it doesn't add
  // latency on the warm path. Only needed to pre-fill the affiliation
  // field on first-time RSVP — once the user has an existing RSVP doc,
  // RsvpSection prefers that value (it's the most recent confirmation
  // of what they want associated with this specific event).
  const [myRsvp, presentations, profile] = await Promise.all([
    user ? getMyRsvp(event.id, user.uid) : Promise.resolve(null),
    listPresentations(event.id).catch(() => []),
    user ? getMyProfile(user.uid).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      {event.coverImage?.url && (
        // aspect-[21/9] keeps the hero a cinematic-ish banner regardless of
        // the source aspect ratio — without this, a portrait upload would
        // push the title way below the fold.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={event.coverImage.url}
          alt={`${event.title} のカバー画像`}
          className="aspect-[21/9] w-full rounded-lg border border-zinc-200 object-cover dark:border-zinc-800"
        />
      )}

      <header className="space-y-3">
        <p className="text-sm text-zinc-500">{formatDateTime(event.startAt)}</p>
        <h1 className="text-3xl font-bold tracking-tight">
          {event.title}
          {event.visibility === "members_only" && (
            <span className="ml-3 align-middle rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              メンバー限定
            </span>
          )}
        </h1>
        <dl className="grid grid-cols-1 gap-2 text-sm text-zinc-600 dark:text-zinc-400 sm:grid-cols-2">
          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">開始</dt>
            <dd>{formatDateTime(event.startAt)}</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">終了</dt>
            <dd>{formatDateTime(event.endAt)}</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">形式</dt>
            <dd>
              {event.location.type === "online"
                ? "オンライン"
                : event.location.type === "hybrid"
                  ? "ハイブリッド"
                  : "オフライン"}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">定員</dt>
            <dd>
              {event.rsvpCount} / {event.capacity || "—"}
            </dd>
          </div>
          {event.location.address && (
            <div className="sm:col-span-2">
              <dt className="font-medium text-zinc-800 dark:text-zinc-200">会場</dt>
              <dd>
                {event.location.address}
                {event.location.mapUrl && (
                  <>
                    {" "}
                    <a
                      href={event.location.mapUrl}
                      className="text-blue-600 hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      地図
                    </a>
                  </>
                )}
              </dd>
            </div>
          )}
        </dl>
      </header>

      {/* Plain-text description (not Markdown) — `whitespace-pre-wrap` preserves
          author-entered newlines, `break-words` handles long URLs/tokens. The
          `prose-jtpa` styles are Markdown-specific and would not help here. */}
      <section className="whitespace-pre-wrap break-words leading-relaxed">
        {event.description}
      </section>

      <hr className="border-zinc-200 dark:border-zinc-800" />

      {isEventEnded(event) ? (
        // Past events show a static notice instead of the RSVP form. The
        // presentation list below is intentionally still rendered — slides
        // remain useful after the fact.
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-6 text-center text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-zinc-700 dark:text-zinc-300">
            {event.status === "cancelled"
              ? "このイベントは中止されました。"
              : "このイベントは終了しました。"}
          </p>
        </div>
      ) : user ? (
        <RsvpSection
          event={event}
          initialRsvp={myRsvp}
          user={user}
          profileAffiliation={profile?.affiliation ?? ""}
        />
      ) : (
        <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-zinc-700 dark:text-zinc-300 mb-3">
            参加登録にはログインが必要です。
          </p>
          <Link
            href={`/login?redirect=${encodeURIComponent(`/events/${event.slug}`)}`}
            className="inline-flex rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Googleでログイン
          </Link>
        </div>
      )}

      <PresentationSection
        eventId={event.id}
        eventSlug={event.slug}
        user={user}
        myRsvp={myRsvp}
        initialPresentations={presentations}
      />
    </div>
  );
}
