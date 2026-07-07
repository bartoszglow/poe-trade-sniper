import { ChevronDown, ChevronUp } from 'lucide-react';
import type { KeyboardEvent } from 'react';

/**
 * Hides the browser's native number spinner in every engine. The native buttons
 * overlap the value and can't be styled — we render our own stepper instead.
 */
const HIDE_NATIVE_SPINNER =
  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

export interface NumberInputProps {
  value: string;
  /** Raw string (parents parse + validate, matching the existing pattern). */
  onValueChange: (raw: string) => void;
  min?: number;
  max?: number;
  /** Stepper increment; 'any' = free decimal (steppers step by 1). Default 1. */
  step?: number | 'any';
  disabled?: boolean;
  /** Red border when the current value is invalid. */
  invalid?: boolean;
  ariaLabel?: string;
  /** Extra classes on the input (width / font / alignment). */
  className?: string;
  /**
   * `boxed` (default) owns its border+background; `bare` is transparent for
   * embedding in a composite field whose wrapper draws the box + a suffix.
   */
  variant?: 'boxed' | 'bare';
  /** Show the custom up/down stepper. Default true; off for bare composite fields. */
  steppers?: boolean;
  onBlur?: () => void;
  onEnter?: () => void;
}

/**
 * The one number-input atom (replaces the duplicated `NUMBER_INPUT_CLASS` copies
 * + ad-hoc `TextInput type="number"`). Native spinners are hidden everywhere; a
 * clean vertical stepper sits inside the box with the value padded clear of it,
 * so the arrows never crowd the number (operator feedback 2026-07-06).
 */
export function NumberInput({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  disabled = false,
  invalid = false,
  ariaLabel,
  className = '',
  variant = 'boxed',
  steppers = true,
  onBlur,
  onEnter,
}: NumberInputProps) {
  const stepBy = step === 'any' ? 1 : step;

  function nudge(direction: 1 | -1): void {
    const current = Number.parseFloat(value);
    const base = Number.isFinite(current) ? current : (min ?? 0);
    let next = base + direction * stepBy;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    // Trim float noise from decimal steps without forcing trailing zeros.
    onValueChange(String(Number(next.toFixed(6))));
  }

  const atMax = max !== undefined && Number.parseFloat(value) >= max;
  const atMin = min !== undefined && Number.parseFloat(value) <= min;

  const boxClasses =
    variant === 'boxed'
      ? `rounded-md border bg-surface-2 focus-within:border-gold ${invalid ? 'border-danger' : 'border-edge'}`
      : // Bare fills its composite parent and, crucially, `min-w-0` lets it shrink
        // below the number input's intrinsic width — without it, a narrow column
        // overflows and the right-aligned value slides out of view past the suffix.
        'min-w-0 flex-1';

  return (
    <div className={`relative flex items-stretch ${boxClasses}`}>
      <input
        type="number"
        inputMode={step === 1 ? 'numeric' : 'decimal'}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(changeEvent) => onValueChange(changeEvent.target.value)}
        onBlur={onBlur}
        onKeyDown={(keyEvent: KeyboardEvent<HTMLInputElement>) => {
          if (keyEvent.key === 'Enter' && onEnter) keyEvent.currentTarget.blur();
        }}
        className={`min-w-0 flex-1 bg-transparent py-1.5 pl-2.5 text-right font-mono text-sm text-ink focus:outline-none disabled:opacity-50 ${
          steppers ? 'pr-7' : 'pr-2.5'
        } ${HIDE_NATIVE_SPINNER} ${className}`}
      />
      {steppers && (
        <div
          aria-hidden
          className="absolute inset-y-0 right-0 flex w-6 flex-col border-l border-edge"
        >
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled || atMax}
            onClick={() => nudge(1)}
            className="flex flex-1 items-center justify-center text-ink-faint transition-colors hover:text-gold disabled:opacity-30"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled || atMin}
            onClick={() => nudge(-1)}
            className="flex flex-1 items-center justify-center border-t border-edge text-ink-faint transition-colors hover:text-gold disabled:opacity-30"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
