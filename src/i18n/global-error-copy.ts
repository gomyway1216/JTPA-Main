type GlobalErrorCopy = {
  lang: "ja" | "en";
  title: string;
  description: string;
  retry: string;
  home: string;
  digest: string;
};

// Keep this tiny table separate from messages/*.json so global-error does not
// pull the full translation catalogs into its client bundle.
export const globalErrorCopy = {
  ja: {
    lang: "ja",
    title: "予期しないエラーが発生しました",
    description:
      "ページの読み込み中に問題が発生しました。再読み込みするか、しばらく時間をおいてからお試しください。",
    retry: "再試行",
    home: "ホームに戻る",
    digest: "お問い合わせの際はこのリクエストIDをお知らせください:",
  },
  en: {
    lang: "en",
    title: "Unexpected error",
    description:
      "A problem occurred while loading the page. Reload, or try again later.",
    retry: "Try again",
    home: "Back to home",
    digest: "Please include this request ID when contacting us:",
  },
} satisfies Record<"ja" | "en", GlobalErrorCopy>;
