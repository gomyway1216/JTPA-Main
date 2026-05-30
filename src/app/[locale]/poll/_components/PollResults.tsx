import { useTranslations } from "next-intl";

import type { PollOption } from "@/lib/types";

interface Props {
  options: PollOption[];
  // Set of option ids the current user has voted for. Used to mark the
  // user's picks with a check so they can confirm their selection
  // without re-opening the vote form.
  selectedIds: Set<string>;
  voterCount: number;
}

// Renders the option list as a horizontal bar chart. Percentage is share
// of total selections (NOT share of voters), because multi-select polls
// can have more selections than voters and a per-voter denominator would
// produce row percentages that don't add up to 100. The voter count is
// shown separately above so the reader can sanity-check participation.
export function PollResults({ options, selectedIds, voterCount }: Props) {
  const t = useTranslations("PollResults");
  const totalSelections = options.reduce(
    (sum, o) => sum + (o.voteCount ?? 0),
    0,
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        {totalSelections > voterCount
          ? t("summaryWithSelections", {
              voters: voterCount,
              selections: totalSelections,
            })
          : t("summary", { voters: voterCount })}
      </p>
      <ul className="space-y-2">
        {options.map((opt) => {
          const count = opt.voteCount ?? 0;
          const pct =
            totalSelections > 0
              ? Math.round((count / totalSelections) * 100)
              : 0;
          const isSelected = selectedIds.has(opt.id);
          return (
            <li key={opt.id}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span className="flex items-center gap-1.5">
                  {isSelected && (
                    <span
                      aria-label={t("yourChoice")}
                      className="text-emerald-600 dark:text-emerald-400"
                    >
                      ✓
                    </span>
                  )}
                  <span className={isSelected ? "font-semibold" : ""}>
                    {opt.label}
                  </span>
                </span>
                <span className="text-xs text-zinc-500">
                  {t("votes", { count })} · {pct}%
                </span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
                role="presentation"
              >
                <div
                  className={
                    isSelected
                      ? "h-full bg-emerald-500 dark:bg-emerald-400"
                      : "h-full bg-zinc-400 dark:bg-zinc-600"
                  }
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
