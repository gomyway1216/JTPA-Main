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
  }
}
