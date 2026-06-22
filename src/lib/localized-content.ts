import {
  CONTENT_LOCALES,
  preferredContentLocale,
  type ContentLocale,
} from "@/lib/content-localization";
import type {
  LocalizedContentMap,
  LocalizedPostContent,
  LocalizedProjectContent,
  PostDoc,
  ProjectDoc,
} from "@/lib/types";

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCompletePostContent(
  content: LocalizedPostContent | undefined,
): content is LocalizedPostContent {
  return Boolean(
    content &&
      hasText(content.title) &&
      hasText(content.excerpt) &&
      hasText(content.body),
  );
}

function isCompleteProjectContent(
  content: LocalizedProjectContent | undefined,
): content is LocalizedProjectContent {
  return Boolean(
    content &&
      hasText(content.title) &&
      hasText(content.description),
  );
}

function completeLocales<T>(
  localized: LocalizedContentMap<T> | undefined,
  isComplete: (content: T | undefined) => boolean,
): ContentLocale[] {
  return CONTENT_LOCALES.filter((locale) => isComplete(localized?.[locale]));
}

function resolveLocalizedContent<T>(
  localized: LocalizedContentMap<T> | undefined,
  locale: string | undefined,
  fallback: T,
  isComplete: (content: T | undefined) => content is T,
): T {
  const locales = completeLocales(localized, isComplete);
  const preferred = preferredContentLocale(locales, locale);
  const content = preferred ? localized?.[preferred] : undefined;
  if (isComplete(content)) {
    return content;
  }
  return fallback;
}

export function getLocalizedPostContent(
  post: Pick<PostDoc, "title" | "excerpt" | "body" | "localized">,
  locale: string | undefined,
): LocalizedPostContent {
  return resolveLocalizedContent(
    post.localized,
    locale,
    { title: post.title, excerpt: post.excerpt, body: post.body },
    isCompletePostContent,
  );
}

export function getLocalizedProjectContent(
  project: Pick<ProjectDoc, "title" | "description" | "localized">,
  locale: string | undefined,
): LocalizedProjectContent {
  return resolveLocalizedContent(
    project.localized,
    locale,
    { title: project.title, description: project.description },
    isCompleteProjectContent,
  );
}
