import { getTranslations } from "next-intl/server";

import type { UserLinks as UserLinksData } from "@/lib/types";
import { detectSnsPlatform, type SnsPlatform } from "@/lib/users-shared";

// Renders the row of external-link icons shown under the avatar on
// /u/[uid]. Each slot is an outbound link — opens in a new tab with
// `rel="noopener noreferrer"`. Slots whose URL is missing or empty are
// silently skipped so the row collapses when the user hasn't set
// anything; the caller decides whether to omit the whole row.

interface Props {
  links: UserLinksData;
  // Whose links these are — used in the aria-label so screen readers
  // get "Yudai's GitHub" instead of just "GitHub". Optional.
  ownerLabel?: string;
}

export async function UserLinksRow({ links, ownerLabel }: Props) {
  const t = await getTranslations("UserLinks");
  // Build the renderable list once so the empty-case check can short-
  // circuit without rendering a stray <ul>.
  const items: { key: string; href: string; label: string; icon: React.ReactNode }[] =
    [];
  if (links.portfolio) {
    items.push({
      key: "portfolio",
      href: links.portfolio,
      label: t("portfolio"),
      icon: <PortfolioIcon />,
    });
  }
  if (links.github) {
    items.push({
      key: "github",
      href: links.github,
      label: "GitHub",
      icon: <GitHubIcon />,
    });
  }
  if (links.linkedin) {
    items.push({
      key: "linkedin",
      href: links.linkedin,
      label: "LinkedIn",
      icon: <LinkedInIcon />,
    });
  }
  if (links.sns) {
    const platform = detectSnsPlatform(links.sns);
    items.push({
      key: "sns",
      href: links.sns,
      label: snsLabel(platform),
      icon: <SnsIcon platform={platform} />,
    });
  }

  if (items.length === 0) return null;

  return (
    <ul className="flex flex-wrap items-center gap-2">
      {items.map((it) => (
        <li key={it.key}>
          <a
            href={it.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={
              ownerLabel
                ? t("ownerLabel", { owner: ownerLabel, label: it.label })
                : it.label
            }
            title={it.label}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
          >
            {it.icon}
          </a>
        </li>
      ))}
    </ul>
  );
}

function snsLabel(platform: SnsPlatform): string {
  switch (platform) {
    case "x":
      return "X (Twitter)";
    case "instagram":
      return "Instagram";
    case "threads":
      return "Threads";
    case "bluesky":
      return "Bluesky";
    case "mastodon":
      return "Mastodon";
    case "tiktok":
      return "TikTok";
    case "facebook":
      return "Facebook";
    case "youtube":
      return "YouTube";
    case "generic":
      return "SNS";
  }
}

// ---------- icons (16x16, currentColor) ----------
// Inline SVGs so the page doesn't pull in an icon library just for this
// row. `currentColor` so hover/dark-mode tone falls out of the wrapping
// <a>'s `text-*` classes.

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "currentColor",
  "aria-hidden": true as const,
};

function PortfolioIcon() {
  // Globe / external-site glyph.
  return (
    <svg {...iconProps}>
      <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm7.93 9h-3.05a15.6 15.6 0 0 0-1.16-5.32A8 8 0 0 1 19.93 11ZM12 4a13.3 13.3 0 0 1 1.83 7H10.17A13.3 13.3 0 0 1 12 4Zm-3.72 1.68A15.6 15.6 0 0 0 7.12 11H4.07a8 8 0 0 1 4.21-5.32ZM4.07 13h3.05a15.6 15.6 0 0 0 1.16 5.32A8 8 0 0 1 4.07 13ZM12 20a13.3 13.3 0 0 1-1.83-7h3.66A13.3 13.3 0 0 1 12 20Zm3.72-1.68A15.6 15.6 0 0 0 16.88 13h3.05a8 8 0 0 1-4.21 5.32Z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.25 3.34.95.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.78 0c2.21-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.12 3.04.74.81 1.18 1.83 1.18 3.09 0 4.43-2.7 5.4-5.27 5.68.41.36.78 1.06.78 2.13v3.16c0 .31.21.67.8.55A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4.98 3.5C4.98 4.88 3.87 6 2.49 6 1.12 6 0 4.88 0 3.5 0 2.12 1.12 1 2.5 1c1.37 0 2.48 1.12 2.48 2.5ZM.22 8.05h4.55V24H.22V8.05Zm7.4 0h4.36v2.18h.06a4.78 4.78 0 0 1 4.31-2.37c4.61 0 5.46 3.04 5.46 6.99V24h-4.55v-7.4c0-1.77-.03-4.05-2.47-4.05-2.47 0-2.85 1.93-2.85 3.92V24H7.62V8.05Z" />
    </svg>
  );
}

