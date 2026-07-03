import type { ReactNode } from 'react';

/** Which side the bubble opens on. */
type TooltipPlacement = 'bottom' | 'right';

interface TooltipProps {
  /** The explanation shown on hover / keyboard focus. */
  content: ReactNode;
  children: ReactNode;
  /** Extra classes for the trigger wrapper. */
  className?: string;
  /** Side the bubble opens on. Default 'bottom'. */
  placement?: TooltipPlacement;
  /**
   * Whether the wrapper is itself a focus target. Default true (for non-interactive
   * triggers like badges, so keyboard users can reveal the tip). Set false when the
   * child is already focusable (a link/button) — `group-focus-within` still reveals
   * the bubble from the child's own focus, and we avoid a redundant tab stop.
   */
  focusable?: boolean;
}

const PLACEMENT_CLASSES: Record<TooltipPlacement, string> = {
  bottom: 'left-1/2 top-full mt-1.5 -translate-x-1/2',
  right: 'left-full top-1/2 ml-1.5 -translate-y-1/2',
};

/**
 * Lightweight hover/focus popover — pure Tailwind, no dependency. Wraps a trigger
 * and shows a styled bubble on hover AND keyboard focus (a11y: the bubble is exposed
 * as role="tooltip"). Named group (`/tip`) so it never clashes with a `group` on an
 * ancestor row; pointer-events-none so it can't eat clicks.
 */
export function Tooltip({
  content,
  children,
  className,
  placement = 'bottom',
  focusable = true,
}: TooltipProps) {
  return (
    <span
      className={`group/tip relative inline-flex ${focusable ? 'cursor-help' : ''} ${className ?? ''}`}
      tabIndex={focusable ? 0 : undefined}
    >
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-30 w-max max-w-[16rem] ${PLACEMENT_CLASSES[placement]}
                   rounded-md border border-edge bg-surface-2 px-2.5 py-1.5
                   text-xs font-normal normal-case tracking-normal text-ink shadow-lg
                   opacity-0 transition-opacity duration-100
                   group-hover/tip:opacity-100 group-focus-within/tip:opacity-100`}
      >
        {content}
      </span>
    </span>
  );
}
