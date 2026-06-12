/**
 * App update status from `GET /api/update`. A lightweight check only — it
 * reports whether a newer release exists and where to download it; it never
 * installs anything (silent auto-update needs a signed + notarized build).
 */
export interface UpdateStatus {
  currentVersion: string;
  /** Latest published version, or null when the check is unconfigured/unreachable. */
  latestVersion: string | null;
  updateAvailable: boolean;
  /** Release page (GitHub) to open for the changelog. */
  releaseUrl: string | null;
  /** Direct installer (.dmg) download URL when one is published. */
  downloadUrl: string | null;
}
