import {
  CONTENT_LOCALES,
  preferredContentLocale,
  normalizeContentLocales,
  type ContentLocale,
} from "@/lib/content-localization";
import type {
  LocalizedContentMap,
  LocalizedGuideContent,
  LocalizedPollContent,
  LocalizedPollOptionContent,
  LocalizedPostContent,
  LocalizedProjectContent,
  LocalizedQaContent,
  GuideDoc,
  PollDoc,
  PollOption,
  PostDoc,
  ProjectDoc,
  QaDoc,
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
    content && hasText(content.title) && hasText(content.description),
  );
}

function isCompleteGuideContent(
  content: LocalizedGuideContent | undefined,
): content is LocalizedGuideContent {
  return Boolean(content && hasText(content.title) && hasText(content.body));
}

function isCompleteQaContent(
  content: LocalizedQaContent | undefined,
): content is LocalizedQaContent {
  return Boolean(content && hasText(content.title) && hasText(content.body));
}

function isCompletePollContent(
  content: LocalizedPollContent | undefined,
): content is LocalizedPollContent {
  return Boolean(
    content &&
    hasText(content.title) &&
    Array.isArray(content.options) &&
    content.options.filter((option) => hasText(option?.label)).length >= 2,
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

export function getLocalizedGuideContent(
  guide: Pick<GuideDoc, "title" | "body" | "localized">,
  locale: string | undefined,
): LocalizedGuideContent {
  return resolveLocalizedContent(
    guide.localized,
    locale,
    { title: guide.title, body: guide.body },
    isCompleteGuideContent,
  );
}

export function getLocalizedQaContent(
  qa: Pick<QaDoc, "title" | "body" | "localized">,
  locale: string | undefined,
): LocalizedQaContent {
  return resolveLocalizedContent(
    qa.localized,
    locale,
    { title: qa.title, body: qa.body },
    isCompleteQaContent,
  );
}

function localizedOptionLabel(
  option: PollOption,
  index: number,
  localizedOptions: LocalizedPollOptionContent[] | undefined,
): string {
  const byId = localizedOptions?.find(
    (candidate) => candidate.id === option.id,
  );
  if (hasText(byId?.label)) return byId.label;

  const byIndex = localizedOptions?.[index];
  if (hasText(byIndex?.label)) return byIndex.label;

  return option.label;
}

function localizePollOptions(
  options: PollOption[],
  localizedOptions: LocalizedPollOptionContent[] | undefined,
): PollOption[] {
  return options.map((option, index) => ({
    ...option,
    label: localizedOptionLabel(option, index, localizedOptions),
  }));
}

export function getLocalizedPollContent(
  poll: Pick<PollDoc, "title" | "description" | "options" | "localized">,
  locale: string | undefined,
): LocalizedPollContent & { options: PollOption[] } {
  const fallback = {
    title: poll.title,
    description: poll.description,
    options: poll.options,
  };
  const locales = completeLocales(poll.localized, isCompletePollContent);
  const preferred = preferredContentLocale(locales, locale);
  const content = preferred ? poll.localized?.[preferred] : undefined;

  if (!isCompletePollContent(content)) return fallback;

  return {
    title: content.title,
    description:
      typeof content.description === "string"
        ? content.description
        : poll.description,
    options: localizePollOptions(poll.options, content.options),
  };
}

// Match the same completeness checks as the visible body. Locale checkboxes
// alone do not prove a translation exists. Legacy records render one shared
// body: keep one canonical locale, using an unambiguous saved locale when
// available and the site's original Japanese locale otherwise.
function indexableLocales<T>(
  record: { localized?: LocalizedContentMap<T>; locales?: ContentLocale[] },
  isComplete: (content: T | undefined) => boolean,
): ContentLocale[] {
  const translated = completeLocales(record.localized, isComplete);
  if (translated.length > 0) return translated;
  const declared = normalizeContentLocales(record.locales);
  return declared.length === 1 ? declared : ["ja"];
}

export function getPostContentLocales(
  record: Pick<PostDoc, "localized" | "locales">,
): ContentLocale[] {
  return indexableLocales(record, isCompletePostContent);
}

export function getGuideContentLocales(
  record: Pick<GuideDoc, "localized" | "locales">,
): ContentLocale[] {
  return indexableLocales(record, isCompleteGuideContent);
}

export function getProjectContentLocales(
  record: Pick<ProjectDoc, "localized" | "locales">,
): ContentLocale[] {
  return indexableLocales(record, isCompleteProjectContent);
}

export function getQaContentLocales(
  record: Pick<QaDoc, "localized" | "locales">,
): ContentLocale[] {
  return indexableLocales(record, isCompleteQaContent);
}

export function getPollContentLocales(
  record: Pick<PollDoc, "localized" | "locales">,
): ContentLocale[] {
  return indexableLocales(record, isCompletePollContent);
}
