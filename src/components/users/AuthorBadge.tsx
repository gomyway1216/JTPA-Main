import Link from "next/link";

interface Props {
  name: string;
  photoURL?: string | null;
  // When provided, wraps the badge in a link to the user's profile.
  // Omit for contexts where the badge is rendered inside an outer
  // <Link> (nested anchors are invalid HTML).
  uid?: string | null;
  size?: "sm" | "md";
}

export function AuthorBadge({ name, photoURL, uid, size = "sm" }: Props) {
  const sizeClass = size === "sm" ? "h-5 w-5" : "h-6 w-6";
  const inner = (
    <>
      {photoURL ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={photoURL}
          alt=""
          className={`${sizeClass} shrink-0 rounded-full object-cover`}
        />
      ) : null}
      <span>{name}</span>
    </>
  );

  if (uid) {
    return (
      <Link
        href={`/u/${uid}`}
        className="inline-flex items-center gap-1.5 align-middle hover:text-zinc-700 hover:underline dark:hover:text-zinc-300"
      >
        {inner}
      </Link>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      {inner}
    </span>
  );
}
