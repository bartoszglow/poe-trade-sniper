/**
 * System notifications for hits (web Notification API — Electron maps it to
 * native macOS notifications). Permission is requested lazily on first use.
 */
const NOTIFY_STORAGE_KEY = 'sniper.systemNotifications';
/** Our brand mark for the notification image (served from web `public/`).
 *  NB: in `electron .` dev macOS still keys the small SENDER icon off the
 *  running Electron.app bundle; the packaged app uses build/icon.icns. */
const NOTIFY_ICON = '/apple-touch-icon.png';

function fireNotification(title: string, body: string): void {
  new Notification(title, { body, icon: NOTIFY_ICON, silent: true });
}

export function isNotifyEnabled(): boolean {
  return localStorage.getItem(NOTIFY_STORAGE_KEY) !== '0';
}

export function setNotifyEnabled(enabled: boolean): void {
  localStorage.setItem(NOTIFY_STORAGE_KEY, enabled ? '1' : '0');
}

export function showSystemNotification(title: string, body: string): void {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      fireNotification(title, body);
    } else if (Notification.permission !== 'denied') {
      void Notification.requestPermission().then((permission) => {
        if (permission === 'granted') fireNotification(title, body);
      });
    }
  } catch {
    // notifications unavailable — the in-app feed still shows the hit
  }
}
