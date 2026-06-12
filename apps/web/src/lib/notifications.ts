/**
 * System notifications for hits (web Notification API — Electron maps it to
 * native macOS notifications). Permission is requested lazily on first use.
 */
const NOTIFY_STORAGE_KEY = 'sniper.systemNotifications';

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
      new Notification(title, { body, silent: true });
    } else if (Notification.permission !== 'denied') {
      void Notification.requestPermission().then((permission) => {
        if (permission === 'granted') new Notification(title, { body, silent: true });
      });
    }
  } catch {
    // notifications unavailable — the in-app feed still shows the hit
  }
}
