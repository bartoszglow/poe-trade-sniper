# Packaging & release

How a build becomes a downloadable app. Promised by master plan §3; written
2026-07-17 once the release workflow existed to describe.

## Local build

```bash
pnpm --filter @poe-sniper/desktop dist    # → apps/desktop/release/*.dmg (arm64)
```

`dist` is deliberately one command that does everything, because two separate
gotchas have already shipped broken DMGs:

1. `abi:electron` **before** electron-builder and `abi:node` **after** — the tree
   is always left test-ready. electron-builder's `@electron/rebuild` has silently
   failed to rebuild `better-sqlite3` and packaged a Node-ABI binary, killing the
   app on boot with `NODE_MODULE_VERSION 127 vs 145`.
2. It builds `apps/web` itself. `extraResources` copies `apps/web/dist`
   **verbatim**, so a stale web build ships silently otherwise.

Debug a packaged app by running the binary in `Contents/MacOS/` directly and
reading stdout.

## Release (CI)

`.github/workflows/release.yml` fires on a `v*` tag:

- matrix: `macos-14` (dmg/arm64), `windows-latest` (nsis/x64), `ubuntu-latest`
  (AppImage/x64)
- `node scripts/set-version.mjs ${{ github.ref_name }}` stamps the tag into every
  `package.json` + `apps/server/src/version.ts`, so the committed `0.1.0` is
  irrelevant at build time — **the tag is the version**
- publishes a **draft** GitHub release (`releaseType: draft`), owner `bartoszglow`

To cut a release: land `[Unreleased]` → a versioned `CHANGELOG.md` heading, tag
`vX.Y.Z`, push the tag, then publish the draft.

## Icons

`apps/desktop/build/icon.icns` is the only icon input, and that is sufficient:
app-builder-lib resolves `icon.icns` as a candidate for the Windows `ico` and
Linux `set` formats too (`out/util/iconConverter.js` → `buildSourceCandidates`),
converting it per platform. `apps/desktop/assets/icon.png` is a separate thing —
the **runtime** dock/window icon for unpackaged dev runs.

## Signing & notarization — NOT done

Current config is `"identity": null` (macOS) and no Windows certificate. Builds
are unsigned, and the README tells users to work around Gatekeeper (`xattr -cr`)
and SmartScreen.

**This is a hard release prerequisite, not polish** (D-18 #1). macOS TCC ties the
Screen Recording + Accessibility grants to the app's signing identity: with no
stable Developer ID + Team ID + invariant appId, **every update resets the
grants** and the user must re-authorize Buy automation and price check by hand.

What it needs when Bartosz decides to do it:

- an Apple Developer ID (~$99/yr) → `identity`, `hardenedRuntime: true`,
  `entitlements` (the app needs `com.apple.security.device.audio-input`-style
  TCC-relevant entries only if it grows them; screen capture + accessibility are
  TCC grants, not entitlements), and an `afterSign` notarization hook
  (`@electron/notarize`) with `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` /
  `APPLE_TEAM_ID` as repo secrets
- Windows: an OV/EV code-signing certificate → `CSC_LINK` / `CSC_KEY_PASSWORD`.
  Without EV, SmartScreen reputation still has to accumulate.
- once signed + notarized, silent auto-update (`electron-updater`) becomes
  possible; the current `GET /api/update` check-only banner exists precisely
  because that path is blocked.

## Update check (shipped, check-only)

`UpdateService` polls `api.github.com/repos/$GITHUB_RELEASES_REPO/releases/latest`,
semver-compares against `APP_VERSION`, and picks the installer asset by OS
suffix. Dormant unless `GITHUB_RELEASES_REPO` is set — the packaged app sets it in
`apps/desktop/src/main.ts`. It never downloads or installs; the banner opens the
release page in the real browser. This is the **only** non-GGG outbound call the
app makes, and it sends no account/machine/usage data.
