import { Inject, Injectable, Logger } from '@nestjs/common';
import type { UpdateStatus } from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { APP_VERSION } from '../version.js';

interface GithubRelease {
  tag_name?: string;
  html_url?: string;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
}

/** Installer extension this OS can open — so the banner links the right asset. */
function installerSuffixForPlatform(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return '.dmg';
  if (platform === 'win32') return '.exe';
  return '.AppImage';
}

/** `v1.2.3` / `1.2.3-rc1` → `[1,2,3]` (pre-release suffix dropped for compare). */
function parseVersion(raw: string): number[] {
  return raw
    .replace(/^v/i, '')
    .split('-')[0]!
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
}

/** True when `candidate` is a strictly newer semver than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

/**
 * Lightweight update check against GitHub Releases — reports whether a newer
 * version exists and where to get it. It never downloads or installs (silent
 * auto-update needs a signed/notarized build). Disabled until a repo is set.
 */
@Injectable()
export class UpdateService {
  private readonly logger = new Logger(UpdateService.name);
  private cache: { status: UpdateStatus; fetchedAtMs: number } | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async check(): Promise<UpdateStatus> {
    const disabled: UpdateStatus = {
      currentVersion: APP_VERSION,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      downloadUrl: null,
    };
    if (!this.config.GITHUB_RELEASES_REPO) return disabled;
    if (this.cache && Date.now() - this.cache.fetchedAtMs < this.config.UPDATE_CHECK_TTL_MS) {
      return this.cache.status;
    }

    try {
      const response = await fetch(
        `https://api.github.com/repos/${this.config.GITHUB_RELEASES_REPO}/releases/latest`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'poe-trade-sniper',
          },
          signal: AbortSignal.timeout(this.config.OUTBOUND_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        // 404 = no releases yet; anything else = transient. Either way: no update.
        this.cache = { status: disabled, fetchedAtMs: Date.now() };
        return disabled;
      }
      const release = (await response.json()) as GithubRelease;
      const latestVersion = release.tag_name?.replace(/^v/i, '') ?? null;
      // Pick the asset for the OS the app runs on (server shares the process);
      // fall back to the release page when no matching installer is attached.
      const suffix = installerSuffixForPlatform(process.platform);
      const installer = release.assets?.find((asset) => asset.name?.endsWith(suffix));
      const status: UpdateStatus = {
        currentVersion: APP_VERSION,
        latestVersion,
        updateAvailable: latestVersion ? isNewerVersion(latestVersion, APP_VERSION) : false,
        releaseUrl: release.html_url ?? null,
        downloadUrl: installer?.browser_download_url ?? release.html_url ?? null,
      };
      this.cache = { status, fetchedAtMs: Date.now() };
      return status;
    } catch (error) {
      this.logger.warn(`update check failed: ${String(error)}`);
      return disabled;
    }
  }
}
