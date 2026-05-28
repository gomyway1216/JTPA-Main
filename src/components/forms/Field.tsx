interface Props {
  label: string;
  required?: boolean;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}

// Wraps a form control with its label, optional required marker, and
// optional hint line. Previously copy-pasted into six different *Form
// components; this is the single source of truth.
//
// Outer wrapper is `<div>`, not `<label>`: some fields (cover image,
// body editor) contain an `<input type="file">` alongside other
// controls, and an outer `<label>` fired its implicit "click the first
// form control" behavior on adjacent padding clicks and popped the
// native file picker. For a11y we still render a real `<label
// htmlFor>` when callers supply `htmlFor`; otherwise we fall back to a
// plain `<span>` so the implicit-label trap stays gone.
export function Field({ label, required, htmlFor, hint, children }: Props) {
  return (
    <div>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
          {required && (
            <span aria-hidden="true" className="text-red-600">
              {" *"}
            </span>
          )}
        </label>
      ) : (
        <span className="text-sm font-medium">
          {label}
          {required && (
            <span aria-hidden="true" className="text-red-600">
              {" *"}
            </span>
          )}
        </span>
      )}
      <div className="mt-1">{children}</div>
      {hint && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
      )}
    </div>
  );
}
