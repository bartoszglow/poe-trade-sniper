import type { ReactNode } from 'react';

/**
 * A bordered group box whose title sits as a label notched into the top border
 * (a fieldset-style legend) — saves the vertical space a stacked header takes,
 * so more boxes fit per row. The shared visual unit for both the search-criteria
 * view and the hit item-detail view. Arrange several in a responsive grid
 * (`grid-cols-1 sm:2 xl:3 2xl:4`); the grid's `gap-y` clears the raised label.
 */
export function DetailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="relative rounded-md border border-edge bg-surface-2 px-3 pt-3.5 pb-3">
      <span className="absolute -top-2 left-2.5 rounded bg-surface-3 px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-widest text-ink-muted uppercase">
        {title}
      </span>
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
