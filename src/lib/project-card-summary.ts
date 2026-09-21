import { stripMarkdown } from "@/lib/utils";

// Bound the server-rendered excerpt itself, not just the visible CSS lines.
// Grapheme segmentation keeps emoji and Japanese combining marks intact.
export function projectCardSummary(body: string, max = 160): string {
  if (max <= 0) return "";
  const plain = stripMarkdown(body);
  const segments = Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(plain),
    ({ segment }) => segment,
  );
  if (segments.length <= max) return plain;
  const cut = segments.slice(0, max - 1).join("");
  const space = cut.lastIndexOf(" ");
  return (space > cut.length * 0.6 ? cut.slice(0, space) : cut).trimEnd() + "…";
}
