import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'ghost' | 'danger';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-gold/90 text-surface-0 hover:bg-gold-bright disabled:bg-surface-3 disabled:text-ink-faint',
  ghost:
    'border border-edge text-ink-muted hover:border-edge-strong hover:text-ink disabled:text-ink-faint',
  danger: 'bg-danger/90 text-surface-0 hover:bg-danger disabled:bg-surface-3',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: ButtonVariant;
}

/** Atomic button — variants are an enum, no boolean styling flags. */
export function Button({ variant, className = '', ...buttonProps }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...buttonProps}
    />
  );
}
