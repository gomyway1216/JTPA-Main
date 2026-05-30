"use client";

import { useEffect, useState } from "react";

import { globalErrorCopy } from "@/i18n/global-error-copy";

// Last-resort error boundary. Activates only when the root layout
// itself throws — at that point `error.tsx` can't render because it
// lives INSIDE the layout that just blew up, so Next falls back to
// this file instead. Must include its own `<html>` and `<body>`
// because it fully replaces the document.
//
// Intentionally bare-bones:
//   - No `import "./globals.css"` and no shared components: anything
//     that pulled in the broken layout would re-trigger the crash. We
//     style with inline styles so the page is still legible even if
//     Tailwind hasn't loaded.
//   - The first render stays Japanese to match SSR, then switches to
//     English after mount if the browser language asks for it.
//   - Plain `<a>` (not next/link) so the browser does a hard
//     navigation, which discards any poisoned client state from the
//     failed layout render.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [isEnglish, setIsEnglish] = useState(false);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setIsEnglish(navigator.language.toLowerCase().startsWith("en"));
    }, 0);
    return () => window.clearTimeout(handle);
  }, []);

  const copy = isEnglish ? globalErrorCopy.en : globalErrorCopy.ja;
  const homeHref = isEnglish ? "/en" : "/";

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang={copy.lang}>
      <head>
        <title>{copy.title}</title>
        {/*
          Dark-mode override. The inline `style=` attributes below win
          the cascade against a stylesheet rule, so the `!important`
          flags are load-bearing — without them a `prefers-color-scheme:
          dark` user would still see the white background and dark text
          from the inline styles. Selectors are tied to the specific
          elements rendered below (body / the description <p> / the
          home-link <a>); keep them in sync if the markup changes.
        */}
        <style
          dangerouslySetInnerHTML={{
            __html:
              "@media (prefers-color-scheme: dark) { body { background: #0a0a0a !important; color: #fafafa !important; } p { color: #a1a1aa !important; } a { background: #18181b !important; color: #fafafa !important; border-color: #27272a !important; } }",
          }}
        />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem 1rem",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          background: "#fafafa",
          color: "#18181b",
        }}
      >
        <div
          style={{
            maxWidth: 480,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem",
          }}
        >
          <h1
            style={{
              fontSize: "2.25rem",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            {copy.title}
          </h1>
          <p style={{ fontSize: "1rem", color: "#52525b", margin: 0 }}>
            {copy.description}
          </p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.75rem",
              justifyContent: "center",
              paddingTop: "0.5rem",
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                padding: "0.5rem 1.25rem",
                borderRadius: 9999,
                border: "none",
                background: "#4f46e5",
                color: "white",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {copy.retry}
            </button>
            {/*
              Plain `<a>` (with a full reload) on purpose: at this
              error tier the root layout has already crashed, so a
              soft client navigation through next/link would keep the
              same poisoned React tree and risk re-tripping the
              boundary.
            */}
            <a
              href={homeHref}
              style={{
                padding: "0.5rem 1.25rem",
                borderRadius: 9999,
                border: "1px solid #d4d4d8",
                background: "white",
                color: "#18181b",
                fontSize: "0.875rem",
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              {copy.home}
            </a>
          </div>
          {error.digest && (
            <p style={{ fontSize: "0.75rem", color: "#71717a", margin: 0 }}>
              {copy.digest}{" "}
              <span
                style={{
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
                }}
              >
                {error.digest}
              </span>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
