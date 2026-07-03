/**
 * Parses a stored Electron-style accelerator (`CommandOrControl+Shift+D`, or a bare
 * `F5`) into the pieces a uiohook keydown observer matches against. PURE — no
 * uiohook import — so it unit-tests without the native addon; the listener resolves
 * `keyName` → a uiohook keycode at runtime. Single keys and larger combos are both
 * supported (the recorder allows either now).
 */

export interface ParsedHotkey {
  /** A uiohook-napi `UiohookKey` member name (e.g. 'D', 'F5', 'Enter', 'ArrowUp'). */
  keyName: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

/** The uiohook keyboard-event fields we read (a real UiohookKeyboardEvent satisfies this). */
export interface HotkeyEvent {
  keycode: number;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** Accelerator key token → uiohook `UiohookKey` member name, where they differ. */
const TOKEN_TO_UIOHOOK_KEY: Record<string, string> = {
  Return: 'Enter',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '`': 'Backquote',
};

export function uiohookKeyName(token: string): string {
  if (/^num[0-9]$/.test(token)) return `Numpad${token.slice(3)}`;
  return TOKEN_TO_UIOHOOK_KEY[token] ?? token;
}

/**
 * Parse the accelerator; `isMac` decides whether `CommandOrControl` means the ⌘
 * (meta) or Ctrl modifier. Returns null when there is no main key.
 */
export function parseHotkey(accelerator: string, isMac: boolean): ParsedHotkey | null {
  const parts = accelerator
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  let ctrl = false;
  let alt = false;
  let shift = false;
  let meta = false;
  let key: string | null = null;
  for (const part of parts) {
    switch (part) {
      case 'CommandOrControl':
      case 'CmdOrCtrl':
        if (isMac) meta = true;
        else ctrl = true;
        break;
      case 'Control':
      case 'Ctrl':
        ctrl = true;
        break;
      case 'Alt':
      case 'Option':
        alt = true;
        break;
      case 'Shift':
        shift = true;
        break;
      case 'Command':
      case 'Cmd':
      case 'Super':
      case 'Meta':
        meta = true;
        break;
      default:
        key = part;
    }
  }
  if (key === null) return null;
  return { keyName: uiohookKeyName(key), ctrl, alt, shift, meta };
}

/**
 * Whether the event's modifier state EXACTLY matches the hotkey's — no extra
 * modifiers, so a bare `D` never fires on Ctrl+D.
 */
export function matchesModifiers(parsed: ParsedHotkey, event: HotkeyEvent): boolean {
  return (
    event.ctrlKey === parsed.ctrl &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift &&
    event.metaKey === parsed.meta
  );
}
