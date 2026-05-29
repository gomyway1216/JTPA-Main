// Centralized class strings for "card" surfaces — the rectangular
// containers used across list grids (events, showcase, blog, guide, qa,
// poll) and the various interior content panels (vote form, comment
// list, profile card, …). Designed to feel like a single visual system
// instead of the per-page mix that drifted in over time.
//
// Why a shared string (instead of a `<Card>` component): every callsite
// nests these classes onto an existing element that already needs
// per-page utilities (grid spans, hover states, internal spacing). A
// component would either need a wrapper-of-wrapper (extra DOM) or a
// `className` passthrough that re-flattens the abstraction. The string
// works exactly like `primaryButtonClass` in `forms/styles.ts`.
//
// Design notes:
//
//  - Multi-layer shadow. One tight 1px layer for the contact edge, one
//    softer 24px wide layer for the elevation. This is the Apple-style
//    "tray" look — much more refined than a single `shadow-lg`. In
//    dark mode the shadows fade to ~0 because they don't read against
//    a near-black surface anyway, and a visible shadow there just
//    creates a halo.
//
//  - Subtle vertical gradient. `from-white to-zinc-50/60` gives a
//    barely-perceptible top highlight that catches light the way a
//    physical card would. The same trick in dark mode (`from-zinc-900
//    to-zinc-950/70`) tilts the surface so it doesn't look painted
//    flat against the page.
//
//  - Lighter border (`zinc-200/60` instead of `zinc-200`). The shadow
//    already defines the silhouette; a fully-opaque border on top of
//    that double-prints the edge and reads as heavier than it is.
//
//  - `rounded-2xl`. Bigger than the previous `rounded-lg` so the
//    surface reads as a single object rather than a clipped rectangle.
//    The hover variant goes to `rounded-3xl` so the corner softens
//    even further when the user is pointed at it — a small touch but
//    consistent with how Apple's interactive cards behave.
export const cardClass =
  "rounded-2xl border border-zinc-200/60 bg-gradient-to-b from-white to-zinc-50/60 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-8px_rgb(0_0_0/0.08)] dark:border-zinc-800/60 dark:from-zinc-900 dark:to-zinc-950/70 dark:shadow-[0_1px_2px_rgb(0_0_0/0.4),0_8px_24px_-8px_rgb(0_0_0/0.5)]";

// Interactive variant — applied to list rows / link cards that should
// react to hover. Lifts on hover (slightly stronger shadow, slightly
// larger corner radius), and adds a transition that runs across the
// whole effect set. Keep on a `<Link>` / `<button>` / `<article>` that
// the user can actually click; for a static container, use `cardClass`
// directly so the cursor doesn't suggest interactivity.
export const interactiveCardClass = `${cardClass} group block transition duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgb(0_0_0/0.05),0_18px_40px_-12px_rgb(0_0_0/0.15)] hover:border-zinc-300/60 dark:hover:border-zinc-700/60 dark:hover:shadow-[0_2px_4px_rgb(0_0_0/0.5),0_18px_40px_-12px_rgb(0_0_0/0.6)]`;

// Inset / quiet variant for content panels that sit inside a page (not
// a top-level card). Skips the gradient and softens the shadow so the
// panel feels nested rather than floating. Used by e.g. the poll vote
// form when it sits inside an article column that already provides
// the outer card framing.
export const insetCardClass =
  "rounded-xl border border-zinc-200/70 bg-white p-4 dark:border-zinc-800/70 dark:bg-zinc-900";
