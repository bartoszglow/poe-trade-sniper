import { useState, type KeyboardEvent } from 'react';
import { Keyboard, RotateCcw } from 'lucide-react';
import { useT } from '../i18n/i18n';
import { acceleratorFromKeyChord, formatAccelerator, isMacPlatform } from '../lib/hotkey';
import { IconButton } from './IconButton';

interface HotkeyRecorderProps {
  /** Current accelerator, Electron form (e.g. `CommandOrControl+Shift+D`). */
  value: string;
  onChange: (accelerator: string) => void;
  /** When set and the value has drifted from it, a reset control appears. */
  defaultValue?: string;
}

/**
 * Records a global-shortcut accelerator by listening for the next key combo the
 * operator presses — the pattern editors/IDEs use, so it feels familiar. Click to
 * arm, press the combo (modifier-only presses keep it listening), Esc or blur
 * cancels. The captured combo is stored as an Electron accelerator; the button
 * shows it in platform-native symbols.
 */
export function HotkeyRecorder({ value, onChange, defaultValue }: HotkeyRecorderProps) {
  const t = useT();
  const [recording, setRecording] = useState(false);
  const isMac = isMacPlatform();

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!recording) return;
    // Swallow the keystroke so Enter/Space don't re-toggle the button and the
    // browser doesn't act on the combo while we capture it.
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setRecording(false);
      return;
    }
    const accelerator = acceleratorFromKeyChord(event, { isMac });
    if (accelerator === null) return; // modifier-only / not committable yet — keep listening
    onChange(accelerator);
    setRecording(false);
  }

  const showReset = defaultValue !== undefined && value !== defaultValue && !recording;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setRecording((on) => !on)}
        onKeyDown={handleKeyDown}
        onBlur={() => setRecording(false)}
        aria-label={t('settings.hotkeyRecord')}
        className={`inline-flex min-w-44 items-center justify-center gap-2 rounded-md border px-3 py-1.5 font-mono text-sm transition-colors ${
          recording
            ? 'border-gold/70 bg-gold/10 text-gold-bright'
            : 'border-edge bg-surface-2 text-ink hover:border-edge-strong'
        }`}
      >
        <Keyboard className="h-3.5 w-3.5 opacity-70" />
        {recording ? (
          <span className="text-ink-muted">{t('settings.hotkeyRecording')}</span>
        ) : (
          formatAccelerator(value, { isMac }) || t('settings.hotkeyNone')
        )}
      </button>
      {showReset && (
        <IconButton
          variant="ghost"
          aria-label={t('settings.hotkeyReset')}
          title={t('settings.hotkeyReset')}
          onClick={() => onChange(defaultValue)}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </IconButton>
      )}
    </div>
  );
}
