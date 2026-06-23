/** Accent colour when on — gold by default; 'info' (blue) marks a paused row. */
type SwitchTone = 'gold' | 'info';

const ON_TONE_CLASSES: Record<SwitchTone, string> = {
  gold: 'bg-gold',
  info: 'bg-info',
};

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  tone?: SwitchTone;
}

/** Accessible toggle — a real button with aria state, not a styled div. */
export function Switch({ checked, onChange, label, disabled = false, tone = 'gold' }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? ON_TONE_CLASSES[tone] : 'bg-surface-3'
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
