import type { InputHTMLAttributes } from 'react';

type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export function TextInput({ className = '', ...inputProps }: TextInputProps) {
  return (
    <input
      className={`rounded-md border border-edge bg-surface-2 px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-gold focus:outline-none disabled:opacity-50 ${className}`}
      {...inputProps}
    />
  );
}