// Single component dispatches on platform so we only build the
// platform→icon lookup once. Unknown platforms render a generic
// "link" glyph that still communicates "this is an external SNS".
function SnsIcon({ platform }: { platform: SnsPlatform }) {
  switch (platform) {
    case "x":
      return (
        <svg {...iconProps}>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231ZM17.083 19.77h1.833L7.084 4.126H5.117L17.083 19.77Z" />
        </svg>
      );
    case "instagram":
      return (
        <svg {...iconProps}>
          <path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41a3.7 3.7 0 0 1 1.38.9c.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.26.07 1.65.07 4.85 0 3.2-.01 3.58-.07 4.85-.05 1.17-.25 1.8-.41 2.23a3.7 3.7 0 0 1-.9 1.38c-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.26.06-1.64.07-4.85.07-3.2 0-3.58-.01-4.85-.07-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85 0-3.2.01-3.58.07-4.85.05-1.17.25-1.8.41-2.23a3.7 3.7 0 0 1 .9-1.38c.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16ZM12 0C8.74 0 8.33.01 7.05.07 5.77.13 4.9.33 4.14.63a5.85 5.85 0 0 0-2.13 1.38A5.85 5.85 0 0 0 .63 4.14C.33 4.9.13 5.77.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.28.26 2.15.56 2.91a5.85 5.85 0 0 0 1.38 2.13 5.85 5.85 0 0 0 2.13 1.38c.76.3 1.63.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.28-.06 2.15-.26 2.91-.56a5.85 5.85 0 0 0 2.13-1.38 5.85 5.85 0 0 0 1.38-2.13c.3-.76.5-1.63.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.28-.26-2.15-.56-2.91a5.85 5.85 0 0 0-1.38-2.13A5.85 5.85 0 0 0 19.86.63c-.76-.3-1.63-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84A6.16 6.16 0 1 0 18.16 12 6.16 6.16 0 0 0 12 5.84Zm0 10.15A4 4 0 1 1 16 12a4 4 0 0 1-4 4Zm6.4-11.85a1.44 1.44 0 1 0 1.44 1.44 1.44 1.44 0 0 0-1.44-1.44Z" />
        </svg>
      );
    case "threads":
      return (
        <svg {...iconProps}>
          <path d="M16.84 11.21c-.08-.04-.16-.07-.25-.11-.14-2.6-1.56-4.09-3.95-4.1h-.04c-1.43 0-2.62.61-3.36 1.72l1.32.9c.55-.83 1.4-1 2.04-1h.02c.8 0 1.4.23 1.78.69.28.34.46.8.55 1.39-.69-.12-1.44-.16-2.24-.11-2.26.13-3.7 1.45-3.6 3.28.05.93.51 1.73 1.31 2.25.67.44 1.54.66 2.45.61 1.2-.07 2.14-.52 2.8-1.36.5-.63.81-1.45.95-2.49 1.02.61 1.78 1.42 2.2 2.39.71 1.66.75 4.38-1.47 6.59-1.95 1.94-4.29 2.78-6.97 2.5-3.6-.36-6.32-2.66-7.27-6.15-.45-1.7-.47-3.36-.05-4.94.43-1.65 1.32-3.05 2.6-4.16 1.45-1.24 3.2-1.86 5.21-1.85 2.45.01 4.36.95 5.69 2.79.6.83 1 1.7 1.16 2.42l1.6-.43c-.2-.92-.7-2-1.45-3.04-1.72-2.37-4.19-3.59-7.22-3.6-2.4 0-4.49.74-6.21 2.21-1.5 1.28-2.55 2.97-3.05 4.94-.49 1.84-.47 3.78.05 5.78 1.13 4.14 4.35 6.84 8.55 7.25 4.05.4 7.3-1.07 9.51-3.27 2.39-2.39 2.61-5.34 1.84-7.14-.63-1.45-1.84-2.66-3.46-3.49Zm-3.59 4.05c-1.02.06-2.08-.4-2.13-1.38-.04-.74.51-1.55 2.23-1.66.2-.01.39-.02.58-.02.59 0 1.14.06 1.65.17-.18 2.39-1.32 2.84-2.33 2.89Z" />
        </svg>
      );
    case "bluesky":
      return (
        <svg {...iconProps}>
          <path d="M5.4 3.6c2.83 2.12 5.88 6.42 7 8.73 1.12-2.31 4.17-6.61 7-8.73 2.04-1.53 5.34-2.71 5.34.95 0 .73-.42 6.12-.66 7-.85 3.06-3.98 3.84-6.76 3.37 4.86.83 6.1 3.56 3.43 6.3-5.07 5.19-7.29-1.31-7.86-2.97-.1-.3-.16-.47-.16-.32 0-.15-.05.02-.16.32-.57 1.66-2.79 8.16-7.86 2.97-2.67-2.74-1.43-5.47 3.43-6.3-2.78.47-5.92-.31-6.76-3.37C.84 10.67.42 5.28.42 4.55c0-3.66 3.3-2.48 5.34-.95Z" />
        </svg>
      );
    case "mastodon":
      return (
        <svg {...iconProps}>
          <path d="M23.27 5.32c-.36-2.66-2.7-4.76-5.47-5.17C17.34.08 15.59 0 12 0c-3.6 0-5.34.08-5.8.15C3.5.55 1.04 2.44.45 5.2c-.29 1.36-.32 1.8-.32 8.74 0 1.66-.01 2.39.02 3.5.07 2.46.27 4.92 2.13 6.78 1.07 1.07 2.4 1.6 4.06 1.78 1.43.16 5.94.3 8.6.16 1.7-.1 4.27-.27 6.18-1.62 1.99-1.4 3.04-3.42 3.36-5.99.13-1 .13-1.07.13-3.4 0-2.34-.01-2.4-.34-3.83-.34-1.49-1.06-2.71-2.07-3.7Zm-3.18 11.59h-2.42v-5.93c0-1.25-.53-1.89-1.6-1.89-1.18 0-1.77.76-1.77 2.27v3.29h-2.4v-3.29c0-1.5-.6-2.27-1.78-2.27-1.07 0-1.6.64-1.6 1.89v5.93H6.1v-6.11c0-1.25.32-2.24.95-2.97.66-.74 1.52-1.11 2.59-1.11 1.25 0 2.18.48 2.79 1.43L12 8.04l.59-.92c.62-.95 1.55-1.43 2.79-1.43 1.07 0 1.94.37 2.59 1.11.64.73.96 1.72.96 2.97v6.11Z" />
        </svg>
      );
    case "tiktok":
      return (
        <svg {...iconProps}>
          <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.3 0 .58.05.85.13V9.4a6.34 6.34 0 0 0-5.94 10.85 6.33 6.33 0 0 0 10.84-4.49V8.49a8.16 8.16 0 0 0 4.77 1.52V6.56a4.85 4.85 0 0 1-.41-.27Z" />
        </svg>
      );
    case "facebook":
      return (
        <svg {...iconProps}>
          <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.51 1.5-3.9 3.78-3.9 1.1 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.57V12h2.77l-.44 2.89h-2.33v6.99A10 10 0 0 0 22 12Z" />
        </svg>
      );
    case "youtube":
      return (
        <svg {...iconProps}>
          <path d="M23.5 6.2a3 3 0 0 0-2.12-2.12C19.45 3.5 12 3.5 12 3.5s-7.45 0-9.38.58A3 3 0 0 0 .5 6.2C0 8.14 0 12 0 12s0 3.86.5 5.8a3 3 0 0 0 2.12 2.12C4.55 20.5 12 20.5 12 20.5s7.45 0 9.38-.58a3 3 0 0 0 2.12-2.12C24 15.86 24 12 24 12s0-3.86-.5-5.8ZM9.6 15.6V8.4l6.24 3.6Z" />
        </svg>
      );
    case "generic":
      return (
        <svg {...iconProps}>
          <path d="M10.59 13.41a1 1 0 0 0 1.42 0l4-4a1 1 0 0 0-1.42-1.42l-4 4a1 1 0 0 0 0 1.42ZM7 17a3 3 0 0 1 0-4.24l3-3a1 1 0 1 1 1.42 1.42l-3 3a1 1 0 0 0 1.41 1.41l3-3a1 1 0 1 1 1.42 1.42l-3 3A3 3 0 0 1 7 17Zm10-10a3 3 0 0 1 0 4.24l-3 3a1 1 0 1 1-1.42-1.42l3-3a1 1 0 0 0-1.41-1.41l-3 3a1 1 0 1 1-1.42-1.42l3-3A3 3 0 0 1 17 7Z" />
        </svg>
      );
  }
}
