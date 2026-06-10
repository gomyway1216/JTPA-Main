// Renders schema.org structured data as an inline <script> in a Server
// Component. A native tag (not next/script) is the right choice here —
// JSON-LD is data, not executable code (per the Next.js JSON-LD guide).
//
// `JSON.stringify` does not escape HTML, so user-authored content
// containing `</script>` could otherwise break out of the tag; replacing
// `<` with its unicode escape closes that XSS vector, again per the
// Next.js guide. `undefined` values are dropped by JSON.stringify, so
// callers can pass optional fields unconditionally.
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
