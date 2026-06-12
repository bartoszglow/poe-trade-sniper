import type { ReactNode } from 'react';

/**
 * A bordered group box with an uppercase header — the shared visual unit for
 * both the search-criteria view and the hit item-detail view, so they read the
 * same. Arrange several in a responsive grid (`grid-cols-1 sm:2 xl:3`).
 */
export function DetailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-edge bg-surface-2 p-3">
      <div className="mb-2 text-[0.6rem] font-semibold tracking-widest text-ink-faint uppercase">
        {title}
      </div>
      <dl className="flex flex-col gap-1">{children}</dl>
    </div>
  );
}

/** key (left, muted) / value (right) row — wraps gracefully in a narrow column. */
export function DetailRow({
  label,
  value,
  disabled = false,
  accent = false,
  disabledTag,
}: {
  label: string;
  value?: string;
  disabled?: boolean;
  accent?: boolean;
  disabledTag?: string;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 text-xs ${
        disabled ? 'text-ink-faint line-through' : ''
      }`}
    >
      <dt className={`min-w-0 break-words ${disabled ? '' : 'text-ink-muted'}`}>
        {label}
        {disabled && disabledTag && <span className="no-underline"> ({disabledTag})</span>}
      </dt>
      {value && (
        <dd
          className={`shrink-0 text-right ${
            accent ? 'font-mono text-gold-bright' : disabled ? '' : 'text-ink'
          }`}
        >
          {value}
        </dd>
      )}
    </div>
  );
}
