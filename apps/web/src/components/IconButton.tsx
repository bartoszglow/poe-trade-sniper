import type { ButtonHTMLAttributes } from 'react';

export type IconButtonVariant = 'ghost' | 'danger';

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  ghost: 'text-ink-muted hover:bg-surface-2 hover:text-ink',
  danger: 'text-ink-muted hover:bg-danger/15 hover:text-danger',
};

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: IconButtonVariant;
  /** Required — icon-only controls need an accessible name. */
  'aria-label': string;
}

export function IconButton({ variant, className = '', ...buttonProps }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...buttonProps}
    />
  );
}
