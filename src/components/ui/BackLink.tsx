import Link from "next/link";

// "← X 一覧" link used at the top of detail pages (blog, qa, poll,
// event). Previously each page used a bare `text-xs text-zinc-500
// hover:underline` which read as throwaway; this gives it a little more
// presence with the accent color and a nudge on the arrow on hover.
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1 text-sm text-zinc-600 transition hover:text-accent dark:text-zinc-400"
    >
      <span
        aria-hidden="true"
        className="transition group-hover:-translate-x-0.5"
      >
        ←
      </span>
      {label}
    </Link>
  );
}
