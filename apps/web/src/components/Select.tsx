import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

/**
 * Atomic select — a custom listbox dropdown (not a native <select>) so the
 * option menu matches the PoE-dark theme on every OS: surface panel, gold
 * selected row, hover/keyboard active states. Controlled; `onChange` receives
 * the chosen value and the menu closes on selection (card-bridge pattern).
 *
 * Keyboard: focus the trigger → ↓/Enter/Space opens; ↑/↓ move; Enter selects;
 * Esc closes. Click-outside closes. Pair with <Field> for a labelled row.
 */
export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function Select({
  value,
  onChange,
  options,
  id,
  ariaLabel,
  placeholder,
  disabled,
  className = '',
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const current = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  // Close when clicking outside the control.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // On open, move focus to the selected (or first) option for keyboard control.
  useEffect(() => {
    if (!open) return;
    const index = selectedIndex >= 0 ? selectedIndex : 0;
    optionRefs.current[index]?.focus();
  }, [open, selectedIndex]);

  function choose(next: string) {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onTriggerKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
    }
  }

  function onOptionKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      optionRefs.current[Math.min(index + 1, options.length - 1)]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      optionRefs.current[Math.max(index - 1, 0)]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((previous) => !previous)}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-edge bg-surface-2 px-2 py-1.5 text-left text-sm text-ink focus:border-gold focus:outline-none disabled:opacity-50"
      >
        <span className={`truncate ${current ? '' : 'text-ink-faint'}`}>
          {current?.label ?? placeholder ?? ''}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute left-0 z-50 mt-1 max-h-60 w-full min-w-max overflow-auto rounded-md border border-edge bg-surface-2 p-1 shadow-lg shadow-black/40"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <li key={option.value} role="option" aria-selected={isSelected}>
                <button
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  type="button"
                  onClick={(event) => {
                    // Selects often sit inside a <label> (Field). The chosen option
                    // unmounts with the menu, so the browser then treats the click
                    // as a label-area click and forwards a synthetic click to the
                    // label's control — the trigger — which would re-toggle the
                    // menu open. Cancelling the default label activation stops it.
                    event.preventDefault();
                    choose(option.value);
                  }}
                  onKeyDown={(event) => onOptionKeyDown(event, index)}
                  className={`flex w-full items-center justify-between gap-3 rounded px-2.5 py-1.5 text-left text-sm outline-none transition-colors hover:bg-surface-3 focus:bg-surface-3 ${
                    isSelected ? 'font-medium text-gold-bright' : 'text-ink'
                  }`}
                >
                  <span className="truncate">{option.label}</span>
                  {isSelected && <Check className="h-4 w-4 shrink-0" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
