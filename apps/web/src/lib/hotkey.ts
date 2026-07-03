/**
 * Keyboard-event → Electron global-shortcut accelerator, and back to a human
 * display string. Kept pure (no DOM) so it unit-tests without a browser; the
 * `HotkeyRecorder` component feeds it real `KeyboardEvent`s (which structurally
 * satisfy `KeyChord`). Accelerator grammar follows Electron's `globalShortcut`
 * (`CommandOrControl+Shift+D`) so the desktop layer registers the string verbatim.
 */

/** The fields of a KeyboardEvent we read — a real event satisfies this. */
export interface KeyChord {
  code: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

/** True while only modifier keys are held — the recorder waits for the main key. */
export function isModifierOnly(chord: KeyChord): boolean {
  return MODIFIER_CODES.has(chord.code);
}

/** `KeyboardEvent.code` → the accelerator key token, or null if unbindable. */
function mainKeyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3); // KeyD → D
  if (/^Digit[0-9]$/.test(code)) return code.slice(5); // Digit1 → 1
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code; // F1–F24
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`; // Electron numpad token
  const named: Record<string, string> = {
    Space: 'Space',
    Enter: 'Return',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Escape: 'Escape',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Insert: 'Insert',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backquote: '`',
  };
  return named[code] ?? null;
}

const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-4])$/;

/**
 * Build an accelerator from a key chord, or null if it isn't a committable
 * shortcut yet: modifier-only presses, unbindable keys, and bare non-function
 * keys (a global shortcut needs a modifier, else it would fire on every keypress)
 * all return null so the recorder keeps listening.
 */
export function acceleratorFromKeyChord(
  chord: KeyChord,
  options: { isMac: boolean },
): string | null {
  if (isModifierOnly(chord)) return null;
  const mainKey = mainKeyFromCode(chord.code);
  if (mainKey === null || mainKey === 'Escape') return null;
  const modifiers: string[] = [];
  if (options.isMac ? chord.metaKey : chord.ctrlKey) modifiers.push('CommandOrControl');
  if (chord.altKey) modifiers.push('Alt');
  if (chord.shiftKey) modifiers.push('Shift');
  if (modifiers.length === 0 && !FUNCTION_KEY.test(mainKey)) return null;
  return [...modifiers, mainKey].join('+');
}

const DISPLAY_MAC: Record<string, string> = {
  CommandOrControl: '⌘',
  CmdOrCtrl: '⌘',
  Command: '⌘',
  Cmd: '⌘',
  Super: '⌘',
  Meta: '⌘',
  Control: '⌃',
  Ctrl: '⌃',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧',
  Return: '↩',
  Space: '␣',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
};

const DISPLAY_OTHER: Record<string, string> = {
  CommandOrControl: 'Ctrl',
  CmdOrCtrl: 'Ctrl',
  Command: 'Ctrl',
  Cmd: 'Ctrl',
  Super: 'Win',
  Meta: 'Win',
  Option: 'Alt',
};

/** Render an accelerator for humans: ⌘⇧D on macOS, Ctrl+Shift+D elsewhere. */
export function formatAccelerator(accelerator: string, options: { isMac: boolean }): string {
  if (!accelerator) return '';
  const table = options.isMac ? DISPLAY_MAC : DISPLAY_OTHER;
  const parts = accelerator.split('+').map((part) => table[part] ?? part);
  return parts.join(options.isMac ? '' : '+');
}

/** Best-effort platform sniff — real desktop exposes `systemInfo`, web falls back. */
export function isMacPlatform(): boolean {
  const platform =
    (typeof window !== 'undefined' && window.systemInfo?.platform) ||
    (typeof navigator !== 'undefined' ? navigator.platform : '') ||
    '';
  return /mac/i.test(platform);
}
