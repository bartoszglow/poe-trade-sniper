# PoE Trade Sniper

**Win the listing before anyone else.** A desktop app that watches your Path of
Exile 2 trade searches, spots a new listing within **seconds** of it going live,
pings you, and warps you straight to the seller's hideout — **no browser, no
tab-spamming F5, no copy-pasting whispers.** You alt-tab in, the item's already
there.

> Available for **Windows · macOS · Linux** — [grab the latest release ↓](#install)

![platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![license](https://img.shields.io/badge/license-UNLICENSED-lightgrey)

---

## Why you want this

Good deals on the PoE2 trade site die in seconds. By the time you've refreshed,
clicked the listing, copied the whisper, and tabbed into the game, it's gone.
This app collapses that whole chain into **one alert and one warp**:

- ⚡ **Instant detection.** Holds a live WebSocket to each search — the same push
  channel the trade site uses — so you hear about a listing the moment it
  appears, not on the next refresh. A polling fallback covers any reconnect gap,
  so you never miss a window.
- 🚀 **Browser-free travel.** Detects a hit → travels you to the seller's
  hideout in-game automatically (opt-in per search). No browser, no manual
  whisper. You just complete the trade.
- 🎯 **Watch many searches at once.** Each search runs like its own trade tab.
  Pause any of them without deleting (keeps its hit history), re-enable later.
- 🔔 **Alerts your way.** Desktop notification + sound on every hit, with a
  volume slider. A live "hits" feed shows what just dropped and how long ago.
- 🧾 **See exactly what you're hunting.** Paste a trade URL or search id and the
  app shows the decoded search criteria (item, mods, price cap) before you
  commit — no guessing what a saved search actually filters for.
- 🗂️ **Full hit history.** Search, date-filter, and sort everything you've ever
  caught; infinite scroll, item details laid out as clean cards.
- 🌍 **English & Polish** UI out of the box.
- 🔒 **Private by design.** Your session is encrypted at rest in your OS
  keychain. Nothing is sent anywhere except Path of Exile itself. Debug logs are
  redacted — they never contain your cookie or session token.
- 🛡️ **Built-in safety brake.** Hard per-minute ceilings on all outbound traffic
  so the app can never run away and hammer the trade API on your behalf.

---

## Install

Download the installer for your OS from the
[**Releases page**](https://github.com/bartoszglow/poe-trade-sniper/releases/latest):

| OS      | File               | Notes               |
| ------- | ------------------ | ------------------- |
| Windows | `...-x64.exe`      | NSIS installer, x64 |
| macOS   | `...-arm64.dmg`    | Apple Silicon       |
| Linux   | `...-x64.AppImage` | `chmod +x` then run |

> **Heads-up: the builds are unsigned.** Code-signing certificates cost money,
> so for now your OS will warn you the first time. The app is open and the
> traffic is auditable — but here's how to get past the warning:
>
> - **Windows** — SmartScreen says "Windows protected your PC" → click **More
>   info** → **Run anyway**.
> - **macOS** — if it says _"app is damaged / can't be opened"_, open Terminal
>   and run `xattr -cr "/Applications/PoE Trade Sniper.app"`, then launch it.
>   (Or right-click the app → **Open** → **Open**.)
> - **Linux** — `chmod +x PoE-Trade-Sniper-*.AppImage` and double-click / run it.

---

## How to use it

1. **Launch the app** and open **Settings → Log in with Path of Exile**. A real
   browser window opens; log in on the official pathofexile.com page as usual.
   Only your session cookie is captured, and it's encrypted locally — the app
   never sees your password.
2. **Add a search.** Paste a trade search **URL** (or just its **id**) from the
   PoE2 trade site. Hit **Show criteria** if you want to confirm it's the right
   one.
3. **Pick what happens on a hit.** Leave it as alert-only, or flip **TRAVEL** on
   to auto-warp to the seller's hideout the instant a match appears.
4. **Play.** When something drops you get a sound + notification (and, if TRAVEL
   is on, you're already in their hideout). Complete the trade in-game.
5. Watch as many searches as you like; **pause** the ones you don't need right
   now without losing their history.

That's it. The app keeps its WebSocket connections alive in the background while
you play.

---

## FAQ

**Will I get banned?**
This is an unofficial tool — use it at your own risk. It talks to the _same_
trade API your browser already uses, stays under conservative rate limits, and
**never automates gameplay** (no auto-buying, no botting, no movement scripts —
it only requests a hideout-travel, exactly like clicking the button on the trade
site). That said, GGG has not blessed third-party trade tools, so treat it like
any unofficial helper and don't go wild. The built-in safety brake exists
specifically to keep your request rate sane.

**Does it buy items for me?**
No. It detects the listing and travels you to the hideout. **You** complete the
trade manually. It's a sniper's scope, not a trigger.

**Do I have to give it my password?**
No. Login happens in a real browser on the official Path of Exile site. The app
only captures the resulting session cookie and encrypts it in your OS keychain.

**Where does my data go?**
Nowhere. Everything is local. The only server it ever contacts is
pathofexile.com. The optional debug log is written to a local file and is
redacted — it never includes your cookie or token.

**How do updates work?**
When a new version is released, the app shows a "new version available" banner
that opens the download in your browser. Updates are manual (no silent
auto-install) so nothing changes under you without consent.

**It won't open / says it's damaged.**
That's the unsigned-build warning — see the workaround in [Install](#install).

**Which league does it use?**
Whatever you select / whatever your search URL targets. Standard by default.

---

## Development

This is a pnpm monorepo: one NestJS core, two shells (local web UI + Electron
desktop).

```bash
nvm use            # Node 22
pnpm install
cp .env.example .env
pnpm dev           # server + web (browser UI on the Vite dev server)
pnpm verify        # lint + typecheck + test
```

Desktop shell:

```bash
pnpm --filter @poe-sniper/desktop dev       # Electron pointed at the dev server
pnpm --filter @poe-sniper/desktop dist      # local macOS .dmg build
```

### Where things live

- `apps/server` — NestJS sniper core (detection engines, trade API adapter,
  rate-limit governor, travel, network log, update check)
- `apps/web` — React operator UI (i18n, live SSE feed, hits history)
- `apps/desktop` — Electron shell (embeds the server in-process over loopback)
- `packages/shared` — canonical domain types
- `docs/` — how this project is built; start with [docs/README.md](docs/README.md)

The GGG trade API is undocumented — read `docs/integration/api-notes.md` before
touching anything that talks to pathofexile.com.

### Releasing

The git tag is the single source of truth for the version.

```bash
# 1. Move [Unreleased] → [x.y.z] in CHANGELOG.md and commit.
# 2. Tag and push the tag:
git tag v0.1.0
git push origin v0.1.0
```

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds the
Windows / macOS / Linux installers on their native runners and uploads them to a
**draft** GitHub Release. Review the draft, then click **Publish** — only then
does the in-app update check surface it to users.

---

> Not affiliated with or endorsed by Grinding Gear Games. "Path of Exile" is a
> trademark of Grinding Gear Games. Use responsibly and at your own risk.
