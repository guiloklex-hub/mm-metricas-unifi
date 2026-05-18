import type { PropsWithChildren, ReactNode } from 'react';

export function Card({
  title,
  actions,
  children,
}: PropsWithChildren<{ title?: ReactNode; actions?: ReactNode }>) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
