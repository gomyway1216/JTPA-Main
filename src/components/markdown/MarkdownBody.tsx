import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

// Highlight.js stylesheet — imported in src/app/globals.css instead of here
// so it ships on every page without re-importing per usage.

/**
 * Shared Markdown renderer for blog posts, guides, and similar content.
 *
 * - GFM extensions (tables, strikethrough, task lists, autolinks)
 * - Syntax highlighting via highlight.js
 * - Links open in a new tab when external
 * - Headings start at h2 since the page already provides an h1
 */
export function MarkdownBody({ source }: { source: string }) {
  return (
    <div className="prose-jtpa">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
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
