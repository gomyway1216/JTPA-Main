# Search discovery and report content

Public listing metadata describes each section in Japanese and English. Reading
pages link to events, practical guides and email updates. Guide authors are
displayed through public profiles, respecting their name-visibility choices.

## Reviewed event report update

`scripts/content/event-report-seo.json` contains the reviewed titles, excerpts,
Japanese summary additions and full English translations for reports `ai-2`,
`ai-3` and `ai-4`. The Japanese original remains intact after the new summary;
photos, credits and source links are retained in both languages.

After this change is merged, apply it using existing Firebase Admin credentials:

```sh
FIREBASE_PROJECT_ID=jtpa-main node scripts/update-event-report-seo.mjs --dry-run
FIREBASE_PROJECT_ID=jtpa-main node scripts/update-event-report-seo.mjs --apply
```

The default is a dry run. The script updates all three reports in one transaction,
refuses to overwrite text changed since editorial review, and skips already
applied edits. It does not change authors, publication dates, images or event
associations. No notifications are sent. The existing content cache can take up
to 300 seconds to refresh after the direct database update. Verify the Japanese
and English public report pages and the sitemap after that window.

## Measure results

In Search Console, use the property for `https://bayarea-ai.com/`, submit
`https://bayarea-ai.com/sitemap.xml`, and inspect the homepage, next event and
updated reports. A sitemap entry is not proof that Google indexed the URL.
The root layout includes the public HTML verification tag supplied by Search
Console. Keep this tag in the initial HTML head to retain verified ownership.
Track search queries, impressions, clicks and CTR before drawing conclusions
about rankings. English alternatives should represent actual translated bodies.

GA4 already records successful event registrations as `rsvp_complete`. Use it
with organic-search acquisition to assess whether readers become participants.
Do not include participant names or email addresses in analytics. Check mobile
Core Web Vitals before deciding that performance work is needed.

For future reports, name the demonstrated topic in the title, retain first-hand
examples and sources, and link to a relevant next step. Seek relevant editorial
links from JTPA and speakers' own pages; do not buy links or generate unrelated
articles to increase page count.
