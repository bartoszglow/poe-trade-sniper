import type { ReactNode } from 'react';
import { detailRowLayout, type DetailRowData } from '../lib/detail-layout';

/**
 * A bordered group box whose title sits as a label notched into the top border
 * (a fieldset-style legend) — saves the vertical space a stacked header takes, so
 * more boxes fit per row. The shared visual unit for the search-criteria view and
 * every item-detail view. It is a `@container`, so the rows inside adapt their
 * layout to the CARD's own width (not the viewport's) — see {@link DetailRows}.
 * Arrange several in a responsive grid; the grid's `gap-y` clears the raised label.
 */
export function DetailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="@container relative rounded-md border border-edge bg-surface-2 px-3 pt-3.5 pb-3">
      <span className="absolute -top-2 left-2.5 rounded bg-surface-3 px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-widest text-ink-muted uppercase">
        {title}
      </span>
      {children}
    </div>
  );
}

/**
 * The adaptive rows of a DetailCard. Compact scalar groups (Base 84, Rarity Rare)
 * pack two-per-line once the card is wide enough — a container query, so they
 * collapse to one column in a narrow card or on mobile; a group that contains any
 * long affix sentence stays one-per-line. The columns-vs-stack decision is the
 * shared {@link detailRowLayout}, so the criteria and item-detail views never diverge.
 */
export function DetailRows({ rows }: { rows: DetailRowData[] }) {
  const layout = detailRowLayout(rows);
  return (
    <dl
      className={
        layout === 'columns'
          ? 'grid grid-cols-1 gap-x-5 gap-y-1 @3xs:grid-cols-2'
          : 'flex flex-col gap-1'
      }
    >
      {rows.map((row, index) => (
        <DetailRow key={`${row.label}-${index}`} {...row} />
      ))}
    </dl>
  );
}

/**
 * One label/value row. The value sits inline right after the label (never pinned to
 * the far edge), so short rows don't leave a big gap and long affix sentences keep
 * their value beside them. Disabled rows strike through; `accent` renders mono-gold.
 */
export function DetailRow({
  label,
  value,
  disabled = false,
  accent = false,
  disabledTag,
}: DetailRowData) {
  return (
    <div className={`text-xs ${disabled ? 'text-ink-faint line-through' : ''}`}>
      <dt className={`inline break-words ${disabled ? '' : 'text-ink-muted'}`}>
        {label}
        {disabled && disabledTag && <span className="no-underline"> ({disabledTag})</span>}
      </dt>
      {value && (
        <dd
          className={`ml-1.5 inline break-words ${
            accent ? 'font-mono text-gold-bright' : disabled ? '' : 'text-ink'
          }`}
        >
          {value}
        </dd>
      )}
    </div>
  );
}
