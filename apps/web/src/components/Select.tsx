import type { SelectHTMLAttributes } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: SelectOption[];
}

export function Select({ options, className = '', ...selectProps }: SelectProps) {
  return (
    <select
      className={`rounded-md border border-edge bg-surface-2 px-2 py-1.5 text-sm text-ink focus:border-gold focus:outline-none disabled:opacity-50 ${className}`}
      {...selectProps}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
