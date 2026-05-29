"use client";

import { createElement, useEffect, useState, type ReactNode } from "react";

// Restrict the `as` prop to the small set of structural tags we
// actually use. Keeping the union tight sidesteps TS's "union too
// complex" error from using `keyof JSX.IntrinsicElements`, and is
// more honest about intent — `FadeUp` is for layout shells, not a
// general-purpose element factory.
type WrapperTag = "div" | "section" | "li" | "article" | "ul" | "ol";

interface Props {
  children: ReactNode;
  // Stagger this child relative to its siblings — caller passes the index
  // and we translate it into a delay (75ms per step, capped at ~9 steps
  // so a long list doesn't pause forever before the bottom item shows).
  // Optional: when omitted the child fades in with no delay.
  delay?: number;
  // Custom translate distance. Bigger values look more dramatic for
  // hero-adjacent sections, smaller for list items. Defaults to 16px.
  distance?: number;
  // Tailwind class override hook — most callers pass nothing.
  className?: string;
  // Render as a different element. Defaults to <div>; pass "li" inside a
  // list, "section" for top-level page chunks. Keeps the markup
  // semantic without the consumer needing to wrap our wrapper.
  as?: WrapperTag;
}

// Scroll-triggered fade-up animation. The child mounts hidden + nudged
// down a few pixels, and the IntersectionObserver flips it to opacity:1
// + translate:0 the first time it enters the viewport. After the
// transition lands we tear down the observer — there's no point
// re-observing a node we never want to re-animate, and keeping
// observers around for a page full of cards is wasted work.
//
// The motion is deliberately small (no spring, no parallax) so it reads
// as "this section just settled into place" rather than a flashy
// reveal. That tone matches what the rest of the visual system is
// trying to do.
//
// SSR / prefers-reduced-motion behavior:
//   - Server renders the hidden state. On hydration we read
//     `matchMedia('(prefers-reduced-motion: reduce)')` and immediately
//     mark the node visible (no animation) if the user opted out.
//   - On the first paint after hydration the IntersectionObserver
//     catches the in-viewport elements and animates them in. Anything
//     already past the fold animates as the user scrolls.
//   - There is no JS-disabled fallback — without JS the children stay
//     hidden. Acceptable trade-off; the rest of the app needs JS too.
export function FadeUp({
  children,
  delay = 0,
  distance = 16,
  className = "",
  as,
}: Props) {
  // Use a callback-ref via useState instead of `useRef` so the effect's
  // dependency on the actual node is explicit — when the callback ref
  // fires (the DOM node attaches), state updates, the effect re-runs,
  // and the observer attaches to the right node. Also sidesteps the
  // lint rule that flags `ref.current` access patterns in render.
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Respect the OS-level reduced-motion preference. Skip the animation
    // entirely and mount in the final state. The matchMedia query is
    // safe here because this hook only runs after hydration.
    //
    // `requestAnimationFrame` defers the setVisible() call out of the
    // effect-flush phase so the React-hooks "no synchronous setState in
    // effect" lint stays happy. Functionally equivalent: the next
    // paint immediately latches the new state.
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReducedMotion) {
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }

    if (!node) return;

    // 10% threshold gives a small "approach" margin so the card starts
    // animating just before it's fully in the viewport — feels more
    // natural than waiting until the entire element has scrolled in.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  // 75ms per step, max ~675ms — enough stagger to feel rhythmic on a
  // 6-column grid without making the last card visibly lag.
  const staggerMs = Math.min(delay * 75, 675);
  const style: React.CSSProperties = {
    transitionDelay: visible ? `${staggerMs}ms` : "0ms",
    transform: visible ? "translateY(0)" : `translateY(${distance}px)`,
    opacity: visible ? 1 : 0,
    transition: "opacity 600ms ease-out, transform 600ms ease-out",
    // `will-change` opts the node into a compositor layer so the
    // transition doesn't repaint the surrounding content. We strip it
    // once the animation lands to avoid permanently retaining the
    // layer (which costs memory + can blur subpixel text rendering).
    willChange: visible ? undefined : "opacity, transform",
  };

  // Use `createElement` rather than `<Tag>` JSX. The JSX path makes TS
  // try to type-check the props against every member of the tag union
  // simultaneously, which explodes into TS2590 "union too complex".
  // createElement takes its props as `any` so the same call works for
  // every tag in our small WrapperTag set without that explosion.
  return createElement(
    as ?? "div",
    { ref: setNode, className, style },
    children,
  );
}
