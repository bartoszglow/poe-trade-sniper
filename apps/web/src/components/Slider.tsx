interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  /** Fired when the user releases the thumb — e.g. play a preview at the new value. */
  onCommit?: () => void;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
}

/** Themed range input — native control, gold accent. */
export function Slider({
  value,
  onChange,
  onCommit,
  label,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  className = '',
}: SliderProps) {
  return (
    <input
      type="range"
      aria-label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(changeEvent) => onChange(Number(changeEvent.target.value))}
      onPointerUp={onCommit}
      onKeyUp={onCommit}
      className={`cursor-pointer accent-gold disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    />
  );
}
