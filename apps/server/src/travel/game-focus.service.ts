import { execFile } from 'node:child_process';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env.js';

/**
 * Brings the game window to the foreground after an auto-travel. PoE2 runs at a
 * low frame rate while backgrounded (intentional); focusing it the moment the
 * character teleports restores full FPS so the operator can act immediately.
 *
 * macOS-only and best-effort: a missing or renamed process is a no-op, never an
 * error. The server runs on the same machine as the game (the desktop shell
 * boots it in-process), so a local `osascript` focus is enough — no Electron
 * dependency, so it also works under the standalone dev server.
 */
@Injectable()
export class GameFocusService {
  private readonly logger = new Logger(GameFocusService.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  focus(): void {
    if (!this.config.GAME_FOCUS_ON_TRAVEL) return;
    if (process.platform !== 'darwin') return;
    // Match the WINDOW TITLE, not the process name: under Wine the game process
    // is just "wine", and there are two of them (Steam + the game), so a
    // name match focuses the wrong one. GAME_WINDOW_TITLE is charset-validated
    // (no quotes), so inlining it into the AppleScript cannot break the string.
    const title = this.config.GAME_WINDOW_TITLE;
    // Scan ONLY the Wine processes (the game runs under Wine): iterating every
    // GUI process's `background only` attribute intermittently throws System
    // Events -1719 ("Invalid index") and is far slower — which also contended
    // with the buy's own focus a moment later. `name contains "wine"` sidesteps
    // both. GAME_WINDOW_TITLE is charset-validated, so inlining it is safe.
    const script = [
      'tell application "System Events"',
      '  repeat with proc in (every process whose name contains "wine")',
      '    repeat with win in (windows of proc)',
      `      if (name of win) contains "${title}" then`,
      '        set frontmost of proc to true',
      '        return',
      '      end if',
      '    end repeat',
      '  end repeat',
      'end tell',
    ].join('\n');
    // Timeout + SIGKILL so a wedged System Events never leaks a zombie child (REL-4).
    execFile(
      'osascript',
      ['-e', script],
      { timeout: 5_000, killSignal: 'SIGKILL' },
      (error, _stdout, stderr) => {
        if (error) {
          // Surface the osascript STDERR (the real TCC reason, e.g. -1743), not
          // just the command echo — never fatal, but logged so it's diagnosable.
          this.logger.warn(`game focus skipped: ${stderr?.trim() || error.message}`);
        }
      },
    );
  }
}
