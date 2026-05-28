interface Props {
  message: string;
  hint?: React.ReactNode;
}

export function EmptyState({ message, hint }: Props) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/50 px-6 py-10 text-center dark:border-zinc-700 dark:bg-zinc-900/30">
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {message}
      </p>
      {hint && (
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{hint}</p>
      )}
    </div>
  );
}
