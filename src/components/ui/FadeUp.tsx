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

// Scroll-triggered fade-up animation. Mounts each child hidden + nudged
// down a few pixels, then IntersectionObserver flips it to opacity:1 +
// translate:0 the first time it enters the viewport. Once the
// transition lands we wipe ALL inline styles and tear down the
// observer — so the host element's class-based hover transitions
// (e.g. the `interactiveCardClass` lift) work uninterrupted afterwards,
// no compositor layer is retained, and the transform doesn't shadow
// hover-translate utilities.
//
// The motion is deliberately small (no spring, no parallax) so it reads
// as "this section just settled into place" rather than a flashy
// reveal — tone-matched with the rest of the visual system.
//
// Behavior matrix:
//
//   prefers-reduced-motion: reduce  → no animation, render in final
//   state, no inline transition (so the OS preference is fully honored,
//   not just "the start state was skipped"). Per PR #89 Gemini + Copilot
//   reviews — the earlier version still ran the 600ms transition.
//
//   No IntersectionObserver (SSR test envs, very old browsers)  → same
//   path as reduced-motion. Without this guard the test environment's
//   `new IntersectionObserver(...)` throws and crashes every page that
//   renders any list under FadeUp.
//
//   Normal case  → start hidden + translated, animate to visible on
//   intersection, then `onTransitionEnd` wipes the inline styles so
//   the consumer's hover-translate-y and shadow transitions take over
//   cleanly. While invisible the subtree is `aria-hidden` + has
//   `pointer-events: none` so keyboard focus doesn't land on a card
//   the reader can't see.
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
  // True once we either (a) finished the transition or (b) decided not
  // to animate at all (reduced-motion / no-IO). In either case we
  // render with no inline animation styles, so the consumer's hover
  // utilities own the element's transform/transition/opacity afterwards.
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    // Two "skip the animation" paths land in the same final state. Both
    // are checked here rather than in the render body so the matchMedia
    // / `typeof IntersectionObserver` reads only happen client-side
    // (matchMedia is undefined on the server and would throw during SSR
    // serialization). `requestAnimationFrame` defers the state flush
    // out of the effect commit, which keeps the React-hooks "no sync
    // setState in effect" lint quiet.
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const noObserver = typeof IntersectionObserver === "undefined";
    if (prefersReducedMotion || noObserver) {
      const id = requestAnimationFrame(() => {
        setVisible(true);
        setSettled(true);
      });
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

  // Settled: drop the entire inline-style object so nothing — no
  // transform, no transition, no opacity, no will-change — competes
  // with the host element's class-based hover transitions. That's the
  // fix the reviewers (Gemini + Copilot) flagged: the earlier version
  // kept `transform: translateY(0)` and the 600ms `transition` shorthand
  // pinned on the element forever, which shadowed `hover:-translate-y-0.5`
  // and `transition duration-200 ease-out` from `interactiveCardClass`.
  const style: React.CSSProperties = settled
    ? {}
    : {
        transitionProperty: "opacity, transform",
        transitionDuration: "600ms",
        transitionTimingFunction: "ease-out",
        transitionDelay: visible ? `${staggerMs}ms` : "0ms",
        transform: visible ? "translateY(0)" : `translateY(${distance}px)`,
        opacity: visible ? 1 : 0,
        // `will-change` opts the node into a compositor layer so the
        // transition doesn't repaint the surrounding content. The
        // earlier impl stripped this at the moment `visible` became
        // true — i.e. when the transition was about to START. We now
        // strip it (along with everything else) only after
        // `onTransitionEnd` fires, which is when the layer is actually
        // safe to free.
        willChange: "opacity, transform",
        // Keep the subtree non-interactive while it's invisible — avoids
        // keyboard focus landing on an opacity-0 card the user can't
        // see, and matches the visual state with the input semantics.
        pointerEvents: visible ? undefined : "none",
      };

  // `onTransitionEnd` fires once per transitioning property (opacity AND
  // transform here), so we guard on the originating element to ignore
  // bubbled events from children with their own transitions. After the
  // last of our properties lands, set `settled` and the next render
  // drops every inline style — restoring the consumer's hover behavior.
  function onTransitionEnd(e: React.TransitionEvent) {
    if (e.target !== e.currentTarget) return;
    setSettled(true);
  }

  // Use `createElement` rather than `<Tag>` JSX. The JSX path makes TS
  // try to type-check the props against every member of the tag union
  // simultaneously, which explodes into TS2590 "union too complex".
  // createElement takes its props as `any` so the same call works for
  // every tag in our small WrapperTag set without that explosion.
  return createElement(
    as ?? "div",
    {
      ref: setNode,
      className,
      style,
      onTransitionEnd: settled ? undefined : onTransitionEnd,
      "aria-hidden": !visible ? true : undefined,
    },
    children,
  );
}
