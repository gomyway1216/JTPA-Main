import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { FeedbackForm } from "@/app/[locale]/help/_components/FeedbackForm";
import Link from "@/i18n/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { MAINTAINER_LINKS } from "@/lib/maintainer";
import { absoluteLocalizedUrl, localizedAlternates } from "@/lib/seo";

type HelpStep = {
  title: string;
  body: string;
  href?: string;
  linkLabel?: string;
};

type HelpTableRow = {
  cells: string[];
  href?: string;
};

type HelpSection = {
  title: string;
  paragraphs?: string[];
  items?: string[];
  steps?: HelpStep[];
  callout?: string;
  table?: {
    headers: string[];
    rows: HelpTableRow[];
  };
  note?: string;
};

const SECTION_IDS = [
  "signin",
  "events",
  "presenter",
  "showcase",
  "blog",
  "qa",
  "guide",
  "comments",
  "profile",
  "mypage",
  "feedback",
] as const;

type SectionId = (typeof SECTION_IDS)[number];
type HelpTranslations = Awaited<ReturnType<typeof getTranslations>>;

const linkClassName = "text-blue-600 hover:underline";

function richLink(href: string) {
  return function RichLink(chunks: React.ReactNode) {
    return (
      <Link href={href} className={linkClassName}>
        {chunks}
      </Link>
    );
  };
}

function externalRichLink(href: string) {
  return function ExternalRichLink(chunks: React.ReactNode) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className={linkClassName}
      >
        {chunks}
      </a>
    );
  };
}

const richTextComponents = {
  strong: (chunks: React.ReactNode) => (
    <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
      {chunks}
    </strong>
  ),
  code: (chunks: React.ReactNode) => (
    <code className="rounded bg-zinc-100 px-1 py-0.5 text-[0.85em] dark:bg-zinc-800">
      {chunks}
    </code>
  ),
  blogLink: richLink("/blog"),
  guideListLink: richLink("/guide"),
  guideNewLink: richLink("/guide/new"),
  myGuidesLink: richLink("/my/guides"),
  myLikesLink: richLink("/my/likes"),
  myPageLink: richLink("/my"),
  myProfileLink: richLink("/my/profile"),
  myQaLink: richLink("/my/qa"),
  qaLink: richLink("/qa/new"),
  qaListLink: richLink("/qa"),
  showcaseLink: richLink("/showcase"),
  yudaiLinkedInLink: externalRichLink(MAINTAINER_LINKS.linkedin),
};

function richText(t: HelpTranslations, key: string) {
  return t.rich(key, richTextComponents);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "HelpPage" });
  const title = t("metadataTitle");
  const description = t("metadataDescription");
  return {
    title,
    description,
    alternates: localizedAlternates("/help", locale),
    openGraph: {
      title,
      description,
      url: absoluteLocalizedUrl("/help", locale),
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

// `force-dynamic` so the FeedbackForm at the bottom can read the current
// session — the rest of the page is static, but bumping the whole page
// to dynamic is the simplest way to keep the form's logged-in/-out
// branch right without splitting the layout into a server/client pair.
export const dynamic = "force-dynamic";

export default async function HelpPage() {
  const t = await getTranslations("HelpPage");
  const sections = (t.raw("sections") ?? {}) as Partial<Record<SectionId, HelpSection>>;
  const visibleSections = SECTION_IDS.flatMap((id) => {
    const section = sections[id];
    return section ? [{ id, section }] : [];
  });
  const user = await getSessionUser();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t.rich("intro", {
            qaLink: richTextComponents.qaLink,
          })}
        </p>
      </header>

      <nav className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="mb-2 font-medium">{t("toc")}</p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {visibleSections.map(({ id, section }) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className={linkClassName}
              >
                {section.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {visibleSections.map(({ id, section }) => (
        <Section key={id} id={id} title={section.title}>
          <SectionBody section={section} sectionId={id} t={t} />
          {id === "feedback" && <FeedbackForm user={user} />}
        </Section>
      ))}
    </div>
  );
}

function SectionBody({
  section,
  sectionId,
  t,
}: {
  section: HelpSection;
  sectionId: SectionId;
  t: HelpTranslations;
}) {
  return (
    <>
      {section.paragraphs?.map((paragraph, index) => (
        <p key={paragraph}>
          {richText(t, `sections.${sectionId}.paragraphs.${index}`)}
        </p>
      ))}
      {section.steps?.map((step, index) => (
        <Step key={`${index}-${step.title}`} n={index + 1} title={step.title}>
          {step.href && (
            <>
              <Link
                href={step.href}
                className={linkClassName}
              >
                {step.linkLabel ?? step.href}
              </Link>{" "}
            </>
          )}
          {richText(t, `sections.${sectionId}.steps.${index}.body`)}
        </Step>
      ))}
      {section.items && (
        <ul className="list-disc pl-5 space-y-1">
          {section.items.map((item, index) => (
            <li key={item}>
              {richText(t, `sections.${sectionId}.items.${index}`)}
            </li>
          ))}
        </ul>
      )}
      {section.callout && (
        <Callout>{richText(t, `sections.${sectionId}.callout`)}</Callout>
      )}
      {section.table && (
        <Table headers={section.table.headers}>
          {section.table.rows.map((row, index) => (
            <Row
              key={`${index}-${row.cells.join("-")}`}
              cells={row.cells}
              href={row.href}
            />
          ))}
        </Table>
      )}
      {section.note && (
        <p className="text-sm text-zinc-500">
          {richText(t, `sections.${sectionId}.note`)}
        </p>
      )}
    </>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-3 scroll-mt-20">
      <h2 className="text-xl font-semibold border-b border-zinc-200 pb-1 dark:border-zinc-800">
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        {children}
      </div>
    </section>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
        {n}
      </span>
      <div className="space-y-1">
        <p className="font-medium text-zinc-900 dark:text-zinc-100">{title}</p>
        <div className="text-zinc-600 dark:text-zinc-400">{children}</div>
      </div>
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border-l-4 border-amber-400 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500 dark:bg-amber-950/40 dark:text-amber-200">
      {children}
    </div>
  );
}

function Table({
  headers,
  children,
}: {
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-zinc-500">
        <tr>
          {headers.map((h) => (
            <th key={h} className="py-2 pr-4">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {children}
      </tbody>
    </table>
  );
}

function Row({ cells, href }: { cells: string[]; href?: string }) {
  return (
    <tr>
      {cells.map((cell, i) => (
        <td key={i} className="py-2 pr-4 align-top">
          {i === 0 && href ? (
            <Link href={href} className="text-blue-600 hover:underline">
              {cell}
            </Link>
          ) : (
            cell
          )}
        </td>
      ))}
    </tr>
  );
}
