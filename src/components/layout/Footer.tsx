export function Footer() {
  return (
    <footer className="border-t border-zinc-200 bg-white py-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
      <div className="mx-auto max-w-6xl px-4">
        © {new Date().getFullYear()} JTPA. Built with Next.js + Firebase.
      </div>
    </footer>
  );
}
