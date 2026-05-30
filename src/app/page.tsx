import Link from "next/link";

import { EmptyState } from "@/components/ui/EmptyState";
import { FadeUp } from "@/components/ui/FadeUp";
import { interactiveCardClass } from "@/components/ui/surface";
import { listEvents } from "@/lib/data/events";
import { listProjects } from "@/lib/data/projects";
import type { LocationType } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [events, projects] = await Promise.all([
    listEvents({ limit: 3, notEndedOnly: true }).catch(() => []),
    listProjects({ limit: 6 }).catch(() => []),
  ]);

  return (
    <div className="space-y-24 pb-20 sm:space-y-32 sm:pb-24">
      {/* Hero is full-bleed so the decorative blobs + dot grid can fill
          the whole viewport width. The content inside re-applies
          `mx-auto max-w-6xl` so the text and CTAs stay aligned with the
          centered card grid below.

          `min-h` is capped to a comfortable hero height on mobile (so
          short copy + 2 CTAs don't leave a giant empty rectangle below
          the buttons) and stretches to most-of-the-viewport from `sm:`
          up, where the heavier desktop type wants more breathing room. */}
      <section className="relative isolate flex min-h-[36rem] items-center overflow-hidden sm:min-h-[calc(100vh-12rem)]">
        {/*
         * Three decorative layers, all `pointer-events-none` +
         * `aria-hidden`, scoped under `isolate` so their negative
         * z-index doesn't slip behind the header:
         *   - dot grid: signals "tech" without a literal terminal
         *     pattern. Fades to transparent at the edges via a
         *     radial mask (see `.hero-dot-grid` in globals.css) so it
         *     doesn't compete with surrounding sections.
         *   - top-right + bottom-left blobs: cooler at one corner,
         *     warmer at the other for a sense of depth.
         */}
        <div
          aria-hidden="true"
          className="hero-dot-grid pointer-events-none absolute inset-0 -z-20"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-32 -z-10 h-[560px] w-[720px] max-w-full rounded-full bg-gradient-to-br from-blue-500/25 via-indigo-500/20 to-violet-500/25 blur-3xl dark:from-blue-500/35 dark:via-indigo-500/30 dark:to-violet-500/35"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 -left-24 -z-10 h-[460px] w-[600px] max-w-full rounded-full bg-gradient-to-tr from-violet-500/20 via-indigo-500/15 to-blue-500/20 blur-3xl dark:from-violet-500/30 dark:via-indigo-500/25 dark:to-blue-500/30"
        />

        <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-12 sm:gap-8 sm:py-16">
          {/* Eyebrow tag: emerald dot gets a slow ping ring so the tag
              reads as "live" rather than purely static decoration. */}
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs font-medium text-zinc-700 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Bay Area テックコミュニティ
          </span>

          {/* Display headline. `font-semibold` (not bold) + tighter
              tracking + a bigger size scale gives the type the
              "confident but quiet" weight characteristic of an Apple
              hero — bold at this size starts to feel heavy.
              `animate-gradient-shimmer` (defined in globals.css)
              slides a wider-than-text gradient across the "AI" glyphs;
              the loop is seamless because the gradient starts and ends
              on blue. `leading-[1.05]` packs the lines a touch tighter
              so the multi-line headline reads as one phrase.

              Mobile scale is `text-4xl` (36px) — the previous `text-6xl`
              (60px) overflowed at 375px and forced an unbalanced
              3-line wrap with "する" hanging on its own. At 36px the
              phrase splits naturally onto two lines after the comma,
              with no forced break required. The desktop `<br>` is
              still suppressed below `sm` for that reason. */}
          <h1 className="text-4xl font-semibold leading-[1.1] tracking-tighter sm:text-7xl sm:leading-[1.05] lg:text-8xl">
            <span className="bg-shimmer-gradient animate-gradient-shimmer bg-clip-text text-transparent">
              AI
            </span>
            で集まる、<br className="hidden sm:inline" />つくる、共有する。
          </h1>

          <p className="max-w-2xl text-lg text-zinc-600 sm:text-xl sm:leading-relaxed dark:text-zinc-300">
            JTPAは、Bay AreaのテックコミュニティでAI関連のイベント運営・知識共有を行っています。
            オンライン/オフラインのイベント、メンバーが作ったAIプロジェクトのショーケースをお楽しみください。
          </p>
          <div className="flex flex-wrap gap-3 pt-4">
            {/* Hero-only pill variant of the primary CTA — keep the
                shared `primaryButtonClass` (rounded-md) for forms but
                lean into a pill here so it matches the rounded
                secondary CTA next to it. Same gradient + hover slide
                as the shared primary, just resized for the hero. */}
            <Link
              href="/events"
              className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 bg-[length:200%_100%] bg-left px-5 py-2 text-sm font-medium text-white shadow-sm shadow-indigo-500/30 transition-all hover:bg-right hover:shadow-md hover:shadow-indigo-500/40 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-white active:scale-[0.98] dark:from-blue-500 dark:via-indigo-500 dark:to-violet-500 dark:shadow-indigo-400/20 dark:focus:ring-indigo-400 dark:focus:ring-offset-zinc-950"
            >
              イベント一覧
            </Link>
            <Link
              href="/showcase"
              className="rounded-full border border-zinc-300/70 bg-white/70 px-5 py-2 text-sm font-medium backdrop-blur transition hover:bg-white hover:shadow-sm dark:border-zinc-700/70 dark:bg-zinc-950/70 dark:hover:bg-zinc-900"
            >
              ショーケースを見る
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-20 px-4">

      <FadeUp as="section" className="space-y-6">
        {/* Section head row. On phones the "すべて見る" link slides under
            the heading so the H2 + subtitle get the full content width
            (otherwise "注目のプロジェクト" / "直近のイベント" wrap into a
            narrow column and break mid-word). From `sm:` we put the
            link back on the right rail. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-4xl">直近のイベント</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              オンラインも対面も。気になる回に気軽に参加してください。
            </p>
          </div>
          <Link
            href="/events"
            className="shrink-0 text-sm font-medium text-accent hover:underline"
          >
            すべて見る →
          </Link>
        </div>
        {events.length === 0 ? (
          <EmptyState
            message="現在公開中のイベントはありません。"
            hint="次回の告知をお楽しみに。"
          />
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((e, i) => (
              <FadeUp key={e.id} as="li" delay={i} className="flex">
                <Link
                  href={`/events/${e.slug}`}
                  className={`${interactiveCardClass} flex h-full w-full flex-col overflow-hidden`}
                >
                  {e.coverImage?.url && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={e.coverImage.url}
                      alt={`${e.title} のカバー画像`}
                      className="aspect-[16/9] w-full object-cover"
                    />
                  )}
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs uppercase tracking-wide text-zinc-500">
                        {formatDateTime(e.startAt)}
                      </p>
                      <LocationPill type={e.location?.type} />
                    </div>
                    <h3 className="mt-2 line-clamp-2 text-lg font-semibold">
                      {e.title}
                    </h3>
                    <p className="mt-2 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">
                      {e.description}
                    </p>
                  </div>
                </Link>
              </FadeUp>
            ))}
          </ul>
        )}
      </FadeUp>

      <FadeUp as="section" className="space-y-6">
        {/* Same stack-on-mobile rationale as the "直近のイベント" head
            above. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-4xl">注目のプロジェクト</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              JTPA メンバーが手がけた AI プロジェクト。
            </p>
          </div>
          <Link
            href="/showcase"
            className="shrink-0 text-sm font-medium text-accent hover:underline"
          >
            すべて見る →
          </Link>
        </div>
        {projects.length === 0 ? (
          <EmptyState
            message="掲載中のプロジェクトはありません。"
            hint={
              <>
                あなたの AI プロジェクトを{" "}
                <Link href="/projects/new" className="font-medium text-accent underline">
                  投稿
                </Link>
                してみませんか？
              </>
            }
          />
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p, i) => (
              <FadeUp key={p.id} as="li" delay={i} className="flex">
                <Link
                  href={`/showcase/${p.slug}`}
                  className={`${interactiveCardClass} flex h-full w-full flex-col overflow-hidden`}
                >
                  {p.thumbnail?.url && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={p.thumbnail.url}
                      alt={`${p.title} のサムネイル`}
                      className="aspect-[16/9] w-full object-cover"
                    />
                  )}
                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="line-clamp-2 text-lg font-semibold">{p.title}</h3>
                    <p className="mt-2 line-clamp-3 flex-1 text-sm text-zinc-600 dark:text-zinc-400">
                      {p.description}
                    </p>
                    {p.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {p.tags.slice(0, 4).map((t) => (
                          <span
                            key={t}
                            className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              </FadeUp>
            ))}
          </ul>
        )}
      </FadeUp>
      </div>
    </div>
  );
}

function LocationPill({ type }: { type?: LocationType }) {
  if (!type) return null;
  const label =
    type === "online" ? "オンライン" : type === "hybrid" ? "ハイブリッド" : "対面";
  const classes =
    type === "online"
      ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
      : type === "hybrid"
        ? "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
        : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${classes}`}
    >
      {label}
    </span>
  );
}

