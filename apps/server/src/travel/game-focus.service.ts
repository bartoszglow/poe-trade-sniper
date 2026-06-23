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
    // GAME_FOCUS_PROCESS is charset-validated in the config schema (no quotes),
    // so inlining it into the AppleScript here cannot break out of the string.
    const script =
      `tell application "System Events" to set frontmost of ` +
      `(first process whose name is "${this.config.GAME_FOCUS_PROCESS}" and background only is false) to true`;
    execFile('osascript', ['-e', script], (error) => {
      if (error) {
        // Game not running / renamed / Automation permission denied — never fatal.
        this.logger.debug(`game focus skipped: ${error.message}`);
      }
    });
  }
}
