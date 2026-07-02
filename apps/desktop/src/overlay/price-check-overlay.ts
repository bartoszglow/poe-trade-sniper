import { BrowserWindow, screen } from 'electron';

/**
 * Click-through price-check overlay (#37, D-pc-5). A transparent, frameless,
 * always-on-top panel that floats ABOVE the game — even under Wine "fullscreen"
 * (a level-26 borderless window; our `screen-saver` level 1000 renders over it,
 * verified in the research). Info-only + click-through, so it never steals focus
 * from the game and needs no permission just to display — the design that avoids
 * the whole class of overlay focus bugs other tools hit on macOS.
 *
 * NEEDS on-Mac + in-game validation (over the real game window, fullscreen).
 */

/** Auto-hide the overlay this long after a result is shown. */
const OVERLAY_TTL_MS = 12_000;
const OVERLAY_WIDTH = 320;
const OVERLAY_MAX_HEIGHT = 360;

export interface PriceCheckOverlay {
  show: (result: unknown) => void;
  destroy: () => void;
}

export function createPriceCheckOverlay(): PriceCheckOverlay {
  const window = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_MAX_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    // A non-activating panel: floats over full-screened apps and never steals key
    // focus (macOS). Combined with the screen-saver level + click-through below.
    type: 'panel',
    focusable: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Info-only: forward mouse so hover still works but clicks pass through to the game.
  window.setIgnoreMouseEvents(true, { forward: true });

  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  function show(result: unknown): void {
    const html = renderOverlayHtml(result);
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    // Anchor near the cursor, clamped to the current display's work area.
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const x = Math.min(cursor.x + 16, display.workArea.x + display.workArea.width - OVERLAY_WIDTH);
    const y = Math.min(
      cursor.y + 16,
      display.workArea.y + display.workArea.height - OVERLAY_MAX_HEIGHT,
    );
    window.setPosition(Math.round(x), Math.round(y));
    window.showInactive();
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => window.hide(), OVERLAY_TTL_MS);
  }

  function destroy(): void {
    if (hideTimer) clearTimeout(hideTimer);
    if (!window.isDestroyed()) window.destroy();
  }

  return { show, destroy };
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}

/** Minimal self-contained overlay markup — no framework, no external assets. */
function renderOverlayHtml(result: unknown): string {
  const priceResult = result as {
    kind?: string;
    item?: { name?: string | null; baseType?: string | null };
    estimate?: { amount?: number; currency?: string } | null;
    listings?: Array<{
      price?: { amount?: number; currency?: string } | null;
      seller?: string | null;
    }>;
    declineReason?: string | null;
  };
  const name = priceResult.item?.name ?? priceResult.item?.baseType ?? 'Item';
  const rows: string[] = [];
  if (priceResult.kind === 'aggregate' && priceResult.estimate) {
    rows.push(
      `<div class="row"><span class="est">≈ ${priceResult.estimate.amount} ${escapeHtml(priceResult.estimate.currency ?? '')}</span></div>`,
    );
  } else if (priceResult.kind === 'listings') {
    for (const listing of (priceResult.listings ?? []).slice(0, 8)) {
      const price = listing.price
        ? `${listing.price.amount} ${escapeHtml(listing.price.currency ?? '')}`
        : '—';
      rows.push(
        `<div class="row"><span class="price">${price}</span><span class="seller">${escapeHtml(listing.seller ?? '')}</span></div>`,
      );
    }
    if (rows.length === 0) rows.push('<div class="muted">No comparable listings.</div>');
  } else {
    rows.push('<div class="muted">Price unavailable.</div>');
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;font:12px -apple-system,"Segoe UI",sans-serif;color:#d6cfc2;background:transparent}
    .card{margin:6px;padding:10px 12px;border-radius:10px;border:1px solid #443d2f;
      background:rgba(20,18,16,0.94);box-shadow:0 10px 30px rgba(0,0,0,.5)}
    .title{font-weight:600;color:#e3c87e;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .row{display:flex;gap:8px;padding:2px 0;border-top:1px solid #2e2a22}
    .row:first-of-type{border-top:none}
    .price{color:#c9a85c;font-variant-numeric:tabular-nums}
    .est{color:#c9a85c;font-size:14px}
    .seller{margin-left:auto;color:#5d574c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px}
    .muted{color:#5d574c;padding:4px 0}
  </style></head><body><div class="card">
    <div class="title">${escapeHtml(name)}</div>${rows.join('')}
  </div></body></html>`;
}
