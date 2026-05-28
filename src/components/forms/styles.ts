// Centralized class strings for form controls. These were previously
// copy-pasted (with minor drift) across every *Form.tsx in the app —
// now any tweak to the focus ring or disabled state happens in one
// place. Use as `className={inputClass}` or compose with extra classes
// via `${inputClass} <extras>`.

// Text inputs, textareas, selects, datetime-local, etc.
export const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm transition placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:placeholder:text-zinc-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/30 dark:disabled:bg-zinc-900";

// Primary action button (Submit, 投稿する, 保存, ...). Dark in light
// mode, light in dark mode — matches the existing visual language.
export const primaryButtonClass =
  "inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 focus:ring-offset-white active:scale-[0.98] disabled:opacity-50 disabled:hover:bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-zinc-400 dark:focus:ring-offset-zinc-950 dark:disabled:hover:bg-zinc-100";

// Outlined secondary button (cancel, "もう一度", "オプション追加").
export const secondaryButtonClass =
  "inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 focus:ring-offset-white disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900 dark:focus:ring-zinc-400 dark:focus:ring-offset-zinc-950";

// Destructive button (削除).
export const dangerButtonClass =
  "inline-flex items-center justify-center rounded-md border border-red-300 bg-white px-4 py-2 text-sm text-red-700 transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-white disabled:opacity-50 dark:border-red-800 dark:bg-zinc-950 dark:text-red-300 dark:hover:bg-red-950 dark:focus:ring-red-400 dark:focus:ring-offset-zinc-950";

// Error message line under a Field (validation, server error, ...).
export const errorTextClass = "text-sm text-red-600 dark:text-red-400";
