interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

/** Accessible toggle — a real button with aria state, not a styled div. */
export function Switch({ checked, onChange, label, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-gold' : 'bg-surface-3'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-surface-0 transition-transform ${
          checked ? 'translate-x-[1.15rem]' : 'translate-x-[0.2rem]'
        }`}
      />
    </button>
  );
}
