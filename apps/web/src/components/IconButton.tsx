import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';

export type IconButtonVariant = 'ghost' | 'danger';

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  ghost: 'text-ink-muted hover:bg-surface-2 hover:text-ink',
  danger: 'text-ink-muted hover:bg-danger/15 hover:text-danger',
};

const BASE_CLASSES =
  'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50';

/** The shared look for every icon-only control (button OR link), so they're uniform. */
function iconControlClasses(variant: IconButtonVariant, className: string): string {
  return `${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${className}`;
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: IconButtonVariant;
  /** Required — icon-only controls need an accessible name. */
  'aria-label': string;
}

export function IconButton({ variant, className = '', ...buttonProps }: IconButtonProps) {
  return (
    <button type="button" className={iconControlClasses(variant, className)} {...buttonProps} />
  );
}

interface IconLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant: IconButtonVariant;
  /** Required — icon-only controls need an accessible name. */
  'aria-label': string;
}

/**
 * An icon-only LINK that looks and behaves exactly like {@link IconButton} (same
 * box, hover, focus) — for navigation targets such as "open on the trade site", so
 * a row's edit button and open-link button read as one uniform control family.
 */
export function IconLink({ variant, className = '', ...anchorProps }: IconLinkProps) {
  return <a className={iconControlClasses(variant, className)} {...anchorProps} />;
}
