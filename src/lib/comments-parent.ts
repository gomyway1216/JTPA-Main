import type { CommentParentType } from "@/lib/types";

/**
 * Map a CommentParentType to its Firestore collection name. Lives in a
 * plain module (no `server-only`) so both Server Actions and client
 * components can import it — the latter only need the route mapping but
 * keeping both helpers together makes it harder for a new parent type
 * to be added in only one of the two places.
 */
export function parentCollection(parentType: CommentParentType): string {
  switch (parentType) {
    case "post":
      return "posts";
    case "guide":
      return "guides";
    case "qa":
      return "qa";
    case "project":
      return "projects";
    case "poll":
      return "polls";
  }
}

/**
 * Map a CommentParentType to the public route prefix where a record of
 * that type renders. Used by Server Actions to call `revalidatePath`
 * with the canonical route and by client components to build a
 * `redirect=` query on the login link.
 */
export function parentRoutePrefix(parentType: CommentParentType): string {
  switch (parentType) {
    case "post":
      return "/blog";
    case "guide":
      return "/guide";
    case "qa":
      return "/qa";
    case "project":
      return "/showcase";
    case "poll":
      return "/poll";
  }
}

/**
 * `true` when a parent record is in the publicly-readable status. Used
 * by the comment / like Server Actions to refuse new writes against an
 * unpublished parent.
 *
 * `posts`, `guides`, `qa` all use `"published"` as the visible status.
 * `projects` use `"approved"` instead (they go through a moderation
 * queue rather than a draft/publish toggle), so the predicate has to be
 * parent-type aware. The caller passes the doc shape so we can read the
 * status without re-fetching.
 */
export function isParentPubliclyVisible(
  parentType: CommentParentType,
  data: { status: string },
): boolean {
  // Switch over the union (rather than `if/else`) so adding a new
  // parent type to `CommentParentType` becomes a compile-time error
  // here until the new case is handled. Matches the structure of
  // `parentCollection` / `parentRoutePrefix` above.
  switch (parentType) {
    case "project":
      return data.status === "approved";
    case "post":
    case "guide":
    case "qa":
    case "poll":
      return data.status === "published";
  }
}
