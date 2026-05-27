import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

// Highlight.js stylesheet — imported in src/app/globals.css instead of here
// so it ships on every page without re-importing per usage.

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

// Demote each Markdown heading by one level so author-controlled content
// can't introduce a second `<h1>` (the page wrapper already provides one).
// `#` becomes `<h2>`, `######` becomes `<h6>` (one level past 6 stays 6).
function demoteHeading(level: 1 | 2 | 3 | 4 | 5 | 6): HeadingTag {
  const next = Math.min(level + 1, 6) as 2 | 3 | 4 | 5 | 6;
  return `h${next}` as HeadingTag;
}

function renderHeading(level: 1 | 2 | 3 | 4 | 5 | 6) {
  const Tag = demoteHeading(level);
  return function HeadingComponent({
    children,
    ...rest
  }: ComponentPropsWithoutRef<"h1">) {
    return <Tag {...rest}>{children}</Tag>;
  };
}

/**
 * Shared Markdown renderer for blog posts, guides, and similar content.
 *
 * - GFM extensions (tables, strikethrough, task lists, autolinks)
 * - Syntax highlighting via highlight.js
 * - External links open in a new tab
 * - Heading levels are demoted by one so author content can never produce
 *   a second `<h1>` (the page already provides the title heading)
 */
export function MarkdownBody({ source }: { source: string }) {
  return (
    <div className="prose-jtpa">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          h1: renderHeading(1),
          h2: renderHeading(2),
          h3: renderHeading(3),
          h4: renderHeading(4),
          h5: renderHeading(5),
          h6: renderHeading(6),
          a: ({ href, children, ...rest }) => {
            const isExternal = !!href && /^https?:\/\//.test(href);
            return (
              <a
                href={href}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noreferrer noopener" : undefined}
                {...rest}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
