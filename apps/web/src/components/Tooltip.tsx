import type { ReactNode } from 'react';

interface TooltipProps {
  /** The explanation shown on hover / keyboard focus. */
  content: ReactNode;
  children: ReactNode;
  /** Extra classes for the trigger wrapper. */
  className?: string;
}

/**
 * Lightweight hover/focus popover — pure Tailwind, no dependency. Wraps a trigger
 * and shows a styled bubble below it on hover AND keyboard focus (a11y: the trigger
 * is focusable, the bubble is exposed as role="tooltip"). Named group (`/tip`) so it
 * never clashes with a `group` on an ancestor row; pointer-events-none so it can't
 * eat clicks.
 */
export function Tooltip({ content, children, className }: TooltipProps) {
  return (
    <span className={`group/tip relative inline-flex cursor-help ${className ?? ''}`} tabIndex={0}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 w-max max-w-[16rem]
                   -translate-x-1/2 rounded-md border border-edge bg-surface-2 px-2.5 py-1.5
                   text-xs font-normal normal-case tracking-normal text-ink shadow-lg
                   opacity-0 transition-opacity duration-100
                   group-hover/tip:opacity-100 group-focus-within/tip:opacity-100"
      >
        {content}
      </span>
    </span>
  );
}
